//! OpenClaw 配置文件读写模块
//!
//! 处理 `~/.openclaw/openclaw.json` 配置文件的读写操作（JSON5 格式）。
//! OpenClaw 使用累加式供应商管理，所有供应商配置共存于同一配置文件中。
//!
//! ## 配置文件格式
//!
//! ```json5
//! {
//!   // 模型供应商配置（映射为 Claw Switch 的"供应商"）
//!   models: {
//!     mode: "merge",
//!     providers: {
//!       "custom-provider": {
//!         baseUrl: "https://api.example.com/v1",
//!         apiKey: "${API_KEY}",
//!         api: "openai-completions",
//!         models: [{ id: "model-id", name: "Model Name" }]
//!       }
//!     }
//!   },
//!   // 环境变量配置
//!   env: {
//!     ANTHROPIC_API_KEY: "sk-...",
//!     vars: { ... }
//!   },
//!   // Agent 默认模型配置
//!   agents: {
//!     defaults: {
//!       model: {
//!         primary: "provider/model",
//!         fallbacks: ["provider2/model2"]
//!       }
//!     }
//!   }
//! }
//! ```

use crate::config::write_json_file;
use crate::error::AppError;
use crate::settings::get_openclaw_override_dir;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

// ============================================================================
// Path Functions
// ============================================================================

/// 获取 OpenClaw 配置目录
///
/// 默认路径: `~/.openclaw/`
/// 可通过 settings.openclaw_config_dir 覆盖
pub fn get_openclaw_dir() -> PathBuf {
    if let Some(override_dir) = get_openclaw_override_dir() {
        return override_dir;
    }

    // 所有平台统一使用 ~/.openclaw
    dirs::home_dir()
        .map(|h| h.join(".openclaw"))
        .unwrap_or_else(|| PathBuf::from(".openclaw"))
}

/// 获取 OpenClaw 配置文件路径
///
/// 返回 `~/.openclaw/openclaw.json`
pub fn get_openclaw_config_path() -> PathBuf {
    get_openclaw_dir().join("openclaw.json")
}

// ============================================================================
// Type Definitions
// ============================================================================

