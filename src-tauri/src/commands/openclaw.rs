use std::collections::HashMap;
use tauri::State;

use crate::openclaw_config;
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use log::{debug, info, warn};

// ============================================================================
// Path Helpers
// ============================================================================

/// 构建扩展的 PATH 环境变量。
///
/// GUI 应用启动时不继承用户 shell 的 PATH，需手动注入
/// Homebrew / nvm / volta / fnm / asdf / mise 等常见路径。
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
        parts.push(format!("{home_str}/Library/pnpm"));             // pnpm (macOS)
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

/// 查找 openclaw 可执行文件的绝对路径。
///
/// 依次检查常见安装位置（Homebrew、nvm、volta、npm-global…），
/// 若均未命中则回退到 `"openclaw"`（依赖 PATH）。
fn find_openclaw_bin() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.display().to_string();

    let mut candidates: Vec<String> = Vec::new();

    // nvm default alias（优先级最高）
    if !home_str.is_empty() {
        let nvm_alias = format!("{home_str}/.nvm/alias/default");
        if let Ok(ver) = std::fs::read_to_string(&nvm_alias) {
            let ver = ver.trim().trim_start_matches('v');
            if !ver.is_empty() {
                candidates.push(format!("{home_str}/.nvm/versions/node/v{ver}/bin/openclaw"));
            }
        }
        // nvm 扫描所有已安装版本
        let nvm_base = format!("{home_str}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            for entry in entries.flatten() {
                candidates.push(entry.path().join("bin/openclaw").display().to_string());
            }
        }
    }

    // 固定路径
    candidates.push("/opt/homebrew/bin/openclaw".to_string());
    candidates.push("/usr/local/bin/openclaw".to_string());
    candidates.push("/usr/bin/openclaw".to_string());

    if !home_str.is_empty() {
        candidates.push(format!("{home_str}/.npm-global/bin/openclaw"));
        candidates.push(format!("{home_str}/Library/pnpm/openclaw"));
        candidates.push(format!("{home_str}/.volta/bin/openclaw"));
        candidates.push(format!("{home_str}/.yarn/bin/openclaw"));
        candidates.push(format!("{home_str}/.local/bin/openclaw"));
    }

    candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .unwrap_or_else(|| "openclaw".to_string())
}

// ============================================================================
// OpenClaw Provider Commands (migrated from provider.rs)
// ============================================================================

/// Import providers from OpenClaw live config to database.
///
/// OpenClaw uses additive mode — users may already have providers
/// configured in openclaw.json.
#[tauri::command]
pub fn import_openclaw_providers_from_live(state: State<'_, AppState>) -> Result<usize, String> {
    crate::services::provider::import_openclaw_providers_from_live(state.inner())
        .map_err(|e| e.to_string())
}

/// Get provider IDs in the OpenClaw live config.
#[tauri::command]
pub fn get_openclaw_live_provider_ids() -> Result<Vec<String>, String> {
    openclaw_config::get_providers()
        .map(|providers| providers.keys().cloned().collect())
        .map_err(|e| e.to_string())
}

/// Get all available model IDs from models.providers.${provider}/models[*].id
/// Returns a list of "provider/model-id" strings.
#[tauri::command]
pub fn get_openclaw_provider_models() -> Result<Vec<String>, String> {
    let providers = openclaw_config::get_typed_providers().map_err(|e| e.to_string())?;
    let mut models: Vec<String> = Vec::new();
    for (provider_id, provider_config) in &providers {
        for model in &provider_config.models {
            if model.id.is_empty() {
                continue;
            }
            models.push(format!("{}/{}", provider_id, model.id));
        }
    }
    models.sort();
    Ok(models)
}

// ============================================================================
// Agents Configuration Commands
// ============================================================================

/// Get OpenClaw default model config (agents.defaults.model)
#[tauri::command]
pub fn get_openclaw_default_model() -> Result<Option<openclaw_config::OpenClawDefaultModel>, String>
{
    openclaw_config::get_default_model().map_err(|e| e.to_string())
}

/// Set OpenClaw default model config (agents.defaults.model)
#[tauri::command]
pub fn set_openclaw_default_model(
    model: openclaw_config::OpenClawDefaultModel,
) -> Result<(), String> {
    openclaw_config::set_default_model(&model).map_err(|e| e.to_string())
}

/// Get OpenClaw model catalog/allowlist (agents.defaults.models)
#[tauri::command]
pub fn get_openclaw_model_catalog(
) -> Result<Option<HashMap<String, openclaw_config::OpenClawModelCatalogEntry>>, String> {
    openclaw_config::get_model_catalog().map_err(|e| e.to_string())
}

/// Set OpenClaw model catalog/allowlist (agents.defaults.models)
#[tauri::command]
pub fn set_openclaw_model_catalog(
    catalog: HashMap<String, openclaw_config::OpenClawModelCatalogEntry>,
) -> Result<(), String> {
    openclaw_config::set_model_catalog(&catalog).map_err(|e| e.to_string())
}

/// Get full agents.defaults config (all fields)
#[tauri::command]
pub fn get_openclaw_agents_defaults(
) -> Result<Option<openclaw_config::OpenClawAgentsDefaults>, String> {
    openclaw_config::get_agents_defaults().map_err(|e| e.to_string())
}

/// Set full agents.defaults config (all fields)
#[tauri::command]
pub fn set_openclaw_agents_defaults(
    defaults: openclaw_config::OpenClawAgentsDefaults,
) -> Result<(), String> {
    openclaw_config::set_agents_defaults(&defaults).map_err(|e| e.to_string())
}

// ============================================================================
// Agent Instance Management Commands
// ============================================================================

/// 列出所有 Agent 实例
#[tauri::command]
pub fn list_agents() -> Result<Vec<openclaw_config::OpenClawAgentInfo>, String> {
    openclaw_config::list_agents().map_err(|e| e.to_string())
}

/// 创建新 Agent 实例
#[tauri::command]
pub fn add_agent(
    name: String,
    model: Option<String>,
    workspace: Option<String>,
) -> Result<(), String> {
    openclaw_config::add_agent(
        &name,
        model.as_deref(),
        workspace.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// 删除 Agent 实例
#[tauri::command]
pub fn delete_agent(id: String) -> Result<(), String> {
    openclaw_config::delete_agent(&id).map_err(|e| e.to_string())
}

/// 更新 Agent 身份信息（名称和 emoji）
#[tauri::command]
pub fn update_agent_identity(
    id: String,
    name: Option<String>,
    emoji: Option<String>,
) -> Result<(), String> {
    openclaw_config::update_agent_identity(&id, name.as_deref(), emoji.as_deref())
        .map_err(|e| e.to_string())
}

/// 更新 Agent 默认模型
#[tauri::command]
pub fn update_agent_model(id: String, model: String) -> Result<(), String> {
    openclaw_config::update_agent_model(&id, &model).map_err(|e| e.to_string())
}

/// 备份 Agent（打包为 zip，返回文件路径）
#[tauri::command]
pub async fn backup_agent(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        openclaw_config::backup_agent(&id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================================
// Env Configuration Commands
// ============================================================================

/// Get OpenClaw env config (env section of openclaw.json)
#[tauri::command]
pub fn get_openclaw_env() -> Result<openclaw_config::OpenClawEnvConfig, String> {
    openclaw_config::get_env_config().map_err(|e| e.to_string())
}

/// Set OpenClaw env config (env section of openclaw.json)
#[tauri::command]
pub fn set_openclaw_env(env: openclaw_config::OpenClawEnvConfig) -> Result<(), String> {
    openclaw_config::set_env_config(&env).map_err(|e| e.to_string())
}

// ============================================================================
// Tools Configuration Commands
// ============================================================================

/// Get OpenClaw tools config (tools section of openclaw.json)
#[tauri::command]
pub fn get_openclaw_tools() -> Result<openclaw_config::OpenClawToolsConfig, String> {
    openclaw_config::get_tools_config().map_err(|e| e.to_string())
}

/// Set OpenClaw tools config (tools section of openclaw.json)
#[tauri::command]
pub fn set_openclaw_tools(tools: openclaw_config::OpenClawToolsConfig) -> Result<(), String> {
    openclaw_config::set_tools_config(&tools).map_err(|e| e.to_string())
}

// ============================================================================
// Service Status Commands
// ============================================================================

/// Check if a process is listening on the given port; returns its PID if found.
fn check_openclaw_port_listening(port: u16) -> Option<u32> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
            .ok()?;
        if output.status.success() {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .and_then(|line| line.trim().parse::<u32>().ok())
        } else {
            None
        }
    }
    #[cfg(windows)]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano"])
            .output()
            .ok()?;
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains(&format!(":{}", port)) && line.contains("LISTENING") {
                    if let Some(pid_str) = line.split_whitespace().last() {
                        if let Ok(pid) = pid_str.parse::<u32>() {
                            return Some(pid);
                        }
                    }
                }
            }
        }
        None
    }
}

