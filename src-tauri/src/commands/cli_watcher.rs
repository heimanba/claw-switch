//! CLI 工具文件系统监听器
//! 利用 notify crate 监听常见 bin 目录的文件变化，
//! 一旦检测到 CLI 工具被安装或删除，立即通过 Tauri 事件通知前端。

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use log::{debug, info, warn};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter};

// ── 全局状态 ──────────────────────────────────────────────────────────────────

/// 停止信号：设为 true 时后台线程退出
static WATCHER_STOP: Lazy<Arc<AtomicBool>> =
    Lazy::new(|| Arc::new(AtomicBool::new(false)));

/// 每个工具的上一次已知安装状态 (tool_name → installed)
static TOOL_INSTALL_STATE: Lazy<Arc<Mutex<HashMap<String, bool>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 每个工具的最近一次事件发射时间，用于去抖 (tool_name → Instant)
static TOOL_DEBOUNCE: Lazy<Arc<Mutex<HashMap<String, Instant>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

// ── 事件结构 ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatusChangedEvent {
    /// 工具名称，如 "claude" / "codex"
    pub tool: String,
    /// true = 刚安装，false = 已被删除
    pub installed: bool,
}

// ── 内部辅助函数 ──────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
/// 构建扩展 PATH，确保 GUI 进程也能发现用户实际安装的 node/npm 目录。
fn get_extended_path() -> String {
    crate::path_utils::get_extended_path()
}

#[cfg(target_os = "windows")]
fn make_hidden_windows_cmd_call(program: &str, args: &[&str]) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = std::process::Command::new("cmd");
    cmd.arg("/D")
        .arg("/C")
        .arg("call")
        .arg(program)
        .args(args)
        .env("PATH", get_extended_path())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 通过 `npm prefix -g` 获取用户自定义的 npm 全局安装前缀。