/// OpenClaw 供应商配置（对应 models.providers 中的条目）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawProviderConfig {
    /// API 基础 URL
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,

    /// API Key（支持环境变量引用 ${VAR_NAME}）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,

    /// API 类型（如 "openai-completions", "anthropic" 等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api: Option<String>,

    /// 支持的模型列表
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<OpenClawModelEntry>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw 模型条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawModelEntry {
    /// 模型 ID
    pub id: String,

    /// 模型显示名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 模型别名（用于快捷引用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// 模型成本（输入/输出价格）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<OpenClawModelCost>,

    /// 上下文窗口大小
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw 模型成本配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawModelCost {
    /// 输入价格（每百万 token）
    pub input: f64,

    /// 输出价格（每百万 token）
    pub output: f64,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw 默认模型配置（agents.defaults.model）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawDefaultModel {
    /// 主模型 ID（格式：provider/model）
    pub primary: String,

    /// 回退模型列表
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fallbacks: Vec<String>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw 模型目录条目（agents.defaults.models 中的值）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawModelCatalogEntry {
    /// 模型别名（用于 UI 显示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw agents.defaults 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawAgentsDefaults {
    /// 默认模型配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<OpenClawDefaultModel>,

    /// 模型目录/允许列表（键为 provider/model 格式）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<HashMap<String, OpenClawModelCatalogEntry>>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw agents 顶层配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct OpenClawAgents {
    /// 默认配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub defaults: Option<OpenClawAgentsDefaults>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

// ============================================================================
// Core Read/Write Functions
// ============================================================================

/// 读取 OpenClaw 配置文件
///
/// 支持 JSON5 格式，返回完整的配置 JSON 对象
pub fn read_openclaw_config() -> Result<Value, AppError> {
    let path = get_openclaw_config_path();

    if !path.exists() {
        // Return empty config structure
        return Ok(json!({
            "models": {
                "mode": "merge",
                "providers": {}
            }
        }));
    }

    let content = std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;

    // 尝试 JSON5 解析（支持注释和尾随逗号）
    json5::from_str(&content)
        .map_err(|e| AppError::Config(format!("Failed to parse OpenClaw config as JSON5: {}", e)))
}

/// 写入 OpenClaw 配置文件（原子写入）
///
/// 使用标准 JSON 格式写入（JSON5 是 JSON 的超集）
pub fn write_openclaw_config(config: &Value) -> Result<(), AppError> {
    let path = get_openclaw_config_path();

    // 确保目录存在
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    // 复用统一的原子写入逻辑
    write_json_file(&path, config)?;

    log::debug!("OpenClaw config written to {path:?}");
    Ok(())
}

// ============================================================================
// Provider Functions (Untyped - for raw JSON operations)
// ============================================================================

/// 获取所有供应商配置（原始 JSON）
///
/// 从 `models.providers` 读取
pub fn get_providers() -> Result<Map<String, Value>, AppError> {
    let config = read_openclaw_config()?;
    Ok(config
        .get("models")
        .and_then(|m| m.get("providers"))
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default())
}

/// 设置供应商配置（原始 JSON）
///
/// 写入到 `models.providers`
pub fn set_provider(id: &str, provider_config: Value) -> Result<(), AppError> {
    let mut full_config = read_openclaw_config()?;

    // 确保 models 结构存在
    if full_config.get("models").is_none() {
        full_config["models"] = json!({
            "mode": "merge",
            "providers": {}
        });
    }

    // 确保 providers 对象存在
    if full_config["models"].get("providers").is_none() {
        full_config["models"]["providers"] = json!({});
    }

    // 设置供应商
    if let Some(providers) = full_config["models"]
        .get_mut("providers")
        .and_then(|v| v.as_object_mut())
    {
        providers.insert(id.to_string(), provider_config);
    }

    write_openclaw_config(&full_config)
}

/// 删除供应商配置
///
/// 同时级联清理 `agents.defaults` 中对本供应商的引用：
/// - `model.primary` 若为 `id/model` 则清空；
/// - `model.fallbacks` 中移除所有 `id/...` 项；
/// - `models` 目录中移除所有键为 `id/...` 的项。
pub fn remove_provider(id: &str) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    if let Some(providers) = config
        .get_mut("models")
        .and_then(|m| m.get_mut("providers"))
        .and_then(|v| v.as_object_mut())
    {
        providers.remove(id);
    }

    cascade_remove_provider_from_agents_defaults(&mut config, id);

    write_openclaw_config(&config)
}

/// 从 agents.defaults 中移除对指定供应商 id 的引用（primary、fallbacks、models）。
fn cascade_remove_provider_from_agents_defaults(config: &mut Value, provider_id: &str) {
    let prefix = format!("{provider_id}/");
    let Some(agents) = config.get_mut("agents").and_then(|a| a.as_object_mut()) else {
        return;
    };
    let Some(defaults) = agents.get_mut("defaults").and_then(|d| d.as_object_mut()) else {
        return;
    };

    // model.primary: 若为 "provider_id/..." 则清空
    if let Some(model) = defaults.get_mut("model").and_then(|m| m.as_object_mut()) {
        if let Some(primary) = model.get("primary").and_then(|p| p.as_str()) {
            if primary.starts_with(&prefix) {
                model.insert("primary".to_string(), Value::String(String::new()));
            }
        }
        // model.fallbacks: 移除所有 "provider_id/..." 项
        if let Some(fallbacks) = model.get_mut("fallbacks").and_then(|f| f.as_array_mut()) {
            fallbacks.retain(|v| {
                v.as_str().map_or(true, |s| !s.starts_with(&prefix))
            });
        }
    }

    // agents.defaults.models: 移除键以 "provider_id/" 开头的项
    if let Some(models) = defaults.get_mut("models").and_then(|m| m.as_object_mut()) {
        models.retain(|key, _| !key.starts_with(&prefix));
    }
}

// ============================================================================
// Provider Functions (Typed)
// ============================================================================

/// 获取所有供应商配置（类型化）
pub fn get_typed_providers() -> Result<IndexMap<String, OpenClawProviderConfig>, AppError> {
    let providers = get_providers()?;
    let mut result = IndexMap::new();

    for (id, value) in providers {
        match serde_json::from_value::<OpenClawProviderConfig>(value.clone()) {
            Ok(config) => {
                result.insert(id, config);
            }
            Err(e) => {
                log::warn!("Failed to parse OpenClaw provider '{id}': {e}");
                // Skip invalid providers but continue
            }
        }
    }

    Ok(result)
}

/// 设置供应商配置（类型化）
pub fn set_typed_provider(id: &str, config: &OpenClawProviderConfig) -> Result<(), AppError> {
    let value = serde_json::to_value(config).map_err(|e| AppError::JsonSerialize { source: e })?;
    set_provider(id, value)
}

// ============================================================================
// Agents Configuration Functions
// ============================================================================

/// 读取默认模型配置（agents.defaults.model）
pub fn get_default_model() -> Result<Option<OpenClawDefaultModel>, AppError> {
    let config = read_openclaw_config()?;

    let Some(model_value) = config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .and_then(|d| d.get("model"))
    else {
        return Ok(None);
    };

    let model = serde_json::from_value(model_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse agents.defaults.model: {e}")))?;

    Ok(Some(model))
}

/// 设置默认模型配置（agents.defaults.model）
pub fn set_default_model(model: &OpenClawDefaultModel) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    // Ensure agents.defaults path exists, preserving unknown fields
    ensure_agents_defaults_path(&mut config);

    let model_value =
        serde_json::to_value(model).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["agents"]["defaults"]["model"] = model_value;

    write_openclaw_config(&config)
}

/// 读取模型目录/允许列表（agents.defaults.models）
pub fn get_model_catalog() -> Result<Option<HashMap<String, OpenClawModelCatalogEntry>>, AppError> {
    let config = read_openclaw_config()?;

    let Some(models_value) = config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .and_then(|d| d.get("models"))
    else {
        return Ok(None);
    };

    let catalog = serde_json::from_value(models_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse agents.defaults.models: {e}")))?;

    Ok(Some(catalog))
}

/// 设置模型目录/允许列表（agents.defaults.models）
pub fn set_model_catalog(
    catalog: &HashMap<String, OpenClawModelCatalogEntry>,
) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    // Ensure agents.defaults path exists, preserving unknown fields
    ensure_agents_defaults_path(&mut config);

    let catalog_value =
        serde_json::to_value(catalog).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["agents"]["defaults"]["models"] = catalog_value;

    write_openclaw_config(&config)
}

/// Ensure the `agents.defaults` path exists in the config,
/// preserving any existing unknown fields.
fn ensure_agents_defaults_path(config: &mut Value) {
    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }
    if config["agents"].get("defaults").is_none() {
        config["agents"]["defaults"] = json!({});
    }
}

// ============================================================================
// Full Agents Defaults Functions
// ============================================================================

/// Read the full agents.defaults config
pub fn get_agents_defaults() -> Result<Option<OpenClawAgentsDefaults>, AppError> {
    let config = read_openclaw_config()?;

    let Some(defaults_value) = config.get("agents").and_then(|a| a.get("defaults")) else {
        return Ok(None);
    };

    let defaults = serde_json::from_value(defaults_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse agents.defaults: {e}")))?;

    Ok(Some(defaults))
}

/// Write the full agents.defaults config
pub fn set_agents_defaults(defaults: &OpenClawAgentsDefaults) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    if config.get("agents").is_none() {
        config["agents"] = json!({});
    }

    let value =
        serde_json::to_value(defaults).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["agents"]["defaults"] = value;

    write_openclaw_config(&config)
}

// ============================================================================
// Agent Instance Management
// ============================================================================

/// Agent 实例信息（从 ~/.openclaw/agents/<id>/ 目录读取）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawAgentInfo {
    pub id: String,
    pub is_default: bool,
    pub identity_name: Option<String>,
    pub identity_emoji: Option<String>,
    pub model: Option<String>,
    pub workspace: Option<String>,
}

/// 获取 agents 目录路径：~/.openclaw/agents/
fn get_agents_dir() -> PathBuf {
    get_openclaw_dir().join("agents")
}

/// 读取指定 agent 目录中的 identity.json（名称 / emoji）
fn read_agent_identity(agent_dir: &std::path::Path) -> (Option<String>, Option<String>) {
    let identity_path = agent_dir.join("identity.json");
    if let Ok(content) = std::fs::read_to_string(&identity_path) {
        if let Ok(v) = json5::from_str::<Value>(&content) {
            let name = v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string());
            let emoji = v.get("emoji").and_then(|e| e.as_str()).map(|s| s.to_string());
            return (name, emoji);
        }
    }
    (None, None)
}