/// Check whether the OpenClaw gateway service is running (port 18789).
#[tauri::command]
pub async fn get_openclaw_service_status() -> Result<bool, String> {
    let running = check_openclaw_port_listening(18789).is_some();
    Ok(running)
}

/// Detailed OpenClaw gateway service status (running, pid, port, gateway_installed).
#[derive(serde::Serialize)]
pub struct OpenClawServiceDetail {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    /// Whether the gateway system service (launchd/systemd) is installed.
    /// None means the check could not be performed (openclaw CLI not available).
    pub gateway_installed: Option<bool>,
}

/// Check whether the openclaw gateway system service is installed.
/// Parses `openclaw gateway status` output for "Service not installed" keyword.
fn check_openclaw_gateway_installed() -> Option<bool> {
    let output = std::process::Command::new(find_openclaw_bin())
        .args(["gateway", "status"])
        .env("PATH", get_extended_path())
        .output()
        .ok()?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let lower = combined.to_lowercase();
    // "service not installed" appears when gateway install has not been run
    if lower.contains("service not installed") || lower.contains("service unit not found") {
        Some(false)
    } else {
        // Any other output (including errors) means it IS installed or we can't tell;
        // treat as installed unless we see an explicit "not installed" signal.
        Some(true)
    }
}

/// Get detailed OpenClaw gateway service status.
#[tauri::command]
pub async fn get_openclaw_service_detail() -> Result<OpenClawServiceDetail, String> {
    let pid = check_openclaw_port_listening(18789);
    let gateway_installed = tokio::task::spawn_blocking(check_openclaw_gateway_installed)
        .await
        .unwrap_or(None);
    Ok(OpenClawServiceDetail {
        running: pid.is_some(),
        pid,
        port: 18789,
        gateway_installed,
    })
}

/// Install the openclaw gateway system service (launchd/systemd).
/// Runs `openclaw gateway install` which registers the service so it can be managed.
#[tauri::command]
pub async fn install_openclaw_gateway() -> Result<String, String> {
    info!("[OpenClaw] 执行 openclaw gateway install ...");
    tokio::task::spawn_blocking(|| {
        let output = std::process::Command::new(find_openclaw_bin())
            .args(["gateway", "install"])
            .env("PATH", get_extended_path())
            .output()
            .map_err(|e| format!("执行 openclaw gateway install 失败: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if output.status.success() {
            Ok(if stdout.trim().is_empty() { "网关服务已安装".to_string() } else { stdout.trim().to_string() })
        } else {
            Err(format!("gateway install 失败: {}", stderr.trim()))
        }
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

/// Get all PIDs listening on the given port.
fn get_openclaw_pids_on_port(port: u16) -> Vec<u32> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter_map(|line| line.trim().parse::<u32>().ok())
                    .collect()
            }
            _ => vec![],
        }
    }
    #[cfg(windows)]
    {
        let output = std::process::Command::new("netstat")
            .args(["-ano"])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter(|line| line.contains(&format!(":{}", port)) && line.contains("LISTENING"))
                    .filter_map(|line| line.split_whitespace().last())
                    .filter_map(|pid_str| pid_str.parse::<u32>().ok())
                    .collect()
            }
            _ => vec![],
        }
    }
}