/// 若用户通过 `npm config set prefix <path>` 自定义了路径，此函数返回对应的 bin 目录；
/// 若命令失败或路径与已知标准路径重复则返回 None。
fn get_npm_custom_prefix_bin() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let output = make_hidden_windows_cmd_call("npm", &["prefix", "-g"])
        .output()
        .ok()?;
    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("sh")
        .args(["-c", "npm prefix -g"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() || prefix.contains('\n') {
        return None;
    }
    // Windows：npm 全局 bin 即 prefix 本身；其他平台在 prefix/bin
    #[cfg(target_os = "windows")]
    return Some(PathBuf::from(prefix));
    #[cfg(not(target_os = "windows"))]
    return Some(PathBuf::from(prefix).join("bin"));
}

/// 收集所有需要监听的 bin 目录（只返回实际存在的目录）
fn get_watch_dirs() -> Vec<PathBuf> {
    let mut watch_dirs: Vec<PathBuf> = Vec::new();
    let home = dirs::home_dir().unwrap_or_default();

    // macOS 专属路径
    #[cfg(target_os = "macos")]
    {
        watch_dirs.push(PathBuf::from("/opt/homebrew/bin"));
        watch_dirs.push(PathBuf::from("/usr/local/bin"));
    }

    // Linux 专属路径
    #[cfg(target_os = "linux")]
    {
        watch_dirs.push(PathBuf::from("/usr/local/bin"));
        watch_dirs.push(PathBuf::from("/usr/bin"));
    }

    // Windows 专属路径
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = dirs::data_dir() {
            // npm 全局 bin
            watch_dirs.push(appdata.join("npm"));
            // nvm-windows：优先读取 NVM_HOME 环境变量，其次使用默认路径 %APPDATA%\nvm
            let nvm_root = std::env::var("NVM_HOME")
                .ok()
                .map(PathBuf::from)
                .unwrap_or_else(|| appdata.join("nvm"));
            if nvm_root.exists() {
                if let Ok(entries) = std::fs::read_dir(&nvm_root) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            watch_dirs.push(p);
                        }
                    }
                }
            }
        }
        // volta（%LOCALAPPDATA%\Programs\Volta\bin）
        if let Some(local_appdata) = dirs::data_local_dir() {
            watch_dirs.push(local_appdata.join("Programs").join("Volta").join("bin"));
            // fnm（%LOCALAPPDATA%\fnm\aliases\default）
            watch_dirs.push(local_appdata.join("fnm").join("aliases").join("default"));
            // pnpm 全局 bin
            watch_dirs.push(local_appdata.join("pnpm"));
        }
        // volta via HOME（~\.volta\bin）
        watch_dirs.push(home.join(".volta").join("bin"));
        // Scoop
        watch_dirs.push(home.join("scoop").join("shims"));
        watch_dirs.push(home.join("scoop").join("apps").join("nodejs").join("current"));
        watch_dirs.push(home.join("scoop").join("apps").join("nodejs-lts").join("current"));
        // C:\Program Files\nodejs（官网安装包默认路径）
        watch_dirs.push(PathBuf::from("C:\\Program Files\\nodejs"));
        watch_dirs.push(PathBuf::from("C:\\Program Files (x86)\\nodejs"));
    }

    // 用户目录下常见路径
    if !home.as_os_str().is_empty() {
        watch_dirs.push(home.join(".local/bin"));
        watch_dirs.push(home.join(".npm-global/bin"));
        watch_dirs.push(home.join(".volta/bin"));
        watch_dirs.push(home.join("n/bin"));

        // nvm：扫描所有已安装版本的 bin
        let nvm_base = home.join(".nvm/versions/node");
        if nvm_base.exists() {
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.exists() {
                        watch_dirs.push(bin);
                    }
                }
            }
        }

        // fnm
        let fnm_base = home.join(".local/state/fnm_multishells");
        if fnm_base.exists() {
            if let Ok(entries) = std::fs::read_dir(&fnm_base) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.exists() {
                        watch_dirs.push(bin);
                    }
                }
            }
        }
    }

    // 只保留实际存在的目录，并去重
    // 动态追加用户自定义 npm prefix（`npm config set prefix <path>` 的情况）
    if let Some(custom_bin) = get_npm_custom_prefix_bin() {
        watch_dirs.push(custom_bin);
    }

    let mut seen = std::collections::HashSet::new();
    watch_dirs
        .into_iter()
        .filter(|d| d.exists() && seen.insert(d.clone()))
        .collect()
}

