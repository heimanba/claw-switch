//! CLI 工具安装后端驱动
//!
//! 将安装逻辑从前端 cliInstaller.ts 迁移至 Rust 后端，参考 openclaw-manager 的实现。
//! 通过 Tauri 事件推送实时进度，支持取消安装，并处理跨平台终端打开。

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use log::warn;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ──────────────────────────────────────────────────────────────────────────────
// 全局状态：当前安装/卸载进程 PID（用于取消）
// ──────────────────────────────────────────────────────────────────────────────

static INSTALL_PID: Lazy<Arc<Mutex<Option<u32>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

static UNINSTALL_PID: Lazy<Arc<Mutex<Option<u32>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

// ──────────────────────────────────────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────────────────────────────────────

const REGISTRY: &str = "--registry=https://registry.npmmirror.com";

/// CLI 安装过程最大等待时间（秒），超时后终止进程并提示使用手动安装。
/// 当前为 900 秒（15 分钟），网络较慢或包较大时可适当调大。
const CLI_INSTALL_TIMEOUT_SECS: u64 = 900;

// ──────────────────────────────────────────────────────────────────────────────
// 数据结构
// ──────────────────────────────────────────────────────────────────────────────

/// 安装结果（返回给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInstallResult {
    pub success: bool,
    pub message: String,
    /// PERMISSION_DENIED / INSTALL_FAILED / UNKNOWN_ERROR / CANCELLED
    pub error_code: Option<String>,
    /// "manual" / "retry"
    pub fallback_action: Option<String>,
    /// 安装成功后 npm 全局 bin 目录，用于提示用户将 PATH 加入终端（避免 command not found）
    pub global_bin_path: Option<String>,
}

/// 实时进度事件负载（通过 Tauri 事件推送）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliInstallProgress {
    pub app_id: String,
    pub progress: u8,
    pub log: String,
}

// ──────────────────────────────────────────────────────────────────────────────
// 内部工具函数
// ──────────────────────────────────────────────────────────────────────────────

/// 获取各应用的安装命令（与前端 cliInstaller.ts 保持一致）
fn get_install_command(app_id: &str) -> Option<String> {
    match app_id {
        "claude" => Some(format!(
            "npm install -g @anthropic-ai/claude-code {REGISTRY}"
        )),
        "codex" => Some(format!("npm install -g @openai/codex {REGISTRY}")),
        "gemini" => Some(format!("npm install -g @google/gemini-cli {REGISTRY}")),
        "opencode" => Some("curl -fsSL https://opencode.ai/install | bash".to_string()),
        "qwen" => Some(format!(
            "npm install -g @qwen-code/qwen-code {REGISTRY}"
        )),
        "openclaw" => Some(format!("npm install -g openclaw {REGISTRY}")),
        "cline" => Some(format!("npm install -g @cline/cline-code {REGISTRY}")),
        _ => None,
    }
}

/// 获取各应用的卸载命令（npm uninstall -g，opencode 无对应 npm 包返回 None）
fn get_uninstall_command(app_id: &str) -> Option<String> {
    let pkg = match app_id {
        "claude" => "@anthropic-ai/claude-code",
        "codex" => "@openai/codex",
        "gemini" => "@google/gemini-cli",
        "opencode" => return None, // curl 安装，无统一 npm 卸载
        "qwen" => "@qwen-code/qwen-code",
        "openclaw" => "openclaw",
        "cline" => "@cline/cline-code",
        _ => return None,
    };
    Some(format!("npm uninstall -g {pkg} {REGISTRY}"))
}

/// 根据 npm 输出关键词估算卸载进度百分比
fn estimate_uninstall_progress(line: &str) -> u8 {
    let lower = line.to_lowercase();
    if lower.contains("removing") || lower.contains("unbuild") {
        return 40;
    }
    if lower.contains("success") || lower.contains("removed") || lower.contains("unchanged") {
        return 95;
    }
    50
}