/// Kill a process by PID. `force` uses SIGKILL on Unix.
fn kill_openclaw_process(pid: u32, force: bool) -> bool {
    #[cfg(unix)]
    {
        let signal = if force { "-9" } else { "-TERM" };
        std::process::Command::new("kill")
            .args([signal, &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("taskkill");
        if force {
            cmd.args(["/F", "/PID", &pid.to_string()]);
        } else {
            cmd.args(["/PID", &pid.to_string()]);
        }
        cmd.output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Read the last `n` lines from ~/.openclaw/logs/gateway.err.log.
/// Returns an empty string if the file does not exist or cannot be read.
fn read_gateway_err_log_tail(n: usize) -> String {
    let log_path = openclaw_config::get_openclaw_dir()
        .join("logs")
        .join("gateway.err.log");
    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return String::new(),
    };
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return String::new();
    }
    let start = if lines.len() > n { lines.len() - n } else { 0 };
    lines[start..].join("\n")
}

/// Start the OpenClaw gateway service in the background.
/// If ~/.openclaw/openclaw.json does not exist, runs `openclaw onboard --non-interactive --accept-risk` first.
/// Polls port 18789 for up to 15 seconds waiting for the service to start.
#[tauri::command]
pub async fn start_openclaw_service() -> Result<String, String> {
    info!("[OpenClaw] 执行 openclaw gateway start --port 18789 ...");
    // Already running?
    if check_openclaw_port_listening(18789).is_some() {
        info!("[OpenClaw] 服务已在运行中，跳过启动");
        return Err("服务已在运行中".to_string());
    }

    // 检查配置文件是否存在，不存在则先执行 onboard 初始化
    let config_path = openclaw_config::get_openclaw_config_path();
    if !config_path.exists() {
        info!("[OpenClaw] 配置文件不存在，执行 openclaw onboard --non-interactive --accept-risk 进行初始化...");
        let onboard_output = std::process::Command::new(find_openclaw_bin())
            .args(["onboard", "--non-interactive", "--accept-risk"])
            .env("PATH", get_extended_path())
            .output()
            .map_err(|e| {
                let msg = format!("执行 openclaw onboard 失败：{}", e);
                warn!("[OpenClaw] {}", msg);
                msg
            })?;
        let onboard_stdout = String::from_utf8_lossy(&onboard_output.stdout).to_string();
        let onboard_stderr = String::from_utf8_lossy(&onboard_output.stderr).to_string();
        info!("[OpenClaw] onboard stdout: {}", onboard_stdout.trim());
        if !onboard_stderr.trim().is_empty() {
            warn!("[OpenClaw] onboard stderr: {}", onboard_stderr.trim());
        }
        if !onboard_output.status.success() {
            let msg = format!("初始化失败（openclaw onboard）：{}", onboard_stderr.trim());
            warn!("[OpenClaw] {}", msg);
            return Err(msg);
        }
        info!("[OpenClaw] ✅ openclaw onboard 初始化完成");
    }

    // 确保 gateway.mode 已配置（避免 launchd 重启时被阻塞）
    let config_set_output = std::process::Command::new(find_openclaw_bin())
        .args(["config", "set", "gateway.mode", "local"])
        .env("PATH", get_extended_path())
        .output();
    match config_set_output {
        Ok(o) => info!("[OpenClaw] config set gateway.mode local exit code: {:?}", o.status.code()),
        Err(e) => warn!("[OpenClaw] config set gateway.mode local 失败（可忽略）: {}", e),
    }

    // Use official CLI command: openclaw gateway start
    let output = std::process::Command::new(find_openclaw_bin())
        .args(["gateway", "start", "--port", "18789", "--allow-unconfigured"])
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| {
            let msg = format!("启动服务失败：{}", e);
            warn!("[OpenClaw] {}", msg);
            msg
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    info!("[OpenClaw] gateway start stdout: {}", stdout.trim());
    if !stderr.trim().is_empty() {
        warn!("[OpenClaw] gateway start stderr: {}", stderr.trim());
    }
    info!("[OpenClaw] gateway start exit code: {:?}", output.status.code());

    if !output.status.success() {
        let msg = format!("启动服务失败：{}", stderr.trim());
        warn!("[OpenClaw] {}", msg);
        return Err(msg);
    }

    // Poll until port is listening (up to 15 seconds)
    for i in 1..=15u32 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Some(pid) = check_openclaw_port_listening(18789) {
            let msg = format!("服务已启动 ({}秒), PID: {}", i, pid);
            info!("[OpenClaw] ✅ {}", msg);
            return Ok(msg);
        }
        info!("[OpenClaw] 等待服务启动... ({}/15)", i);
    }

    // 超时后读取 gateway.err.log 最后几行，拼入错误信息
    let err_hint = read_gateway_err_log_tail(5);
    let msg = if err_hint.is_empty() {
        "服务启动超时（15 秒），请检查 openclaw 日志".to_string()
    } else {
        format!("服务启动超时（15 秒）\n\n网关错误日志：\n{}", err_hint)
    };
    warn!("[OpenClaw] ❌ {}", msg);
    Err(msg)
}

/// Stop the OpenClaw gateway service using official CLI command.
#[tauri::command]
pub async fn stop_openclaw_service() -> Result<String, String> {
    info!("[OpenClaw] 执行 openclaw gateway stop --port 18789 ...");
    // Check if service is running
    if check_openclaw_port_listening(18789).is_none() {
        info!("[OpenClaw] 服务未在运行，无需停止");
        return Ok("服务未在运行".to_string());
    }

    // Use official CLI command: openclaw gateway stop
    let output = std::process::Command::new(find_openclaw_bin())
        .args(["gateway", "stop", "--port", "18789"])
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| {
            let msg = format!("停止服务失败：{}", e);
            warn!("[OpenClaw] {}", msg);
            msg
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    info!("[OpenClaw] gateway stop stdout: {}", stdout.trim());
    if !stderr.trim().is_empty() {
        warn!("[OpenClaw] gateway stop stderr: {}", stderr.trim());
    }
    info!("[OpenClaw] gateway stop exit code: {:?}", output.status.code());

    if !output.status.success() {
        let msg = format!("停止服务失败：{}", stderr.trim());
        warn!("[OpenClaw] {}", msg);
        return Err(msg);
    }

    // Wait for port to be released (up to 5 seconds)
    for _ in 1..=5u32 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if check_openclaw_port_listening(18789).is_none() {
            return Ok("服务已停止".to_string());
        }
    }

    // If still running after timeout, force kill as fallback
    warn!("[OpenClaw] gateway stop 超时，尝试强制 kill 进程...");
    let pids = get_openclaw_pids_on_port(18789);
    info!("[OpenClaw] 需要强制 kill 的 PID 列表: {:?}", pids);
    for &pid in &pids {
        let killed = kill_openclaw_process(pid, true);
        info!("[OpenClaw] kill PID {} 结果: {}", pid, killed);
    }
    std::thread::sleep(std::time::Duration::from_secs(1));

    if check_openclaw_port_listening(18789).is_none() {
        info!("[OpenClaw] ✅ 服务已停止（强制 kill）");
        Ok("服务已停止".to_string())
    } else {
        warn!("[OpenClaw] ❌ 无法停止服务，请手动检查进程");
        Err("无法停止服务，请手动检查进程".to_string())
    }
}

/// Restart the OpenClaw gateway service using official CLI command.
#[tauri::command]
pub async fn restart_openclaw_service() -> Result<String, String> {
    info!("[OpenClaw] 执行 openclaw gateway restart --port 18789 ...");
    // 确保 gateway.mode 已配置（避免 launchd 重启时被阻塞）
    let config_set_output = std::process::Command::new(find_openclaw_bin())
        .args(["config", "set", "gateway.mode", "local"])
        .env("PATH", get_extended_path())
        .output();
    match config_set_output {
        Ok(o) => info!("[OpenClaw] config set gateway.mode local exit code: {:?}", o.status.code()),
        Err(e) => warn!("[OpenClaw] config set gateway.mode local 失败（可忽略）: {}", e),
    }
    // Use official CLI command: openclaw gateway restart
    let output = std::process::Command::new(find_openclaw_bin())
        .args(["gateway", "restart", "--port", "18789", "--allow-unconfigured"])
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| {
            let msg = format!("重启服务失败：{}", e);
            warn!("[OpenClaw] {}", msg);
            msg
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    info!("[OpenClaw] gateway restart stdout: {}", stdout.trim());
    if !stderr.trim().is_empty() {
        warn!("[OpenClaw] gateway restart stderr: {}", stderr.trim());
    }
    info!("[OpenClaw] gateway restart exit code: {:?}", output.status.code());

    if !output.status.success() {
        let msg = format!("重启服务失败：{}", stderr.trim());
        warn!("[OpenClaw] {}", msg);
        return Err(msg);
    }

    // Poll until port is listening (up to 15 seconds)
    for i in 1..=15u32 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Some(pid) = check_openclaw_port_listening(18789) {
            let msg = format!("服务已重启 ({}秒), PID: {}", i, pid);
            info!("[OpenClaw] ✅ {}", msg);
            return Ok(msg);
        }
        info!("[OpenClaw] 等待服务重启... ({}/15)", i);
    }

    let msg = "服务重启超时（15 秒），请检查 openclaw 日志".to_string();
    warn!("[OpenClaw] ❌ {}", msg);
    Err(msg)
}

// ============================================================================
// System Diagnostic (aligned with openclaw-manager 测试诊断)
// ============================================================================

/// Result of running OpenClaw system diagnostic (Node.js, config, gateway service).
#[derive(serde::Serialize)]
pub struct OpenClawDiagnosticResult {
    pub config_exists: bool,
    pub config_path: String,
    pub service_running: bool,
    pub port: u16,
}

/// Run system diagnostic: check OpenClaw config file and gateway service status.
#[tauri::command]
pub async fn run_openclaw_diagnostic() -> Result<OpenClawDiagnosticResult, String> {
    let config_path = openclaw_config::get_openclaw_config_path();
    let config_exists = config_path.exists();
    let config_path_str = config_path.to_string_lossy().to_string();
    let service_running = check_openclaw_port_listening(18789).is_some();
    Ok(OpenClawDiagnosticResult {
        config_exists,
        config_path: config_path_str,
        service_running,
        port: 18789,
    })
}

// ============================================================================
// openclaw onboard（打开 Web 管理界面）
// ============================================================================

/// 执行 `openclaw dashboard` 命令，在浏览器中打开 OpenClaw Web 管理界面。
#[tauri::command]
pub async fn openclaw_onboard() -> Result<String, String> {
    info!("[OpenClaw] 执行 openclaw dashboard ...");
    // run_openclaw_cmd 是同步的，spawn_blocking 避免阻塞异步运行时
    tokio::task::spawn_blocking(|| run_openclaw_cmd(&["dashboard"]))
        .await
        .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================================
// run_doctor（与 openclaw-manager 诊断能力对齐）
// ============================================================================

/// 单项诊断结果（与 openclaw-manager DiagnosticResult 结构一致）
#[derive(serde::Serialize)]
pub struct DoctorItem {
    pub name: String,
    pub passed: bool,
    /// "error" | "warning" | "info"，未通过时区分严重程度
    pub severity: String,
    pub message: String,
    pub suggestion: Option<String>,
}

/// 运行完整系统诊断，返回逐项结果（对齐 openclaw-manager run_doctor）
#[tauri::command]
pub async fn run_doctor() -> Result<Vec<DoctorItem>, String> {
    let mut results: Vec<DoctorItem> = Vec::new();

    // 1. 检查 OpenClaw 是否安装
    // find_openclaw_bin() 返回 "openclaw" 表示未找到具体路径，需额外用 `which` 验证
    let openclaw_bin = find_openclaw_bin();
    let openclaw_installed = openclaw_bin != "openclaw"
        || std::process::Command::new("which")
            .arg("openclaw")
            .env("PATH", get_extended_path())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    results.push(DoctorItem {
        name: "OpenClaw 安装".to_string(),
        passed: openclaw_installed,
        severity: if openclaw_installed { "info".to_string() } else { "error".to_string() },
        message: if openclaw_installed {
            "OpenClaw 已安装".to_string()
        } else {
            "OpenClaw 未安装".to_string()
        },
        suggestion: if openclaw_installed {
            None
        } else {
            Some("运行：npm install -g openclaw".to_string())
        },
    });

    // 2. 检查 Node.js（需要 >= 22）
    let node_result = std::process::Command::new("node")
        .arg("--version")
        .output();
    let node_installed = node_result.as_ref().map(|o| o.status.success()).unwrap_or(false);
    let node_version_str = node_result
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "未安装".to_string());
    // 解析主版本号，如 "v22.1.0" -> 22
    let node_major: Option<u32> = if node_installed {
        node_version_str
            .trim_start_matches('v')
            .split('.')
            .next()
            .and_then(|s| s.parse().ok())
    } else {
        None
    };
    let node_ok = node_major.map(|v| v >= 22).unwrap_or(false);
    // Node.js 版本过低为 warning（还能运行，但可能有兼容问题），未安装才是 error
    let node_severity = if node_ok {
        "info"
    } else if node_installed {
        "warning"
    } else {
        "error"
    };
    let (node_msg, node_suggestion) = match node_major {
        None => (
            "Node.js 未安装".to_string(),
            Some("请安装 Node.js 22+: https://nodejs.org".to_string()),
        ),
        Some(_v) if !node_ok => (
            format!("Node.js {} 版本不满足要求（需 v22+）", node_version_str),
            Some("请升级到 Node.js 22+: https://nodejs.org".to_string()),
        ),
        Some(_) => (
            format!("Node.js {} ✓", node_version_str),
            None,
        ),
    };
    results.push(DoctorItem {
        name: "Node.js".to_string(),
        passed: node_ok,
        severity: node_severity.to_string(),
        message: node_msg,
        suggestion: node_suggestion,
    });

    // 3. 检查配置文件
    let config_path = openclaw_config::get_openclaw_config_path();
    let config_exists = config_path.exists();
    results.push(DoctorItem {
        name: "配置文件".to_string(),
        passed: config_exists,
        severity: if config_exists { "info".to_string() } else { "error".to_string() },
        message: if config_exists {
            format!("配置文件存在：{}", config_path.display())
        } else {
            "配置文件不存在".to_string()
        },
        suggestion: if config_exists { None } else { Some("运行 openclaw 初始化配置".to_string()) },
    });

    // 4. 检查环境变量文件（~/.openclaw/.env），并校验是否有非空的 API Key
    // 已跳过此检查项
    // let env_path = openclaw_config::get_openclaw_dir().join(".env");
    // let env_exists = env_path.exists();
    // let (env_passed, env_msg, env_suggestion) = if !env_exists {
    //     (
    //         false,
    //         "环境变量文件不存在".to_string(),
    //         Some("请前往「环境变量」页面配置 AI API Key".to_string()),
    //     )
    // } else {
    //     // 读取文件内容，检查是否有非空的 *_API_KEY= 或 *_KEY= 条目
    //     let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    //     let has_valid_key = content.lines().any(|line| {
    //         let line = line.trim();
    //         // 跳过注释行
    //         if line.starts_with('#') || line.is_empty() {
    //             return false;
    //         }
    //         // 匹配形如 export ANTHROPIC_API_KEY="sk-..." 或 OPENAI_API_KEY=sk-...
    //         let stripped = line
    //             .strip_prefix("export ")
    //             .unwrap_or(line);
    //         if let Some(eq_pos) = stripped.find('=') {
    //             let key_name = stripped[..eq_pos].trim().to_uppercase();
    //             let value = stripped[eq_pos + 1..]
    //                 .trim()
    //                 .trim_matches('"')
    //                 .trim_matches('\'');
    //             // 键名含 KEY / TOKEN / SECRET 且值非空（排除占位符）
    //             let is_credential = key_name.contains("KEY")
    //                 || key_name.contains("TOKEN")
    //                 || key_name.contains("SECRET");
    //             let is_placeholder = value == "your_api_key_here"
    //                 || value == "<your-api-key>"
    //                 || value == "PLACEHOLDER"
    //                 || value.starts_with("<");
    //             is_credential && !value.is_empty() && !is_placeholder
    //         } else {
    //             false
    //         }
    //     });
    //     if has_valid_key {
    //         (
    //             true,
    //             format!("环境变量文件存在且已配置 API Key: {}", env_path.display()),
    //             None,
    //         )
    //     } else {
    //         (
    //             false,
    //             format!("环境变量文件存在但未找到有效 API Key: {}", env_path.display()),
    //             Some("请前往「环境变量」页面配置 AI API Key".to_string()),
    //         )
    //     }
    // };
    // results.push(DoctorItem {
    //     name: "环境变量".to_string(),
    //     passed: env_passed,
    //     severity: if env_passed { "info".to_string() } else { "error".to_string() },
    //     message: env_msg,
    //     suggestion: env_suggestion,
    // });

    // 5. 检查网关服务（端口 18789）
    let service_running = check_openclaw_port_listening(18789).is_some();
    results.push(DoctorItem {
        name: "网关服务".to_string(),
        passed: service_running,
        severity: if service_running { "info".to_string() } else { "error".to_string() },
        message: if service_running {
            "网关服务运行中 (端口 18789)".to_string()
        } else {
            "网关服务未运行".to_string()
        },
        suggestion: if service_running { None } else { Some("运行：openclaw gateway start".to_string()) },
    });

    // 6. 检查 Provider 配置（openclaw.json models.providers）
    let provider_check = openclaw_config::get_typed_providers();
    match provider_check {
        Ok(providers) => {
            let count = providers.len();
            // 统计有效 provider（baseUrl 和 apiKey 均非空）
            let valid_count = providers.values().filter(|p| {
                let has_url = p.base_url.as_ref().map(|u| !u.trim().is_empty()).unwrap_or(false);
                let has_key = p.api_key.as_ref().map(|k| !k.trim().is_empty()).unwrap_or(false);
                has_url && has_key
            }).count();
            if count == 0 {
                results.push(DoctorItem {
                    name: "供应商配置".to_string(),
                    passed: false,
                    severity: "error".to_string(),
                    message: "未配置任何 AI 供应商".to_string(),
                    suggestion: Some("请前往「供应商配置」页面添加 AI Provider".to_string()),
                });
            } else if valid_count == 0 {
                results.push(DoctorItem {
                    name: "供应商配置".to_string(),
                    passed: false,
                    severity: "error".to_string(),
                    message: format!("已有 {} 个供应商但均缺少 Base URL 或 API Key", count),
                    suggestion: Some("请前往「供应商配置」页面完善 API Key 和 Base URL".to_string()),
                });
            } else {
                results.push(DoctorItem {
                    name: "供应商配置".to_string(),
                    passed: true,
                    severity: "info".to_string(),
                    message: format!("已配置 {} 个供应商（{} 个完整配置）", count, valid_count),
                    suggestion: None,
                });
            }
        }
        Err(_) => {
            results.push(DoctorItem {
                name: "供应商配置".to_string(),
                passed: false,
                severity: "error".to_string(),
                message: "读取供应商配置失败（配置文件可能损坏）".to_string(),
                suggestion: Some("请检查 ~/.openclaw/openclaw.json 文件是否有效".to_string()),
            });
        }
    }

    // 7. 运行 openclaw doctor（只读诊断，不含 --fix）
    // 使用 spawn_blocking 避免阻塞 tokio 异步线程，防止后续 reqwest 健康探测超时
    if openclaw_installed {
        let openclaw_bin_clone = openclaw_bin.clone();
        let doctor_result = tokio::task::spawn_blocking(move || {
            std::process::Command::new(&openclaw_bin_clone)
                .arg("doctor")
                .env("PATH", get_extended_path())
                .output()
        })
        .await
        .map_err(|e| format!("spawn_blocking 失败: {}", e))?;
        match doctor_result {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let combined = format!("{}{}", stdout, stderr).to_lowercase();
                // 退出码非 0，或输出含明确错误关键词，视为失败
                let exit_ok = out.status.success();
                let keyword_ok = !combined.contains("invalid")
                    && !combined.contains("✗")
                    && !combined.contains("failed");
                let passed = exit_ok && keyword_ok;
                let message = if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                    stderr.trim().to_string()
                } else {
                    stdout.trim().to_string()
                };
                results.push(DoctorItem {
                    name: "OpenClaw Doctor".to_string(),
                    passed,
                    severity: if passed { "info".to_string() } else { "error".to_string() },
                    message,
                    suggestion: if passed { None } else {
                        Some("运行：openclaw doctor --fix 尝试自动修复".to_string())
                    },
                });
            }
            Err(e) => {
                results.push(DoctorItem {
                    name: "OpenClaw Doctor".to_string(),
                    passed: false,
                    severity: "error".to_string(),
                    message: format!("执行 openclaw doctor 失败：{}", e),
                    suggestion: Some("运行：openclaw doctor --fix 尝试自动修复".to_string()),
                });
            }
        }
    }

    // =========================================================================
    // 8. ~/.openclaw 目录读写权限检查
    // =========================================================================
    let openclaw_dir = openclaw_config::get_openclaw_dir();
    if openclaw_dir.exists() {
        // 尝试在目录中创建临时文件，验证写权限
        let test_file = openclaw_dir.join(".claw_switch_perm_test");
        let write_ok = std::fs::write(&test_file, b"test")
            .map(|_| { let _ = std::fs::remove_file(&test_file); true })
            .unwrap_or(false);
        let read_ok = std::fs::read_dir(&openclaw_dir).is_ok();
        let perm_passed = read_ok && write_ok;
        results.push(DoctorItem {
            name: "目录权限".to_string(),
            passed: perm_passed,
            severity: if perm_passed { "info".to_string() } else { "warning".to_string() },
            message: if perm_passed {
                format!("~/.openclaw 目录读写权限正常：{}", openclaw_dir.display())
            } else if !read_ok {
                format!("~/.openclaw 目录无读取权限：{}", openclaw_dir.display())
            } else {
                format!("~/.openclaw 目录无写入权限：{}", openclaw_dir.display())
            },
            suggestion: if perm_passed { None } else {
                Some(format!("运行：chmod 755 {}", openclaw_dir.display()))
            },
        });
    } else {
        // 目录不存在时跳过此检查（由配置文件检查项负责报错）
        results.push(DoctorItem {
            name: "目录权限".to_string(),
            passed: false,
            severity: "warning".to_string(),
            message: format!("~/.openclaw 目录不存在：{}", openclaw_dir.display()),
            suggestion: Some("运行 openclaw 以自动创建配置目录".to_string()),
        });
    }

    // =========================================================================
    // 9. JSON 语法验证 + 配置冲突检测（allowlist 策略但 allowFrom 为空）
    // =========================================================================
    if config_exists {
        let raw_content = std::fs::read_to_string(&config_path).unwrap_or_default();
        // 9a. JSON5 语法验证
        match json5::from_str::<serde_json::Value>(&raw_content) {
            Err(parse_err) => {
                results.push(DoctorItem {
                    name: "配置文件语法".to_string(),
                    passed: false,
                    severity: "error".to_string(),
                    message: format!("配置文件 JSON 语法错误：{}", parse_err),
                    suggestion: Some("请检查并修复 ~/.openclaw/openclaw.json 的 JSON 语法".to_string()),
                });
            }
            Ok(parsed) => {
                results.push(DoctorItem {
                    name: "配置文件语法".to_string(),
                    passed: true,
                    severity: "info".to_string(),
                    message: "配置文件 JSON 语法正确".to_string(),
                    suggestion: None,
                });

                // 9b. 配置冲突：allowlist 策略 + allowFrom 为空
                // gateway.auth.allowFrom / gateway.allowFrom 模式
                let gw = parsed.get("gateway");
                let policy = gw
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("policy").or_else(|| a.get("mode")))
                    .or_else(|| gw.and_then(|g| g.get("policy")))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let allow_from = gw
                    .and_then(|g| g.get("auth"))
                    .and_then(|a| a.get("allowFrom"))
                    .or_else(|| gw.and_then(|g| g.get("allowFrom")));
                let allow_from_empty = match allow_from {
                    None => true,
                    Some(serde_json::Value::Array(arr)) => arr.is_empty(),
                    Some(serde_json::Value::String(s)) => s.trim().is_empty(),
                    _ => false,
                };
                if policy == "allowlist" && allow_from_empty {
                    results.push(DoctorItem {
                        name: "配置冲突检测".to_string(),
                        passed: false,
                        severity: "warning".to_string(),
                        message: "gateway.auth.policy 为 allowlist 但 allowFrom 为空，将导致所有请求被拒绝".to_string(),
                        suggestion: Some("在 gateway.auth.allowFrom 中添加允许的来源，或将 policy 改为 none/token".to_string()),
                    });
                } else {
                    results.push(DoctorItem {
                        name: "配置冲突检测".to_string(),
                        passed: true,
                        severity: "info".to_string(),
                        message: "未发现明显配置冲突".to_string(),
                        suggestion: None,
                    });
                }
            }
        }
    }

    // =========================================================================
    // 10. 网关健康端点探测（仅在服务运行时执行）
    // =========================================================================
    if service_running {
        let endpoints = ["/health", "/"];
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .no_proxy()  // 跳过系统代理，直连本地网关
            .build()
            .unwrap_or_default();
        let mut health_passed = false;
        let mut health_msg = String::new();
        let mut last_err = String::new();
        for ep in &endpoints {
            let url = format!("http://127.0.0.1:18789{}", ep);
            info!("[Doctor] 探测健康端点: {}", url);
            match client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    info!("[Doctor] 健康端点 {} 返回 HTTP {}", url, status);
                    // 502/503/504 也视为网关本身可达（上游问题不代表网关未启动）
                    if status < 500 {
                        health_passed = true;
                        health_msg = format!("网关健康端点可达 ({}{}, HTTP {})", "http://127.0.0.1:18789", ep, status);
                        break;
                    } else {
                        last_err = format!("HTTP {}", status);
                    }
                }
                Err(e) => {
                    warn!("[Doctor] 健康端点 {} 请求失败: {}", url, e);
                    last_err = e.to_string();
                    continue;
                }
            }
        }
        if !health_passed {
            health_msg = format!(
                "网关端口开放但健康端点无响应（可能服务尚未完全初始化）: {}",
                last_err
            );
            warn!("[Doctor] 健康端点探测失败: {}", last_err);
        }
        results.push(DoctorItem {
            name: "网关健康端点".to_string(),
            passed: health_passed,
            severity: if health_passed { "info".to_string() } else { "warning".to_string() },
            message: health_msg,
            suggestion: if health_passed { None } else {
                Some("请检查网关服务是否完全启动，或尝试重启网关".to_string())
            },
        });
    }

    Ok(results)
}