/// 快速检查工具可执行文件是否存在（只做 Path::exists() 检查，不执行命令）
fn is_tool_file_present(tool: &str) -> bool {
    let home = dirs::home_dir().unwrap_or_default();

    // 构造候选路径列表
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{tool}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{tool}")));
        candidates.push(PathBuf::from(format!("/usr/bin/{tool}")));

        if !home.as_os_str().is_empty() {
            candidates.push(home.join(format!(".npm-global/bin/{tool}")));
            candidates.push(home.join(format!(".volta/bin/{tool}")));
            candidates.push(home.join(format!(".local/bin/{tool}")));
            candidates.push(home.join(format!("n/bin/{tool}")));

            // nvm
            let nvm_base = home.join(".nvm/versions/node");
            if nvm_base.exists() {
                if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                    for entry in entries.flatten() {
                        candidates.push(entry.path().join("bin").join(tool));
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = dirs::data_dir() {
            // npm 全局 bin
            candidates.push(appdata.join("npm").join(format!("{tool}.cmd")));
            candidates.push(appdata.join("npm").join(format!("{tool}.exe")));
            // nvm-windows：优先读取 NVM_HOME 环境变量，其次使用默认路径 %APPDATA%\nvm
            let nvm_root = std::env::var("NVM_HOME")
                .ok()
                .map(PathBuf::from)
                .unwrap_or_else(|| appdata.join("nvm"));
            if nvm_root.exists() {
                if let Ok(entries) = std::fs::read_dir(&nvm_root) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            candidates.push(p.join(format!("{tool}.cmd")));
                            candidates.push(p.join(format!("{tool}.exe")));
                        }
                    }
                }
            }
        }
        if let Some(local_appdata) = dirs::data_local_dir() {
            // volta（%LOCALAPPDATA%\Programs\Volta\bin）
            let volta_bin = local_appdata.join("Programs").join("Volta").join("bin");
            candidates.push(volta_bin.join(format!("{tool}.cmd")));
            candidates.push(volta_bin.join(format!("{tool}.exe")));
            // fnm（%LOCALAPPDATA%\fnm\aliases\default）
            let fnm_bin = local_appdata.join("fnm").join("aliases").join("default");
            candidates.push(fnm_bin.join(format!("{tool}.cmd")));
            candidates.push(fnm_bin.join(format!("{tool}.exe")));
            // pnpm 全局 bin
            let pnpm_bin = local_appdata.join("pnpm");
            candidates.push(pnpm_bin.join(format!("{tool}.cmd")));
            candidates.push(pnpm_bin.join(format!("{tool}.exe")));
        }
        // volta via HOME（~\.volta\bin）
        if !home.as_os_str().is_empty() {
            let volta_home = home.join(".volta").join("bin");
            candidates.push(volta_home.join(format!("{tool}.cmd")));
            candidates.push(volta_home.join(format!("{tool}.exe")));
            // Scoop
            let scoop_shims = home.join("scoop").join("shims");
            candidates.push(scoop_shims.join(format!("{tool}.cmd")));
            candidates.push(scoop_shims.join(format!("{tool}.exe")));
            let scoop_nodejs = home.join("scoop").join("apps").join("nodejs").join("current");
            candidates.push(scoop_nodejs.join(format!("{tool}.cmd")));
            candidates.push(scoop_nodejs.join(format!("{tool}.exe")));
            let scoop_nodejs_lts = home.join("scoop").join("apps").join("nodejs-lts").join("current");
            candidates.push(scoop_nodejs_lts.join(format!("{tool}.cmd")));
            candidates.push(scoop_nodejs_lts.join(format!("{tool}.exe")));
        }
        // C:\Program Files\nodejs（官网安装包默认路径）
        candidates.push(PathBuf::from(format!("C:\\Program Files\\nodejs\\{tool}.cmd")));
        candidates.push(PathBuf::from(format!("C:\\Program Files\\nodejs\\{tool}.exe")));
        candidates.push(PathBuf::from(format!(
            "C:\\Program Files (x86)\\nodejs\\{tool}.cmd"
        )));
        candidates.push(PathBuf::from(format!(
            "C:\\Program Files (x86)\\nodejs\\{tool}.exe"
        )));
        // 用户自定义 npm prefix（npm config set prefix <path>）
        if let Some(custom_bin) = get_npm_custom_prefix_bin() {
            candidates.push(custom_bin.join(format!("{tool}.cmd")));
            candidates.push(custom_bin.join(format!("{tool}.exe")));
        }
    }

    candidates.iter().any(|p| p.exists())
}

/// 判断事件中涉及的文件名是否匹配某个工具
fn matches_tool(file_name: &str, tool: &str) -> bool {
    file_name == tool
        || file_name == format!("{tool}.cmd")
        || file_name == format!("{tool}.exe")
}

/// 去抖检查：距上次该工具发射事件是否超过 500ms
fn should_emit(tool: &str) -> bool {
    let mut map = TOOL_DEBOUNCE.lock().unwrap();
    let now = Instant::now();
    if let Some(last) = map.get(tool) {
        if now.duration_since(*last) < Duration::from_millis(500) {
            return false;
        }
    }
    map.insert(tool.to_string(), now);
    true
}

// ── Tauri 命令 ────────────────────────────────────────────────────────────────