/// 读取指定 agent 目录中的 openclaw.json（获取 model.primary）
fn read_agent_model(agent_dir: &std::path::Path) -> Option<String> {
    let config_path = agent_dir.join("openclaw.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(v) = json5::from_str::<Value>(&content) {
            return v
                .get("agents")
                .and_then(|a| a.get("defaults"))
                .and_then(|d| d.get("model"))
                .and_then(|m| m.get("primary"))
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

/// 读取指定 agent 目录中的 openclaw.json（获取 workspace）
fn read_agent_workspace(agent_dir: &std::path::Path) -> Option<String> {
    let config_path = agent_dir.join("openclaw.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(v) = json5::from_str::<Value>(&content) {
            return v
                .get("agents")
                .and_then(|a| a.get("defaults"))
                .and_then(|d| d.get("workspace"))
                .and_then(|w| w.as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

/// 列出所有 Agent 实例（~/.openclaw/agents/ 下各子目录）
///
/// 始终将 "main" 排在第一位并标记为默认。
pub fn list_agents() -> Result<Vec<OpenClawAgentInfo>, AppError> {
    let agents_dir = get_agents_dir();

    let mut agents: Vec<OpenClawAgentInfo> = Vec::new();

    // main agent（全局默认）始终存在，从主配置读取
    let main_model = {
        let config = read_openclaw_config()?;
        config
            .get("agents")
            .and_then(|a| a.get("defaults"))
            .and_then(|d| d.get("model"))
            .and_then(|m| m.get("primary"))
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
    };
    let main_workspace = {
        let config = read_openclaw_config()?;
        config
            .get("agents")
            .and_then(|a| a.get("defaults"))
            .and_then(|d| d.get("workspace"))
            .and_then(|w| w.as_str())
            .map(|s| s.to_string())
    };

    // main 的 identity 也可能在 agents/main/ 中
    let main_agent_dir = agents_dir.join("main");
    let (main_name, main_emoji) = if main_agent_dir.exists() {
        read_agent_identity(&main_agent_dir)
    } else {
        (None, None)
    };

    agents.push(OpenClawAgentInfo {
        id: "main".to_string(),
        is_default: true,
        identity_name: main_name,
        identity_emoji: main_emoji,
        model: main_model,
        workspace: main_workspace,
    });

    // 读取 agents 子目录中的其他 agent
    if agents_dir.exists() {
        let mut entries: Vec<_> = std::fs::read_dir(&agents_dir)
            .map_err(|e| AppError::io(&agents_dir, e))?
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter(|e| {
                let name = e.file_name();
                let name_str = name.to_string_lossy();
                name_str != "main"
            })
            .collect();

        // 按目录名排序，保持稳定顺序
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let agent_dir = entry.path();
            let (identity_name, identity_emoji) = read_agent_identity(&agent_dir);
            let model = read_agent_model(&agent_dir);
            let workspace = read_agent_workspace(&agent_dir);

            agents.push(OpenClawAgentInfo {
                id: dir_name,
                is_default: false,
                identity_name,
                identity_emoji,
                model,
                workspace,
            });
        }
    }

    Ok(agents)
}

/// 创建新 Agent（在 ~/.openclaw/agents/<id>/ 下创建目录和配置文件）
pub fn add_agent(id: &str, model: Option<&str>, workspace: Option<&str>) -> Result<(), AppError> {
    let agent_dir = get_agents_dir().join(id);
    if agent_dir.exists() {
        return Err(AppError::Config(format!("Agent '{}' 已存在", id)));
    }

    std::fs::create_dir_all(&agent_dir).map_err(|e| AppError::io(&agent_dir, e))?;

    // 写入 openclaw.json（设置 model 和 workspace）
    let mut agent_config = json!({
        "agents": {
            "defaults": {}
        }
    });

    if let Some(m) = model {
        if !m.is_empty() {
            agent_config["agents"]["defaults"]["model"] = json!({
                "primary": m
            });
        }
    }

    if let Some(ws) = workspace {
        if !ws.is_empty() {
            agent_config["agents"]["defaults"]["workspace"] = json!(ws);
        }
    }

    let config_path = agent_dir.join("openclaw.json");
    write_json_file(&config_path, &agent_config)?;

    Ok(())
}

/// 删除 Agent（删除 ~/.openclaw/agents/<id>/ 目录）
pub fn delete_agent(id: &str) -> Result<(), AppError> {
    if id == "main" {
        return Err(AppError::Config("不能删除默认 Agent".to_string()));
    }

    let agent_dir = get_agents_dir().join(id);
    if !agent_dir.exists() {
        return Err(AppError::Config(format!("Agent '{}' 不存在", id)));
    }

    std::fs::remove_dir_all(&agent_dir).map_err(|e| AppError::io(&agent_dir, e))?;

    Ok(())
}

/// 更新 Agent 身份信息（名称和 emoji）
///
/// 写入 ~/.openclaw/agents/<id>/identity.json
pub fn update_agent_identity(
    id: &str,
    name: Option<&str>,
    emoji: Option<&str>,
) -> Result<(), AppError> {
    let agent_dir = if id == "main" {
        get_agents_dir().join("main")
    } else {
        get_agents_dir().join(id)
    };

    std::fs::create_dir_all(&agent_dir).map_err(|e| AppError::io(&agent_dir, e))?;

    let identity_path = agent_dir.join("identity.json");

    // 读取已有 identity（保留其他字段）
    let mut identity: Value = if identity_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&identity_path) {
            json5::from_str(&content).unwrap_or(json!({}))
        } else {
            json!({})
        }
    } else {
        json!({})
    };

    if let Some(n) = name {
        if n.is_empty() {
            identity.as_object_mut().map(|m| m.remove("name"));
        } else {
            identity["name"] = json!(n);
        }
    }

    if let Some(e) = emoji {
        if e.is_empty() {
            identity.as_object_mut().map(|m| m.remove("emoji"));
        } else {
            identity["emoji"] = json!(e);
        }
    }

    write_json_file(&identity_path, &identity)?;

    Ok(())
}

/// 更新 Agent 的默认模型
///
/// 对 "main" agent：修改主配置 ~/.openclaw/openclaw.json 的 agents.defaults.model.primary
/// 对其他 agent：修改 ~/.openclaw/agents/<id>/openclaw.json 的 agents.defaults.model.primary
pub fn update_agent_model(id: &str, model: &str) -> Result<(), AppError> {
    if id == "main" {
        // 修改主配置
        let mut config = read_openclaw_config()?;
        ensure_agents_defaults_path(&mut config);
        if config["agents"]["defaults"].get("model").is_none() {
            config["agents"]["defaults"]["model"] = json!({ "primary": model });
        } else {
            config["agents"]["defaults"]["model"]["primary"] = json!(model);
        }
        write_openclaw_config(&config)
    } else {
        let agent_dir = get_agents_dir().join(id);
        if !agent_dir.exists() {
            return Err(AppError::Config(format!("Agent '{}' 不存在", id)));
        }
        let config_path = agent_dir.join("openclaw.json");

        // 读取或初始化 agent 配置
        let mut agent_config: Value = if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                json5::from_str(&content).unwrap_or(json!({}))
            } else {
                json!({})
            }
        } else {
            json!({})
        };

        // 确保路径存在
        if agent_config.get("agents").is_none() {
            agent_config["agents"] = json!({});
        }
        if agent_config["agents"].get("defaults").is_none() {
            agent_config["agents"]["defaults"] = json!({});
        }
        if agent_config["agents"]["defaults"].get("model").is_none() {
            agent_config["agents"]["defaults"]["model"] = json!({ "primary": model });
        } else {
            agent_config["agents"]["defaults"]["model"]["primary"] = json!(model);
        }

        write_json_file(&config_path, &agent_config)?;
        Ok(())
    }
}