// ============================================================================
// run_doctor_fix（执行 openclaw doctor --repair --yes 自动修复）
// ============================================================================

/// 修复结果
#[derive(serde::Serialize)]
pub struct DoctorFixResult {
    pub success: bool,
    pub output: String,
}

/// 运行 `openclaw doctor --repair --yes`，自动修复已知问题（非交互式）。
/// 修复完成后调用方应重启网关服务并重新诊断。
#[tauri::command]
pub async fn run_doctor_fix() -> Result<DoctorFixResult, String> {
    info!("[OpenClaw] 执行 openclaw doctor --repair --yes ...");
    tokio::task::spawn_blocking(|| {
        let result = std::process::Command::new(find_openclaw_bin())
            .args(["doctor", "--repair", "--yes"])
            .env("PATH", get_extended_path())
            .output();
        match result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let combined = if stderr.is_empty() {
                    stdout.clone()
                } else {
                    format!("{}
{}", stdout, stderr)
                };
                Ok(DoctorFixResult {
                    success: output.status.success(),
                    output: combined.trim().to_string(),
                })
            }
            Err(e) => Err(format!("执行 openclaw doctor --repair --yes 失败: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))?
}

// ============================================================================
// Channel Configuration Commands
// ============================================================================

/// Channel configuration entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawChannelConfig {
    pub id: String,
    pub channel_type: String,
    pub enabled: bool,
    pub config: HashMap<String, Value>,
}

/// Feishu plugin status
#[derive(Debug, Serialize, Deserialize)]
pub struct FeishuPluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub plugin_name: Option<String>,
}

/// DingTalk plugin status
#[derive(Debug, Serialize, Deserialize)]
pub struct DingTalkPluginStatus {
    pub installed: bool,
    pub needs_reinstall: bool, // spec != "@soimy/dingtalk"
    pub spec: Option<String>,  // current installs.dingtalk.spec
    pub version: Option<String>,
}

/// Channel test result
#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelTestResult {
    pub success: bool,
    pub channel: String,
    pub message: String,
    pub error: Option<String>,
}

/// Helper: get openclaw config as JSON Value
///
/// 使用 JSON5 解析，支持尾随逗号（trailing comma）和注释
fn load_openclaw_config_json() -> Result<Value, String> {
    let config_path = openclaw_config::get_openclaw_config_path();
    if !config_path.exists() {
        return Ok(json!({}));
    }
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    // 使用 JSON5 解析，兼容尾随逗号、注释等 JSON5 特性
    json5::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))
}