/// 启动 CLI 工具文件系统监听器。
/// `tools` 为需要监听的工具名列表，如 `["claude", "codex", "gemini"]`。
/// 若监听器已在运行，先停止再重新启动。
#[command]
pub async fn start_cli_watcher(app: AppHandle, tools: Vec<String>) -> Result<(), String> {
    // 先停止旧的（如果有）
    WATCHER_STOP.store(true, Ordering::Relaxed);
    // 短暂等待旧线程退出
    tokio::time::sleep(Duration::from_millis(150)).await;
    WATCHER_STOP.store(false, Ordering::Relaxed);

    // 初始化工具安装状态快照
    {
        let mut state = TOOL_INSTALL_STATE.lock().unwrap();
        state.clear();
        for tool in &tools {
            state.insert(tool.clone(), is_tool_file_present(tool));
        }
    }

    let stop_flag = WATCHER_STOP.clone();
    let tool_state = TOOL_INSTALL_STATE.clone();
    let tools_list: Vec<String> = tools.clone();

    tokio::task::spawn_blocking(move || {
        info!("[CLI Watcher] 启动监听，工具列表: {:?}", tools_list);

        let (tx, rx) = std::sync::mpsc::channel();

        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                warn!("[CLI Watcher] 创建监听器失败: {e}");
                return;
            }
        };

        let watch_dirs = get_watch_dirs();
        info!("[CLI Watcher] 监听 {} 个目录", watch_dirs.len());

        for dir in &watch_dirs {
            match watcher.watch(dir, RecursiveMode::NonRecursive) {
                Ok(_) => debug!("[CLI Watcher] 监听目录: {}", dir.display()),
                Err(e) => debug!("[CLI Watcher] 跳过目录 {}: {}", dir.display(), e),
            }
        }

        loop {
            // 用超时接收，每 100ms 检查一次停止信号
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => {
                    // 只处理文件的创建、删除、重命名
                    let relevant = matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_)
                    );
                    if !relevant {
                        continue;
                    }

                    // 提取事件路径中的文件名，检查是否匹配任一工具
                    for path in &event.paths {
                        let file_name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();

                        // 快照工具列表（避免锁争用）
                        let tools_snapshot: Vec<(String, bool)> = {
                            let state = tool_state.lock().unwrap();
                            state
                                .iter()
                                .filter(|(t, _)| matches_tool(&file_name, t))
                                .map(|(t, installed)| (t.clone(), *installed))
                                .collect()
                        };

                        for (tool, was_installed) in tools_snapshot {
                            // 实际检查文件是否存在（去除误报）
                            let now_installed = is_tool_file_present(&tool);

                            if now_installed == was_installed {
                                continue; // 状态未变
                            }

                            // 去抖：避免短时间内重复发射
                            if !should_emit(&tool) {
                                continue;
                            }

                            // 更新状态
                            {
                                let mut state = tool_state.lock().unwrap();
                                state.insert(tool.clone(), now_installed);
                            }

                            info!(
                                "[CLI Watcher] {} 状态变化: {} → {}",
                                tool,
                                if was_installed { "已安装" } else { "未安装" },
                                if now_installed { "已安装" } else { "已删除" }
                            );

                            let _ = app.emit(
                                "cli-status-changed",
                                CliStatusChangedEvent {
                                    tool: tool.clone(),
                                    installed: now_installed,
                                },
                            );
                        }
                    }
                }
                Ok(Err(e)) => {
                    debug!("[CLI Watcher] 监听错误: {e}");
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if stop_flag.load(Ordering::Relaxed) {
                        info!("[CLI Watcher] 收到停止信号，退出");
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    info!("[CLI Watcher] 监听通道断开，退出");
                    break;
                }
            }
        }
    });

    Ok(())
}

/// 停止 CLI 工具文件系统监听器
#[command]
pub async fn stop_cli_watcher() -> Result<(), String> {
    WATCHER_STOP.store(true, Ordering::Relaxed);
    info!("[CLI Watcher] 已发送停止信号");
    Ok(())
}