/// 构建扩展的 PATH 环境变量
///
/// GUI 应用启动时不继承用户 shell 的 PATH，需手动注入 nvm/volta/fnm/Homebrew 等路径。
fn get_extended_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.display().to_string();

    // ① 最高优先级：继承当前进程 PATH
    //    用户 shell 里通过 nvm/fnm/volta/Homebrew 选定的 node/npm 版本就在这里，
    //    必须放最前面，确保 npm install 使用用户实际期望的版本。
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.is_empty() {
        parts.push(current);
    }

    // ② 兜底：nvm default alias（GUI 应用启动时继承到的 PATH 可能不含 nvm）
    if !home_str.is_empty() {
        let nvm_alias = format!("{home_str}/.nvm/alias/default");
        if let Ok(ver) = std::fs::read_to_string(&nvm_alias) {
            let ver = ver.trim().trim_start_matches('v');
            if !ver.is_empty() {
                let p = format!("{home_str}/.nvm/versions/node/v{ver}/bin");
                if std::path::Path::new(&p).exists() {
                    // 插到最前，比当前 PATH 更优先（仅当 default alias 存在时）
                    parts.insert(0, p);
                }
            }
        }

        // ③ 兜底：nvm 所有已安装版本
        let nvm_base = format!("{home_str}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin");
                if bin.exists() {
                    parts.push(bin.display().to_string());
                }
            }
        }

        // ④ 兜底：其他版本管理器 / 全局 npm
        parts.push(format!("{home_str}/.fnm/aliases/default/bin")); // fnm
        parts.push(format!("{home_str}/.volta/bin"));               // volta
        parts.push(format!("{home_str}/.asdf/shims"));              // asdf
        parts.push(format!("{home_str}/.local/share/mise/shims"));  // mise
        parts.push(format!("{home_str}/.npm-global/bin"));          // npm global
        parts.push(format!("{home_str}/.local/bin"));               // ~/.local/bin

        #[cfg(target_os = "windows")]
        if let Some(appdata) = dirs::data_dir() {
            parts.push(appdata.join("npm").display().to_string());
        }
    }

    // ⑤ 最低优先级：Homebrew / 系统路径（作为最终兜底）
    #[cfg(target_os = "macos")]
    {
        parts.push("/opt/homebrew/bin".to_string()); // Apple Silicon
        parts.push("/usr/local/bin".to_string());    // Intel Mac
    }
    #[cfg(not(target_os = "windows"))]
    {
        parts.push("/usr/bin".to_string());
        parts.push("/bin".to_string());
    }

    parts.join(if cfg!(target_os = "windows") { ";" } else { ":" })
}