/// Helper: save openclaw config as JSON Value
///
/// 复用统一的原子写入逻辑，写入标准 JSON 格式（无尾随逗号）
fn save_openclaw_config_json(config: &Value) -> Result<(), String> {
    openclaw_config::write_openclaw_config(config)
        .map_err(|e| format!("写入配置文件失败: {}", e))
}

/// Helper: get openclaw env file path (~/.openclaw/env)
fn get_openclaw_env_file_path() -> String {
    openclaw_config::get_openclaw_dir()
        .join("env")
        .to_string_lossy()
        .to_string()
}

/// Helper: read a value from the openclaw env file
fn read_env_value(env_file: &str, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(env_file).ok()?;
    for line in content.lines() {
        let line = line.trim();
        let prefix = format!("export {}=", key);
        if line.starts_with(&prefix) {
            let value = line
                .trim_start_matches(&prefix)
                .trim_matches('"')
                .trim_matches('\'');
            return Some(value.to_string());
        }
    }
    None
}

/// Helper: set a value in the openclaw env file
fn set_env_value(env_file: &str, key: &str, value: &str) -> std::io::Result<()> {
    let content = std::fs::read_to_string(env_file).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let new_line = format!("export {}=\"{}\"", key, value);
    let mut found = false;
    for line in &mut lines {
        let prefix = format!("export {}=", key);
        if line.starts_with(&prefix) {
            *line = new_line.clone();
            found = true;
            break;
        }
    }
    if !found {
        lines.push(new_line);
    }
    // ensure parent dir
    if let Some(parent) = std::path::Path::new(env_file).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(env_file, lines.join("\n"))
}