/// 备份 Agent（将 ~/.openclaw/agents/<id>/ 打包为 zip）
///
/// 返回生成的 zip 文件的绝对路径。
pub fn backup_agent(id: &str) -> Result<String, AppError> {
    use std::io::Write;

    let agents_dir = get_agents_dir();
    let agent_dir = if id == "main" {
        // main agent 备份主配置文件和 agents/main 目录
        get_openclaw_dir()
    } else {
        agents_dir.join(id)
    };

    if !agent_dir.exists() {
        // main agent 允许目录不存在（直接备份 openclaw.json）
        if id != "main" {
            return Err(AppError::Config(format!("Agent '{}' 不存在", id)));
        }
    }

    // 备份输出到 ~/.openclaw/backups/
    let backup_dir = get_openclaw_dir().join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let zip_name = format!("agent-{}-{}.zip", id, timestamp);
    let zip_path = backup_dir.join(&zip_name);

    let zip_file = std::fs::File::create(&zip_path).map_err(|e| AppError::io(&zip_path, e))?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    if id == "main" {
        // 仅备份主配置文件
        let config_path = get_openclaw_config_path();
        if config_path.exists() {
            if let Ok(content) = std::fs::read(&config_path) {
                zip.start_file("openclaw.json", options)
                    .map_err(|e| AppError::Config(format!("zip 创建失败: {}", e)))?;
                zip.write_all(&content)
                    .map_err(|e| AppError::Config(format!("zip 写入失败: {}", e)))?;
            }
        }
        // 同时备份 agents/main 目录（如果存在）
        let main_dir = agents_dir.join("main");
        if main_dir.exists() {
            add_dir_to_zip(&mut zip, &main_dir, "agents/main", options)?;
        }
    } else {
        add_dir_to_zip(&mut zip, &agent_dir, id, options)?;
    }

    zip.finish().map_err(|e| AppError::Config(format!("zip 完成失败: {}", e)))?;

    Ok(zip_path.display().to_string())
}