/// 获取 npm 全局 bin 目录（用于安装成功后的 PATH 提示）
fn get_npm_global_bin(extended_path: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", "npm bin -g"])
        .env("PATH", extended_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .args(["-c", "npm bin -g"])
        .env("PATH", extended_path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if out.is_empty() || out.contains('\n') {
        return None;
    }
    Some(out)
}

/// 根据 npm 输出关键词估算安装进度百分比
fn estimate_progress(line: &str) -> u8 {
    let lower = line.to_lowercase();
    if lower.contains("resolving") || lower.contains("fetching") {
        return 20;
    }
    if lower.contains("downloading") {
        return 40;
    }
    if lower.contains("extracting") {
        return 60;
    }
    if lower.contains("building") || lower.contains("compiling") {
        return 80;
    }
    if lower.contains("success") || lower.contains("completed") {
        return 95;
    }
    50
}

/// 杀死指定 PID 的进程（跨平台）
#[cfg(target_os = "windows")]
fn kill_process(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn kill_process(pid: u32) {
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output();
}

// ──────────────────────────────────────────────────────────────────────────────
// Tauri 命令
// ──────────────────────────────────────────────────────────────────────────────

/// 安装 CLI 工具
///
/// 1. 检测 npm 全局权限（opencode 除外）
/// 2. 启动安装进程，通过 `cli-install-progress` 事件实时推送进度
/// 3. 返回安装结果
#[command]
pub async fn install_cli_tool(
    app: AppHandle,
    app_id: String,
) -> Result<CliInstallResult, String> {
    let command_str = match get_install_command(&app_id) {
        Some(c) => c,
        None => {
            return Ok(CliInstallResult {
                success: false,
                message: "不支持的应用类型".to_string(),
                error_code: Some("UNKNOWN_ERROR".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }
    };

    let extended_path = get_extended_path();

    // opencode 使用 curl 安装，不需要 Node/npm
    let skip_npm_check = app_id == "opencode";

    if !skip_npm_check {
        // 推送：正在检测环境
        let _ = app.emit(
            "cli-install-progress",
            CliInstallProgress {
                app_id: app_id.clone(),
                progress: 3,
                log: "检测 Node.js / npm 环境...".to_string(),
            },
        );

        // 先检测是否能找到 npm（GUI 启动时 PATH 可能不包含 nvm/fnm 等，get_extended_path 已注入常见路径）
        let npm_found = {
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "npm --version"])
                    .env("PATH", &extended_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
            #[cfg(not(target_os = "windows"))]
            {
                Command::new("sh")
                    .args(["-c", "npm --version"])
                    .env("PATH", &extended_path)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        };

        if !npm_found {
            return Ok(CliInstallResult {
                success: false,
                message: "未检测到 Node.js 或 npm，请先安装 Node.js（推荐 18+），或使用右侧「手动安装」在终端中执行".to_string(),
                error_code: Some("NODE_NPM_NOT_FOUND".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }

        // 推送：正在检测权限
        let _ = app.emit(
            "cli-install-progress",
            CliInstallProgress {
                app_id: app_id.clone(),
                progress: 5,
                log: "检测安装权限...".to_string(),
            },
        );

        let perm_ok = {
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "npm root -g"])
                    .env("PATH", &extended_path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
            #[cfg(not(target_os = "windows"))]
            {
                Command::new("sh")
                    .args(["-c", "npm root -g"])
                    .env("PATH", &extended_path)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        };

        if !perm_ok {
            return Ok(CliInstallResult {
                success: false,
                message: "需要管理员/写全局目录权限，请使用手动安装方式（终端中执行）".to_string(),
                error_code: Some("PERMISSION_DENIED".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }
    }

    // 推送：开始安装
    let _ = app.emit(
        "cli-install-progress",
        CliInstallProgress {
            app_id: app_id.clone(),
            progress: 10,
            log: format!("开始安装，执行: {command_str}"),
        },
    );

    // 启动安装子进程（piped stdout/stderr 以读取实时输出）
    let child_result = {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", &command_str])
                .env("PATH", &extended_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-c", &command_str])
                .env("PATH", &extended_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        }
    };

    let mut child = match child_result {
        Ok(c) => c,
        Err(e) => {
            warn!("[CLI Installer] 启动安装进程失败: {e}");
            return Ok(CliInstallResult {
                success: false,
                message: format!("启动安装进程失败: {e}"),
                error_code: Some("UNKNOWN_ERROR".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }
    };

    // 保存 PID 用于取消
    let pid = child.id();
    {
        let mut guard = INSTALL_PID.lock().unwrap();
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().expect("stdout should be piped");
    let stderr = child.stderr.take().expect("stderr should be piped");

    // 启动线程：读取 stdout 并推送进度事件
    let app_stdout = app.clone();
    let app_id_stdout = app_id.clone();
    let stdout_handle = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if let Ok(line) = line {
                let p = estimate_progress(&line);
                let _ = app_stdout.emit(
                    "cli-install-progress",
                    CliInstallProgress {
                        app_id: app_id_stdout.clone(),
                        progress: p,
                        log: line,
                    },
                );
            }
        }
    });

    // 启动线程：读取 stderr，检测权限错误，并保留最后一行便于失败时展示
    let app_stderr = app.clone();
    let app_id_stderr = app_id.clone();
    let stderr_handle = std::thread::spawn(move || {
        let mut perm_err = false;
        let mut last_line: Option<String> = None;
        for line in BufReader::new(stderr).lines() {
            if let Ok(line) = line {
                if line.contains("EACCES") || line.contains("permission denied") {
                    perm_err = true;
                }
                last_line = Some(line.clone());
                let _ = app_stderr.emit(
                    "cli-install-progress",
                    CliInstallProgress {
                        app_id: app_id_stderr.clone(),
                        progress: 50,
                        log: line,
                    },
                );
            }
        }
        (perm_err, last_line)
    });

    // 在阻塞线程中等待输出读取完成，再等待进程退出（带超时）
    let install_pid_ref = INSTALL_PID.clone();
    let (exit_status, has_perm_error, last_stderr_line, timed_out) =
        tokio::task::spawn_blocking(move || {
            // 等待输出线程结束（进程退出后管道关闭，线程随之完成）
            let _ = stdout_handle.join();
            let (perm_err, last_line) = stderr_handle.join().unwrap_or((false, None));

            // 在子线程中等待进程退出，主线程用 recv_timeout 实现超时
            let (tx, rx) = mpsc::channel();
            let wait_handle = std::thread::spawn(move || {
                let _ = tx.send(child.wait());
            });

            let status = match rx.recv_timeout(Duration::from_secs(CLI_INSTALL_TIMEOUT_SECS)) {
                Ok(Ok(s)) => Some(s),
                Ok(Err(_)) => None,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    warn!(
                        "[CLI Installer] 安装超时（{} 秒），终止进程",
                        CLI_INSTALL_TIMEOUT_SECS
                    );
                    if let Some(pid) = *install_pid_ref.lock().unwrap() {
                        kill_process(pid);
                    }
                    let _ = wait_handle.join();
                    let mut guard = install_pid_ref.lock().unwrap();
                    *guard = None;
                    return (None, perm_err, last_line, true);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = wait_handle.join();
                    None
                }
            };

            // 清除 PID
            {
                let mut guard = install_pid_ref.lock().unwrap();
                *guard = None;
            }

            (status, perm_err, last_line, false)
        })
        .await
        .map_err(|e| format!("安装任务错误: {e}"))?;

    if timed_out {
        return Ok(CliInstallResult {
            success: false,
            message: format!(
                "安装超时（{} 分钟），可能是网络较慢。请使用右侧「手动安装」在终端中执行",
                CLI_INSTALL_TIMEOUT_SECS / 60
            ),
            error_code: Some("INSTALL_TIMEOUT".to_string()),
            fallback_action: Some("manual".to_string()),
            global_bin_path: None,
        });
    }

    match exit_status {
        None => Ok(CliInstallResult {
            success: false,
            message: "安装已取消".to_string(),
            error_code: Some("CANCELLED".to_string()),
            fallback_action: None,
            global_bin_path: None,
        }),
        Some(s) if s.success() => {
            let _ = app.emit(
                "cli-install-progress",
                CliInstallProgress {
                    app_id: app_id.clone(),
                    progress: 100,
                    log: "安装完成！".to_string(),
                },
            );
            let global_bin_path = get_npm_global_bin(&extended_path);
            Ok(CliInstallResult {
                success: true,
                message: "安装完成！".to_string(),
                error_code: None,
                fallback_action: None,
                global_bin_path,
            })
        }
        Some(s) => {
            if has_perm_error {
                Ok(CliInstallResult {
                    success: false,
                    message: "权限不足，请使用手动安装".to_string(),
                    error_code: Some("PERMISSION_DENIED".to_string()),
                    fallback_action: Some("manual".to_string()),
                    global_bin_path: None,
                })
            } else {
                let mut message = format!("安装失败，退出码: {:?}", s.code());
                if let Some(ref line) = last_stderr_line {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && trimmed.len() <= 200 {
                        message.push_str("；最后输出: ");
                        message.push_str(trimmed);
                    }
                }
                Ok(CliInstallResult {
                    success: false,
                    message,
                    error_code: Some("INSTALL_FAILED".to_string()),
                    fallback_action: Some("retry".to_string()),
                    global_bin_path: None,
                })
            }
        }
    }
}

/// 取消正在进行的 CLI 安装
#[command]
pub async fn cancel_cli_install() -> Result<(), String> {
    let pid_opt = {
        let guard = INSTALL_PID.lock().unwrap();
        *guard
    };

    if let Some(pid) = pid_opt {
        warn!("[CLI Installer] 取消安装，PID: {pid}");
        kill_process(pid);
        let mut guard = INSTALL_PID.lock().unwrap();
        *guard = None;
    }

    Ok(())
}

/// 卸载 CLI 工具
///
/// 执行 `npm uninstall -g <pkg>`，通过 `cli-uninstall-progress` 事件推送进度。
/// opencode 无对应 npm 包，返回不支持。
#[command]
pub async fn uninstall_cli_tool(
    app: AppHandle,
    app_id: String,
) -> Result<CliInstallResult, String> {
    let command_str = match get_uninstall_command(&app_id) {
        Some(c) => c,
        None => {
            return Ok(CliInstallResult {
                success: false,
                message: "该应用不支持通过本界面卸载".to_string(),
                error_code: Some("UNKNOWN_ERROR".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }
    };

    let extended_path = get_extended_path();

    let _ = app.emit(
        "cli-uninstall-progress",
        CliInstallProgress {
            app_id: app_id.clone(),
            progress: 5,
            log: "检测卸载权限...".to_string(),
        },
    );

    #[cfg(target_os = "windows")]
    let perm_ok = Command::new("cmd")
        .args(["/C", "npm root -g"])
        .env("PATH", &extended_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    #[cfg(not(target_os = "windows"))]
    let perm_ok = Command::new("sh")
        .args(["-c", "npm root -g"])
        .env("PATH", &extended_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !perm_ok {
        return Ok(CliInstallResult {
            success: false,
            message: "需要管理员权限，请使用手动卸载方式".to_string(),
            error_code: Some("PERMISSION_DENIED".to_string()),
            fallback_action: Some("manual".to_string()),
            global_bin_path: None,
        });
    }

    let _ = app.emit(
        "cli-uninstall-progress",
        CliInstallProgress {
            app_id: app_id.clone(),
            progress: 10,
            log: format!("开始卸载，执行: {command_str}"),
        },
    );

    let child_result = {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", &command_str])
                .env("PATH", &extended_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("sh")
                .args(["-c", &command_str])
                .env("PATH", &extended_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
        }
    };

    let mut child = match child_result {
        Ok(c) => c,
        Err(e) => {
            warn!("[CLI Uninstaller] 启动卸载进程失败: {e}");
            return Ok(CliInstallResult {
                success: false,
                message: format!("启动卸载进程失败: {e}"),
                error_code: Some("UNKNOWN_ERROR".to_string()),
                fallback_action: Some("manual".to_string()),
                global_bin_path: None,
            });
        }
    };

    let pid = child.id();
    {
        let mut guard = UNINSTALL_PID.lock().unwrap();
        *guard = Some(pid);
    }

    let stdout = child.stdout.take().expect("stdout should be piped");
    let stderr = child.stderr.take().expect("stderr should be piped");

    let app_stdout = app.clone();
    let app_id_stdout = app_id.clone();
    let stdout_handle = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if let Ok(line) = line {
                let p = estimate_uninstall_progress(&line);
                let _ = app_stdout.emit(
                    "cli-uninstall-progress",
                    CliInstallProgress {
                        app_id: app_id_stdout.clone(),
                        progress: p,
                        log: line,
                    },
                );
            }
        }
    });

    let app_stderr = app.clone();
    let app_id_stderr = app_id.clone();
    let stderr_handle = std::thread::spawn(move || {
        let mut perm_err = false;
        for line in BufReader::new(stderr).lines() {
            if let Ok(line) = line {
                if line.contains("EACCES") || line.contains("permission denied") {
                    perm_err = true;
                }
                let _ = app_stderr.emit(
                    "cli-uninstall-progress",
                    CliInstallProgress {
                        app_id: app_id_stderr.clone(),
                        progress: 50,
                        log: line,
                    },
                );
            }
        }
        perm_err
    });

    let uninstall_pid_ref = UNINSTALL_PID.clone();
    let (exit_status, has_perm_error) = tokio::task::spawn_blocking(move || {
        let _ = stdout_handle.join();
        let perm_err = stderr_handle.join().unwrap_or(false);
        let status = child.wait().ok();
        {
            let mut guard = uninstall_pid_ref.lock().unwrap();
            *guard = None;
        }
        (status, perm_err)
    })
    .await
    .map_err(|e| format!("卸载任务错误: {e}"))?;

    match exit_status {
        None => Ok(CliInstallResult {
            success: false,
            message: "卸载已取消".to_string(),
            error_code: Some("CANCELLED".to_string()),
            fallback_action: None,
            global_bin_path: None,
        }),
        Some(s) if s.success() => {
            let _ = app.emit(
                "cli-uninstall-progress",
                CliInstallProgress {
                    app_id: app_id.clone(),
                    progress: 100,
                    log: "卸载完成！".to_string(),
                },
            );
            Ok(CliInstallResult {
                success: true,
                message: "卸载完成！".to_string(),
                error_code: None,
                fallback_action: None,
                global_bin_path: None,
            })
        }
        Some(_) => {
            if has_perm_error {
                Ok(CliInstallResult {
                    success: false,
                    message: "权限不足，请使用手动卸载".to_string(),
                    error_code: Some("PERMISSION_DENIED".to_string()),
                    fallback_action: Some("manual".to_string()),
                    global_bin_path: None,
                })
            } else {
                Ok(CliInstallResult {
                    success: false,
                    message: "卸载失败，请尝试手动卸载".to_string(),
                    error_code: Some("INSTALL_FAILED".to_string()),
                    fallback_action: Some("retry".to_string()),
                    global_bin_path: None,
                })
            }
        }
    }
}

/// 取消正在进行的 CLI 卸载
#[command]
pub async fn cancel_cli_uninstall() -> Result<(), String> {
    let pid_opt = {
        let guard = UNINSTALL_PID.lock().unwrap();
        *guard
    };

    if let Some(pid) = pid_opt {
        warn!("[CLI Uninstaller] 取消卸载，PID: {pid}");
        kill_process(pid);
        let mut guard = UNINSTALL_PID.lock().unwrap();
        *guard = None;
    }

    Ok(())
}

/// 打开系统终端执行安装命令（手动安装模式）
#[command]
pub async fn open_terminal_for_install(app_id: String) -> Result<(), String> {
    let command_str = get_install_command(&app_id)
        .ok_or_else(|| format!("不支持的应用类型: {app_id}"))?;

    open_terminal_platform(&app_id, &command_str, "安装")
}

/// 打开系统终端执行卸载命令（手动卸载模式）
#[command]
pub async fn open_terminal_for_uninstall(app_id: String) -> Result<(), String> {
    let command_str = get_uninstall_command(&app_id)
        .ok_or_else(|| format!("不支持的应用类型或该应用不支持卸载: {app_id}"))?;

    open_terminal_platform(&app_id, &command_str, "卸载")
}

// ──────────────────────────────────────────────────────────────────────────────
// 平台特定：打开终端实现
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn open_terminal_platform(app_id: &str, command_str: &str, action: &str) -> Result<(), String> {
    // 写入 .command 脚本文件，通过 open 命令用 Terminal.app 打开
    // 先显示安装命令再执行，方便用户看到并可在需要时手动复制
    let escaped = command_str.replace('\\', "\\\\").replace('"', "\\\"");
    let script_content = format!(
        "#!/bin/bash\nclear\necho \"========================================\"\necho \"  {action} {app_id}\"\necho \"========================================\"\necho \"\"\necho \"请执行以下命令（将自动执行）：\"\necho \"\"\necho \"  {escaped}\"\necho \"\"\n{command_str}\necho \"\"\necho \"操作完成\"\nread -p \"按回车键关闭此窗口...\"\n"
    );
    let script_path = format!("/tmp/cc_cli_{app_id}.command");

    std::fs::write(&script_path, &script_content)
        .map_err(|e| format!("创建脚本失败: {e}"))?;

    Command::new("chmod")
        .args(["+x", &script_path])
        .output()
        .map_err(|e| format!("设置权限失败: {e}"))?;

    Command::new("open")
        .arg(&script_path)
        .spawn()
        .map_err(|e| format!("启动终端失败: {e}"))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn open_terminal_platform(_app_id: &str, command_str: &str, _action: &str) -> Result<(), String> {
    Command::new("powershell")
        .args(["-NoExit", "-Command", command_str])
        .spawn()
        .map_err(|e| format!("启动终端失败: {e}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_terminal_platform(_app_id: &str, command_str: &str, _action: &str) -> Result<(), String> {
    let full_cmd = format!("{command_str}; read -p '按回车键关闭...'");
    let terminals = [
        "gnome-terminal",
        "xfce4-terminal",
        "konsole",
        "xterm",
        "x-terminal-emulator",
    ];
    for term in &terminals {
        if Command::new(term)
            .args(["--", "bash", "-c", &full_cmd])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("无法启动终端，请手动执行安装命令".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn open_terminal_platform(_app_id: &str, _command_str: &str, _action: &str) -> Result<(), String> {
    Err("不支持的操作系统".to_string())
}