/// Helper: remove a value from the openclaw env file
fn remove_env_value(env_file: &str, key: &str) -> std::io::Result<()> {
    let content = std::fs::read_to_string(env_file).unwrap_or_default();
    let prefix = format!("export {}=", key);
    let lines: Vec<String> = content
        .lines()
        .filter(|line| !line.starts_with(&prefix))
        .map(|s| s.to_string())
        .collect();
    std::fs::write(env_file, lines.join("\n"))
}

/// Helper: execute an openclaw CLI command and return stdout
fn run_openclaw_cmd(args: &[&str]) -> Result<String, String> {
    debug!("[渠道] 执行 openclaw 命令: {:?}", args);

    let output = std::process::Command::new(find_openclaw_bin())
        .args(args)
        .env("PATH", get_extended_path())
        .output()
        .map_err(|e| format!("执行 openclaw 失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stdout)
    } else {
        Err(format!("{}", stderr.trim()))
    }
}

/// Get all channel configs from openclaw.json
#[tauri::command]
pub async fn get_openclaw_channels_config() -> Result<Vec<OpenClawChannelConfig>, String> {
    info!("[渠道配置] 获取渠道配置列表...");

    let config = load_openclaw_config_json()?;
    let channels_obj = config.get("channels").cloned().unwrap_or(json!({}));
    let env_path = get_openclaw_env_file_path();

    let mut channels = Vec::new();

    let channel_types: Vec<(&str, &str, Vec<&str>)> = vec![
        ("telegram", "telegram", vec!["userId"]),
        ("discord", "discord", vec!["testChannelId"]),
        ("slack", "slack", vec!["testChannelId"]),
        ("feishu", "feishu", vec!["testChatId"]),
        ("whatsapp", "whatsapp", vec![]),
        ("imessage", "imessage", vec![]),
        ("wechat", "wechat", vec![]),
        ("dingtalk", "dingtalk", vec![]),
    ];

    for (channel_id, channel_type, test_fields) in channel_types {
        let channel_config = channels_obj.get(channel_id);

        let enabled = channel_config
            .and_then(|c| c.get("enabled"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut config_map: HashMap<String, Value> = if let Some(cfg) = channel_config {
            if let Some(obj) = cfg.as_object() {
                obj.iter()
                    .filter(|(k, _)| *k != "enabled")
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        for field in test_fields {
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel_id.to_uppercase(),
                field.to_uppercase()
            );
            if let Some(value) = read_env_value(&env_path, &env_key) {
                config_map.insert(field.to_string(), json!(value));
            }
        }

        let has_config = !config_map.is_empty() || enabled;

        channels.push(OpenClawChannelConfig {
            id: channel_id.to_string(),
            channel_type: channel_type.to_string(),
            enabled: has_config,
            config: config_map,
        });
    }

    info!("[渠道配置] ✓ 返回 {} 个渠道配置", channels.len());
    Ok(channels)
}

/// Save a single channel config to openclaw.json
#[tauri::command]
pub async fn save_openclaw_channel_config(
    channel: OpenClawChannelConfig,
) -> Result<String, String> {
    info!(
        "[保存渠道配置] 保存渠道配置: {} ({})",
        channel.id, channel.channel_type
    );

    let mut config = load_openclaw_config_json()?;
    let env_path = get_openclaw_env_file_path();

    if config.get("channels").is_none() {
        config["channels"] = json!({});
    }
    if config.get("plugins").is_none() {
        config["plugins"] = json!({ "allow": [], "entries": {} });
    }
    if config["plugins"].get("allow").is_none() {
        config["plugins"]["allow"] = json!([]);
    }
    if config["plugins"].get("entries").is_none() {
        config["plugins"]["entries"] = json!({});
    }

    let test_only_fields = ["userId", "testChatId", "testChannelId"];

    let mut channel_obj = json!({ "enabled": true });

    for (key, value) in &channel.config {
        if test_only_fields.contains(&key.as_str()) {
            let env_key = format!(
                "OPENCLAW_{}_{}",
                channel.id.to_uppercase(),
                key.to_uppercase()
            );
            if let Some(val_str) = value.as_str() {
                let _ = set_env_value(&env_path, &env_key, val_str);
            }
        } else {
            channel_obj[key] = value.clone();
        }
    }

    config["channels"][&channel.id] = channel_obj;

    if let Some(allow_arr) = config["plugins"]["allow"].as_array_mut() {
        let channel_id_val = json!(&channel.id);
        if !allow_arr.contains(&channel_id_val) {
            allow_arr.push(channel_id_val);
        }
    }

    config["plugins"]["entries"][&channel.id] = json!({ "enabled": true });

    save_openclaw_config_json(&config)?;
    info!("[保存渠道配置] ✓ {} 配置保存成功", channel.channel_type);
    Ok(format!("{} 配置已保存", channel.channel_type))
}

/// Clear a single channel config from openclaw.json
#[tauri::command]
pub async fn clear_openclaw_channel_config(channel_id: String) -> Result<String, String> {
    info!("[清空渠道配置] 清空渠道配置: {}", channel_id);

    let mut config = load_openclaw_config_json()?;
    let env_path = get_openclaw_env_file_path();

    if let Some(channels) = config.get_mut("channels").and_then(|v| v.as_object_mut()) {
        channels.remove(&channel_id);
    }
    if let Some(allow_arr) = config
        .pointer_mut("/plugins/allow")
        .and_then(|v| v.as_array_mut())
    {
        allow_arr.retain(|v| v.as_str() != Some(&channel_id));
    }
    if let Some(entries) = config
        .pointer_mut("/plugins/entries")
        .and_then(|v| v.as_object_mut())
    {
        entries.remove(&channel_id);
    }

    let env_prefixes = vec![
        format!("OPENCLAW_{}_USERID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHATID", channel_id.to_uppercase()),
        format!("OPENCLAW_{}_TESTCHANNELID", channel_id.to_uppercase()),
    ];
    for env_key in env_prefixes {
        let _ = remove_env_value(&env_path, &env_key);
    }

    save_openclaw_config_json(&config)?;
    info!("[清空渠道配置] ✓ {} 配置已清空", channel_id);
    Ok(format!("{} 配置已清空", channel_id))
}

/// Check whether the feishu plugin is installed
#[tauri::command]
pub async fn check_openclaw_feishu_plugin() -> Result<FeishuPluginStatus, String> {
    info!("[飞书插件] 检查飞书插件安装状态...");
    match run_openclaw_cmd(&["plugins", "list"]) {
        Ok(output) => {
            let feishu_line = output
                .lines()
                .find(|line| line.to_lowercase().contains("feishu"));
            if let Some(line) = feishu_line {
                info!("[飞书插件] ✓ 飞书插件已安装: {}", line);
                let version = if line.contains('@') {
                    line.split('@').last().map(|s| s.trim().to_string())
                } else {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    parts
                        .iter()
                        .find(|p| {
                            p.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
                        })
                        .map(|s| s.to_string())
                };
                Ok(FeishuPluginStatus {
                    installed: true,
                    version,
                    plugin_name: Some(line.trim().to_string()),
                })
            } else {
                Ok(FeishuPluginStatus {
                    installed: false,
                    version: None,
                    plugin_name: None,
                })
            }
        }
        Err(e) => {
            warn!("[飞书插件] 检查插件列表失败: {}", e);
            Ok(FeishuPluginStatus {
                installed: false,
                version: None,
                plugin_name: None,
            })
        }
    }
}

/// Install the feishu plugin via openclaw CLI
#[tauri::command]
pub async fn install_openclaw_feishu_plugin() -> Result<String, String> {
    info!("[飞书插件] 开始安装飞书插件...");
    let status = check_openclaw_feishu_plugin().await?;
    if status.installed {
        return Ok(format!(
            "飞书插件已安装: {}",
            status.plugin_name.unwrap_or_default()
        ));
    }
    match run_openclaw_cmd(&["plugins", "install", "@m1heng-clawd/feishu"]) {
        Ok(_) => {
            let verify = check_openclaw_feishu_plugin().await?;
            if verify.installed {
                Ok(format!(
                    "飞书插件安装成功: {}",
                    verify.plugin_name.unwrap_or_default()
                ))
            } else {
                Err("安装命令执行成功但插件未找到，请检查 openclaw 版本".to_string())
            }
        }
        Err(e) => Err(format!(
            "安装飞书插件失败: {}\n\n请手动执行: openclaw plugins install @m1heng-clawd/feishu",
            e
        )),
    }
}

/// Check whether the dingtalk plugin is installed by checking
/// ~/.openclaw/extensions/dingtalk/package.json existence.
#[tauri::command]
pub async fn check_openclaw_dingtalk_plugin() -> Result<DingTalkPluginStatus, String> {
    info!("[钉钉插件] 检查钉钉插件安装状态（~/.openclaw/extensions/dingtalk/package.json）...");
    let openclaw_dir = openclaw_config::get_openclaw_dir();
    let package_json_path = openclaw_dir
        .join("extensions")
        .join("dingtalk")
        .join("package.json");

    if !package_json_path.exists() {
        info!("[钉钉插件] package.json 不存在，需要安装");
        return Ok(DingTalkPluginStatus {
            installed: false,
            needs_reinstall: false,
            spec: None,
            version: None,
        });
    }

    // 已安装：从 package.json 读 version，可选从 config 读 spec/needs_reinstall
    let version = std::fs::read_to_string(&package_json_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()));

    let config = load_openclaw_config_json().unwrap_or(json!({}));
    let installs_dingtalk = config.pointer("/plugins/installs/dingtalk");
    let spec = installs_dingtalk
        .and_then(|e| e.get("spec").and_then(|v| v.as_str()).map(|s| s.to_string()));
    let needs_reinstall = spec.as_deref() != Some("@soimy/dingtalk");

    info!(
        "[钉钉插件] ✓ 钉钉插件已安装 version={:?} spec={:?}",
        version, spec
    );
    Ok(DingTalkPluginStatus {
        installed: true,
        needs_reinstall,
        spec,
        version,
    })
}

/// Install (or reinstall) the dingtalk plugin via openclaw CLI
#[tauri::command]
pub async fn install_openclaw_dingtalk_plugin() -> Result<String, String> {
    info!("[钉钉插件] 开始安装/重装钉钉插件...");

    // 1. 先设置 npm registry 加速
    info!("[钉钉插件] 设置 npm registry 为淘宝镜像...");
    let npm_config_output = tokio::task::spawn_blocking(move || {
        std::process::Command::new("npm")
            .args(["config", "set", "registry", "https://registry.npmmirror.com"])
            .env("PATH", get_extended_path())
            .output()
            .map_err(|e| format!("设置 npm registry 失败: {}", e))
    })
    .await
    .map_err(|e| format!("npm config 任务执行失败: {}", e))?;

    match npm_config_output {
        Ok(output) => {
            if output.status.success() {
                info!("[钉钉插件] ✓ npm registry 设置成功");
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("[钉钉插件] 设置 npm registry 警告: {}", stderr.trim());
            }
        }
        Err(e) => {
            warn!("[钉钉插件] 设置 npm registry 失败（继续执行）: {}", e);
        }
    }

    // 2. 无条件删除目录 ~/.openclaw/extensions/dingtalk
    info!("[钉钉插件] 删除 ~/.openclaw/extensions/dingtalk 目录...");
    if let Some(home) = dirs::home_dir() {
        let ext_dir = home.join(".openclaw").join("extensions").join("dingtalk");
        if ext_dir.exists() {
            match std::fs::remove_dir_all(&ext_dir) {
                Ok(_) => info!("[钉钉插件] ✓ 已删除目录: {}", ext_dir.display()),
                Err(e) => warn!("[钉钉插件] 删除目录警告（继续执行）: {}", e),
            }
        } else {
            info!("[钉钉插件] 目录不存在，跳过删除: {}", ext_dir.display());
        }
    }

    // 3. 执行 openclaw plugins install @soimy/dingtalk
    info!("[钉钉插件] 执行安装命令...");
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(find_openclaw_bin())
            .args(["plugins", "install", "@soimy/dingtalk"])
            .env("PATH", get_extended_path())
            .env("NPM_CONFIG_REGISTRY", "https://registry.npmmirror.com")
            .output()
            .map_err(|e| format!("执行安装命令失败: {}", e))
    })
    .await
    .map_err(|e| format!("任务执行失败: {}", e))??;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "安装钉钉插件失败: {}\n\n请手动执行: NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @soimy/dingtalk",
            stderr.trim()
        ));
    }

    // Verify installation
    let verify = check_openclaw_dingtalk_plugin().await?;
    if verify.installed {
        info!("[钉钉插件] ✓ 安装验证通过");
        Ok(format!("钉钉插件安装成功: @soimy/dingtalk {}", verify.version.unwrap_or_default()))
    } else {
        warn!("[钉钉插件] 安装命令执行成功但验证失败，stdout={}", stdout.trim());
        Err("安装命令执行成功但插件未找到，请检查 openclaw 版本".to_string())
    }
}