/// 递归将目录内容写入 zip
fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &std::path::Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), AppError> {
    use std::io::Write;

    for entry in walkdir::WalkDir::new(dir).follow_links(false) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        let relative = match path.strip_prefix(dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let zip_path = if relative.as_os_str().is_empty() {
            prefix.to_string()
        } else {
            format!("{}/{}", prefix, relative.display())
        };

        if path.is_dir() {
            // skip empty dir entries
            continue;
        }

        if let Ok(content) = std::fs::read(path) {
            zip.start_file(&zip_path, options)
                .map_err(|e| AppError::Config(format!("zip 添加文件失败: {}", e)))?;
            zip.write_all(&content)
                .map_err(|e| AppError::Config(format!("zip 写入失败: {}", e)))?;
        }
    }

    Ok(())
}

// ============================================================================
// Env Configuration
// ============================================================================

/// OpenClaw env configuration (env section of openclaw.json)
///
/// Stores environment variables like API keys and custom vars.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawEnvConfig {
    /// All environment variable key-value pairs
    #[serde(flatten)]
    pub vars: HashMap<String, Value>,
}

/// Read the env config section
pub fn get_env_config() -> Result<OpenClawEnvConfig, AppError> {
    let config = read_openclaw_config()?;

    let Some(env_value) = config.get("env") else {
        return Ok(OpenClawEnvConfig {
            vars: HashMap::new(),
        });
    };

    serde_json::from_value(env_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse env config: {e}")))
}

/// Write the env config section
pub fn set_env_config(env: &OpenClawEnvConfig) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    let value = serde_json::to_value(env).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["env"] = value;

    write_openclaw_config(&config)
}