/// Test a channel connection
#[tauri::command]
pub async fn test_openclaw_channel(channel_type: String) -> Result<ChannelTestResult, String> {
    info!("[渠道测试] 测试渠道: {}", channel_type);
    let channel_lower = channel_type.to_lowercase();

    let status_result = run_openclaw_cmd(&["channels", "status"]);
    let mut channel_ok = false;
    let mut status_message = String::new();
    let mut debug_info = String::new();

    if let Ok(output) = &status_result {
        // parse text output: "- Telegram default: enabled, configured, ..."
        for line in output.lines() {
            let line = line.trim();
            if line.starts_with("- ") && line.to_lowercase().contains(&channel_lower) {
                let enabled = line.contains("enabled");
                let configured = line.contains("configured") && !line.contains("not configured");
                let linked = line.contains("linked");
                debug_info = format!("enabled={}, configured={}, linked={}", enabled, configured, linked);
                if !configured {
                    return Ok(ChannelTestResult {
                        success: false,
                        channel: channel_type.clone(),
                        message: format!("{} 未配置", channel_type),
                        error: Some(format!("请运行: openclaw channels add --channel {}", channel_lower)),
                    });
                }
                channel_ok = configured;
                status_message = if linked {
                    "已链接".to_string()
                } else {
                    "已配置".to_string()
                };
                break;
            }
        }
    } else if let Err(e) = &status_result {
        debug_info = format!("命令执行失败: {}", e);
    }

    if !channel_ok {
        return Ok(ChannelTestResult {
            success: false,
            channel: channel_type.clone(),
            message: format!("{} 未连接", channel_type),
            error: Some(if debug_info.is_empty() {
                "渠道未运行或未配置".to_string()
            } else {
                debug_info
            }),
        });
    }

    // WhatsApp / iMessage: status check is enough
    let needs_send = matches!(channel_lower.as_str(), "telegram" | "discord" | "slack" | "feishu");
    if !needs_send {
        return Ok(ChannelTestResult {
            success: true,
            channel: channel_type.clone(),
            message: format!("{} 状态正常 ({})", channel_type, status_message),
            error: None,
        });
    }

    // Try to send a test message
    let env_path = get_openclaw_env_file_path();
    let test_target_key = match channel_lower.as_str() {
        "telegram" => Some("OPENCLAW_TELEGRAM_USERID"),
        "discord" => Some("OPENCLAW_DISCORD_TESTCHANNELID"),
        "slack" => Some("OPENCLAW_SLACK_TESTCHANNELID"),
        "feishu" => Some("OPENCLAW_FEISHU_TESTCHATID"),
        _ => None,
    };
    let test_target = test_target_key.and_then(|k| read_env_value(&env_path, k));

    if let Some(target) = test_target {
        let message = format!("🤖 OpenClaw 测试消息\n\n✅ 连接成功！");
        match run_openclaw_cmd(&[
            "message", "send",
            "--channel", &channel_lower,
            "--target", &target,
            "--message", &message,
        ]) {
            Ok(_) => Ok(ChannelTestResult {
                success: true,
                channel: channel_type.clone(),
                message: format!("{} 测试消息已发送 ({})", channel_type, status_message),
                error: None,
            }),
            Err(e) => Ok(ChannelTestResult {
                success: false,
                channel: channel_type.clone(),
                message: format!("{} 消息发送失败", channel_type),
                error: Some(e),
            }),
        }
    } else {
        let hint = match channel_lower.as_str() {
            "telegram" => "请配置 User ID 字段以启用发送测试",
            "discord" => "请配置测试 Channel ID 字段以启用发送测试",
            "slack" => "请配置测试 Channel ID 字段以启用发送测试",
            "feishu" => "请配置测试 Chat ID 字段以启用发送测试",
            _ => "请配置测试目标",
        };
        Ok(ChannelTestResult {
            success: true,
            channel: channel_type.clone(),
            message: format!("{} 状态正常 ({}) - {}", channel_type, status_message, hint),
            error: None,
        })
    }
}

/// Start a channel login flow (e.g. WhatsApp QR code scan) in a new terminal
#[tauri::command]
pub async fn start_openclaw_channel_login(channel_type: String) -> Result<String, String> {
    info!("[渠道登录] 开始渠道登录流程: {}", channel_type);

    match channel_type.as_str() {
        "whatsapp" => {
            #[cfg(target_os = "macos")]
            {
                let env_path = get_openclaw_env_file_path();
                let script_content = format!(
                    r#"#!/bin/bash
source {} 2>/dev/null
clear
echo "📱 WhatsApp 登录向导"
echo ""
openclaw channels login --channel whatsapp --verbose
echo ""
read -p "按回车键关闭此窗口..."
"#,
                    env_path
                );
                let script_path = "/tmp/openclaw_whatsapp_login.command";
                std::fs::write(script_path, script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;
                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;
                std::process::Command::new("open")
                    .arg(script_path)
                    .spawn()
                    .map_err(|e| format!("启动终端失败: {}", e))?;
            }
            #[cfg(target_os = "linux")]
            {
                let env_path = get_openclaw_env_file_path();
                let script_content = format!(
                    r#"#!/bin/bash
source {} 2>/dev/null
openclaw channels login --channel whatsapp --verbose
read -p "按回车键关闭..."
"#,
                    env_path
                );
                let script_path = "/tmp/openclaw_whatsapp_login.sh";
                std::fs::write(script_path, &script_content)
                    .map_err(|e| format!("创建脚本失败: {}", e))?;
                std::process::Command::new("chmod")
                    .args(["+x", script_path])
                    .output()
                    .map_err(|e| format!("设置权限失败: {}", e))?;
                let terminals = ["gnome-terminal", "xfce4-terminal", "konsole", "xterm"];
                let launched = terminals.iter().any(|term| {
                    std::process::Command::new(term)
                        .args(["--", script_path])
                        .spawn()
                        .is_ok()
                });
                if !launched {
                    return Err(
                        "无法启动终端，请手动运行: openclaw channels login --channel whatsapp"
                            .to_string(),
                    );
                }
            }
            #[cfg(target_os = "windows")]
            {
                return Err("Windows 暂不支持自动启动终端，请手动运行: openclaw channels login --channel whatsapp".to_string());
            }
            Ok("已在新终端窗口中启动 WhatsApp 登录，请查看弹出的终端窗口并扫描二维码".to_string())
        }
        _ => Err(format!("不支持 {} 的登录向导", channel_type)),
    }
}

// ============================================================================
// Log File Commands (aligned with openclaw-manager)
// ============================================================================

/// Log file entry info
#[derive(Debug, Serialize, Deserialize)]
pub struct LogFileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<String>,
}

/// List available OpenClaw log files
#[tauri::command]
pub async fn list_openclaw_logs() -> Result<Vec<LogFileInfo>, String> {
    let logs_dir = openclaw_config::get_openclaw_dir().join("logs");
    
    if !logs_dir.exists() {
        return Ok(vec![]);
    }

    let mut logs = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&logs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("log") {
                if let Ok(metadata) = entry.metadata() {
                    let name = path.file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown.log")
                        .to_string();
                    let size = metadata.len();
                    let modified = metadata.modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .map(|ts| {
                            let dt = chrono::DateTime::from_timestamp(ts, 0)
                                .unwrap_or_else(|| chrono::DateTime::UNIX_EPOCH);
                            dt.format("%Y-%m-%d %H:%M:%S").to_string()
                        });
                    
                    logs.push(LogFileInfo {
                        name,
                        path: path.to_string_lossy().to_string(),
                        size,
                        modified,
                    });
                }
            }
        }
    }
    
    // Sort by modification time (newest first)
    logs.sort_by(|a, b| b.modified.cmp(&a.modified));
    
    Ok(logs)
}

/// Read log file content with optional line limit
#[tauri::command]
pub async fn read_openclaw_log(path: String, limit: Option<usize>) -> Result<String, String> {
    let path = std::path::Path::new(&path);
    
    // Security check: ensure the path is within the openclaw logs directory
    let logs_dir = openclaw_config::get_openclaw_dir().join("logs");
    let canonical_path = path.canonicalize()
        .map_err(|e| format!("无法访问日志文件: {}", e))?;
    let canonical_logs_dir = logs_dir.canonicalize()
        .unwrap_or_else(|_| logs_dir.clone());
    
    if !canonical_path.starts_with(&canonical_logs_dir) {
        return Err("非法的日志文件路径".to_string());
    }
    
    if !canonical_path.exists() {
        return Ok(String::new());
    }
    
    // Read file content
    let content = std::fs::read_to_string(&canonical_path)
        .map_err(|e| format!("读取日志文件失败: {}", e))?;
    
    // Apply line limit if specified
    if let Some(max_lines) = limit {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() > max_lines {
            let start = lines.len() - max_lines;
            return Ok(lines[start..].join("\n"));
        }
    }
    
    Ok(content)
}

/// Clear (truncate) a log file
#[tauri::command]
pub async fn clear_openclaw_log(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    
    // Security check: ensure the path is within the openclaw logs directory
    let logs_dir = openclaw_config::get_openclaw_dir().join("logs");
    let canonical_path = path.canonicalize()
        .map_err(|e| format!("无法访问日志文件: {}", e))?;
    let canonical_logs_dir = logs_dir.canonicalize()
        .unwrap_or_else(|_| logs_dir.clone());
    
    if !canonical_path.starts_with(&canonical_logs_dir) {
        return Err("非法的日志文件路径".to_string());
    }
    
    // Truncate the file
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&canonical_path)
        .map_err(|e| format!("清空日志文件失败: {}", e))?;
    
    Ok(())
}