// ============================================================================
// Tools Configuration
// ============================================================================

/// OpenClaw tools sessions visibility config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawToolsSessionsConfig {
    /// Session visibility: "all" | "own" | "none"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw tools configuration (tools section of openclaw.json)
///
/// Controls tool permissions with profile-based allow/deny lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawToolsConfig {
    /// Active permission profile (e.g. "default", "strict", "permissive")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,

    /// Allowed tool patterns
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,

    /// Denied tool patterns
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny: Vec<String>,

    /// Sessions visibility config
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<OpenClawToolsSessionsConfig>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

// ============================================================================
// Gateway Configuration
// ============================================================================

/// OpenClaw gateway auth configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawGatewayAuth {
    /// Auth mode: "token" | "password"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,

    /// API token for token-based auth
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,

    /// Password for password-based auth
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw Tailscale configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawGatewayTailscale {
    /// Tailscale address (e.g. "100.x.x.x:18789")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// OpenClaw gateway configuration (gateway section of openclaw.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenClawGatewayConfig {
    /// Service port (default 18789)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,

    /// Bind mode: "loopback" | "lan" | "all"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,

    /// Running mode: "local" | "remote"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,

    /// Authentication configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<OpenClawGatewayAuth>,

    /// Tailscale configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tailscale: Option<OpenClawGatewayTailscale>,

    /// Other custom fields (preserve unknown fields)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

/// Read the gateway config section
pub fn get_gateway_config() -> Result<OpenClawGatewayConfig, AppError> {
    let config = read_openclaw_config()?;

    let Some(gateway_value) = config.get("gateway") else {
        return Ok(OpenClawGatewayConfig {
            port: None,
            bind: None,
            mode: None,
            auth: None,
            tailscale: None,
            extra: HashMap::new(),
        });
    };

    serde_json::from_value(gateway_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse gateway config: {e}")))
}

/// Write the gateway config section
pub fn set_gateway_config(gateway: &OpenClawGatewayConfig) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    let value =
        serde_json::to_value(gateway).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["gateway"] = value;

    write_openclaw_config(&config)
}

/// Read the tools config section
pub fn get_tools_config() -> Result<OpenClawToolsConfig, AppError> {
    let config = read_openclaw_config()?;

    let Some(tools_value) = config.get("tools") else {
        return Ok(OpenClawToolsConfig {
            profile: None,
            allow: Vec::new(),
            deny: Vec::new(),
            sessions: None,
            extra: HashMap::new(),
        });
    };

    serde_json::from_value(tools_value.clone())
        .map_err(|e| AppError::Config(format!("Failed to parse tools config: {e}")))
}

/// Write the tools config section
pub fn set_tools_config(tools: &OpenClawToolsConfig) -> Result<(), AppError> {
    let mut config = read_openclaw_config()?;

    let value = serde_json::to_value(tools).map_err(|e| AppError::JsonSerialize { source: e })?;

    config["tools"] = value;

    write_openclaw_config(&config)
}
