use crate::config::{get_home_dir, read_json_file, write_json_file};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

/// 获取 Cline 配置目录路径（支持设置覆盖）
pub fn get_cline_config_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_cline_override_dir() {
        return custom;
    }

    get_home_dir().join(".cline")
}

/// 获取 Cline 主配置文件路径
pub fn get_cline_settings_path() -> PathBuf {
    get_cline_config_dir().join("settings.json")
}

/// 获取 Cline global state 文件路径
/// Cline 使用 VS Code 风格的 globalState 存储配置
pub fn get_cline_global_state_path() -> Result<PathBuf, AppError> {
    // Cline 作为 VS Code 扩展，配置存储在 VS Code 的 globalState 中
    // 这里我们使用 ~/.cline/data/globalState.json 作为模拟
    let path = get_cline_config_dir().join("data").join("globalState.json");
    Ok(path)
}

/// Cline 供应商配置结构
/// 对应 Cline 扩展中存储的供应商相关字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClineProviderConfig {
    /// API Key
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Model ID (兼容旧格式)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 其他配置项
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

impl Default for ClineProviderConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            model: None,
            extra: HashMap::new(),
        }
    }
}

/// 读取 Cline global state 文件
fn read_cline_global_state() -> Result<Value, AppError> {
    let path = get_cline_global_state_path()?;
    
    if !path.exists() {
        // 如果文件不存在，返回空对象
        return Ok(Value::Object(serde_json::Map::new()));
    }
    
    read_json_file(&path)
}

/// 写入 Cline global state 文件
fn write_cline_global_state(state: &Value) -> Result<(), AppError> {
    let path = get_cline_global_state_path()?;
    
    // 确保目录存在
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    
    write_json_file(&path, state)
}

/// 读取 Cline 供应商配置
/// 从 globalState 中提取 Claw Switch 管理的供应商字段
/// 读取 8 个管理字段：authProtocol, planModeApiProvider, actModeApiProvider,
/// openAiBaseUrl, planModeOpenAiModelId, actModeOpenAiModelId,
/// anthropicBaseUrl, planModeApiModelId, actModeApiModelId
/// 
/// 注意：Cline 的 globalState.json 直接使用字段名，不是 "cline.provider.xxx" 格式
/// 注意：apiKey 和 openAiApiKey 不在 globalState.json 中，不需要读取
pub fn read_cline_provider_config() -> Result<ClineProviderConfig, AppError> {
    let global_state = read_cline_global_state()?;
    
    // 从 globalState 中提取供应商相关字段
    // Cline 直接使用字段名存储配置，如 "anthropicBaseUrl", "planModeApiModelId" 等
    let mut config = ClineProviderConfig::default();
    
    if let Some(obj) = global_state.as_object() {
        // 提取 8 个管理字段（直接使用字段名，不是 "cline.provider.xxx" 格式）
        
        // 1. planModeApiProvider
        if let Some(provider) = obj.get("planModeApiProvider").and_then(|v| v.as_str()) {
            config.extra.insert("planModeApiProvider".to_string(), Value::String(provider.to_string()));
            // 如果没有 authProtocol，使用 planModeApiProvider 作为 authProtocol
            if !config.extra.contains_key("authProtocol") {
                config.extra.insert("authProtocol".to_string(), Value::String(provider.to_string()));
            }
        }
        
        // 2. actModeApiProvider
        if let Some(provider) = obj.get("actModeApiProvider").and_then(|v| v.as_str()) {
            config.extra.insert("actModeApiProvider".to_string(), Value::String(provider.to_string()));
        }
        
        // 3. authProtocol (如果单独存在，优先使用)
        if let Some(auth_protocol) = obj.get("authProtocol").and_then(|v| v.as_str()) {
            config.extra.insert("authProtocol".to_string(), Value::String(auth_protocol.to_string()));
        }
        
        // 4. openAiBaseUrl
        if let Some(url) = obj.get("openAiBaseUrl").and_then(|v| v.as_str()) {
            config.extra.insert("openAiBaseUrl".to_string(), Value::String(url.to_string()));
        }
        
        // 5. planModeOpenAiModelId
        if let Some(model) = obj.get("planModeOpenAiModelId").and_then(|v| v.as_str()) {
            config.extra.insert("planModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 6. actModeOpenAiModelId
        if let Some(model) = obj.get("actModeOpenAiModelId").and_then(|v| v.as_str()) {
            config.extra.insert("actModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 7. anthropicBaseUrl
        if let Some(url) = obj.get("anthropicBaseUrl").and_then(|v| v.as_str()) {
            config.extra.insert("anthropicBaseUrl".to_string(), Value::String(url.to_string()));
        }
        
        // 8. planModeApiModelId
        if let Some(model) = obj.get("planModeApiModelId").and_then(|v| v.as_str()) {
            config.extra.insert("planModeApiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 9. actModeApiModelId
        if let Some(model) = obj.get("actModeApiModelId").and_then(|v| v.as_str()) {
            config.extra.insert("actModeApiModelId".to_string(), Value::String(model.to_string()));
        }
    }
    
    Ok(config)
}

/// 写入 Cline 供应商配置
/// 使用 patch 策略，只更新管理的字段，保留其他 globalState 内容
/// 写入 8 个管理字段
/// 
/// 注意：Cline 的 globalState.json 直接使用字段名，不是 "cline.provider.xxx" 格式
/// 注意：apiKey 和 openAiApiKey 不在 globalState.json 中，不需要写入
pub fn write_cline_provider_config(config: &ClineProviderConfig) -> Result<(), AppError> {
    let mut global_state = read_cline_global_state()?;
    
    if let Some(obj) = global_state.as_object_mut() {
        // 更新 8 个管理字段（直接使用字段名，不是 "cline.provider.xxx" 格式）
        
        // 1. planModeApiProvider
        if let Some(provider) = config.extra.get("planModeApiProvider").and_then(|v| v.as_str()) {
            obj.insert("planModeApiProvider".to_string(), Value::String(provider.to_string()));
        }
        
        // 2. actModeApiProvider
        if let Some(provider) = config.extra.get("actModeApiProvider").and_then(|v| v.as_str()) {
            obj.insert("actModeApiProvider".to_string(), Value::String(provider.to_string()));
        }
        
        // 3. authProtocol (如果存在且与 planModeApiProvider 不同，也写入)
        if let Some(auth_protocol) = config.extra.get("authProtocol").and_then(|v| v.as_str()) {
            // 只有当 authProtocol 与 planModeApiProvider 不同时才写入
            let plan_provider = config.extra.get("planModeApiProvider").and_then(|v| v.as_str()).unwrap_or("");
            if auth_protocol != plan_provider {
                obj.insert("authProtocol".to_string(), Value::String(auth_protocol.to_string()));
            }
        }
        
        // 4. openAiBaseUrl
        if let Some(url) = config.extra.get("openAiBaseUrl").and_then(|v| v.as_str()) {
            obj.insert("openAiBaseUrl".to_string(), Value::String(url.to_string()));
        }
        
        // 5. planModeOpenAiModelId
        if let Some(model) = config.extra.get("planModeOpenAiModelId").and_then(|v| v.as_str()) {
            obj.insert("planModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 6. actModeOpenAiModelId
        if let Some(model) = config.extra.get("actModeOpenAiModelId").and_then(|v| v.as_str()) {
            obj.insert("actModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 7. anthropicBaseUrl
        if let Some(url) = config.extra.get("anthropicBaseUrl").and_then(|v| v.as_str()) {
            obj.insert("anthropicBaseUrl".to_string(), Value::String(url.to_string()));
        }
        
        // 8. planModeApiModelId
        if let Some(model) = config.extra.get("planModeApiModelId").and_then(|v| v.as_str()) {
            obj.insert("planModeApiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 9. actModeApiModelId
        if let Some(model) = config.extra.get("actModeApiModelId").and_then(|v| v.as_str()) {
            obj.insert("actModeApiModelId".to_string(), Value::String(model.to_string()));
        }
        
        // 注意：不写入 apiKey 和 openAiApiKey，这些字段不在 globalState.json 中
    }
    
    write_cline_global_state(&global_state)
}

/// 将 ClineProviderConfig 转换为 settings_config 格式的 JSON Value
/// 转换为表单需要的 8 个字段格式
/// 注意：apiKey 和 openAiApiKey 不在 globalState.json 中，不包含在输出中
impl From<ClineProviderConfig> for Value {
    fn from(config: ClineProviderConfig) -> Self {
        let mut map = serde_json::Map::new();
        
        // 1. authProtocol
        if let Some(auth_protocol) = config.extra.get("authProtocol").and_then(|v| v.as_str()) {
            map.insert("authProtocol".to_string(), Value::String(auth_protocol.to_string()));
        } else {
            // 默认值
            map.insert("authProtocol".to_string(), Value::String("anthropic".to_string()));
        }
        
        // 2. planModeApiProvider
        if let Some(provider) = config.extra.get("planModeApiProvider").and_then(|v| v.as_str()) {
            map.insert("planModeApiProvider".to_string(), Value::String(provider.to_string()));
        } else if let Some(auth_protocol) = config.extra.get("authProtocol").and_then(|v| v.as_str()) {
            // 如果没有 planModeApiProvider，使用 authProtocol
            map.insert("planModeApiProvider".to_string(), Value::String(auth_protocol.to_string()));
        } else {
            map.insert("planModeApiProvider".to_string(), Value::String("anthropic".to_string()));
        }
        
        // 3. actModeApiProvider
        if let Some(provider) = config.extra.get("actModeApiProvider").and_then(|v| v.as_str()) {
            map.insert("actModeApiProvider".to_string(), Value::String(provider.to_string()));
        } else if let Some(auth_protocol) = config.extra.get("authProtocol").and_then(|v| v.as_str()) {
            // 如果没有 actModeApiProvider，使用 authProtocol
            map.insert("actModeApiProvider".to_string(), Value::String(auth_protocol.to_string()));
        } else {
            map.insert("actModeApiProvider".to_string(), Value::String("anthropic".to_string()));
        }
        
        // 4. openAiBaseUrl
        if let Some(url) = config.extra.get("openAiBaseUrl").and_then(|v| v.as_str()) {
            map.insert("openAiBaseUrl".to_string(), Value::String(url.to_string()));
        } else {
            map.insert("openAiBaseUrl".to_string(), Value::String("".to_string()));
        }
        
        // 5. planModeOpenAiModelId
        if let Some(model) = config.extra.get("planModeOpenAiModelId").and_then(|v| v.as_str()) {
            map.insert("planModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        } else {
            map.insert("planModeOpenAiModelId".to_string(), Value::String("".to_string()));
        }
        
        // 6. actModeOpenAiModelId
        if let Some(model) = config.extra.get("actModeOpenAiModelId").and_then(|v| v.as_str()) {
            map.insert("actModeOpenAiModelId".to_string(), Value::String(model.to_string()));
        } else {
            map.insert("actModeOpenAiModelId".to_string(), Value::String("".to_string()));
        }
        
        // 7. anthropicBaseUrl
        if let Some(url) = config.extra.get("anthropicBaseUrl").and_then(|v| v.as_str()) {
            map.insert("anthropicBaseUrl".to_string(), Value::String(url.to_string()));
        } else {
            map.insert("anthropicBaseUrl".to_string(), Value::String("".to_string()));
        }
        
        // 9. planModeApiModelId
        if let Some(model) = config.extra.get("planModeApiModelId").and_then(|v| v.as_str()) {
            map.insert("planModeApiModelId".to_string(), Value::String(model.to_string()));
        } else if let Some(model) = config.model {
            // 兼容旧格式
            map.insert("planModeApiModelId".to_string(), Value::String(model));
        } else {
            map.insert("planModeApiModelId".to_string(), Value::String("".to_string()));
        }
        
        // 8. actModeApiModelId
        if let Some(model) = config.extra.get("actModeApiModelId").and_then(|v| v.as_str()) {
            map.insert("actModeApiModelId".to_string(), Value::String(model.to_string()));
        } else {
            map.insert("actModeApiModelId".to_string(), Value::String("".to_string()));
        }
        
        Value::Object(map)
    }
}

/// 从 settings_config 格式的 JSON Value 创建 ClineProviderConfig
/// 从表单提交的 8 个字段格式转换为 ClineProviderConfig
/// 注意：apiKey 和 openAiApiKey 不在 globalState.json 中，不需要处理
impl TryFrom<Value> for ClineProviderConfig {
    type Error = AppError;
    
    fn try_from(value: Value) -> Result<Self, Self::Error> {
        let mut config = ClineProviderConfig::default();
        
        if let Some(obj) = value.as_object() {
            // 提取 8 个管理字段（不包括 apiKey 和 openAiApiKey）
            
            // 1. authProtocol
            if let Some(auth_protocol) = obj.get("authProtocol").and_then(|v| v.as_str()) {
                config.extra.insert("authProtocol".to_string(), Value::String(auth_protocol.to_string()));
            }
            
            // 2. planModeApiProvider
            if let Some(provider) = obj.get("planModeApiProvider").and_then(|v| v.as_str()) {
                config.extra.insert("planModeApiProvider".to_string(), Value::String(provider.to_string()));
            }
            
            // 3. actModeApiProvider
            if let Some(provider) = obj.get("actModeApiProvider").and_then(|v| v.as_str()) {
                config.extra.insert("actModeApiProvider".to_string(), Value::String(provider.to_string()));
            }
            
            // 4. openAiBaseUrl
            if let Some(url) = obj.get("openAiBaseUrl").and_then(|v| v.as_str()) {
                config.extra.insert("openAiBaseUrl".to_string(), Value::String(url.to_string()));
            }
            
            // 5. planModeOpenAiModelId
            if let Some(model) = obj.get("planModeOpenAiModelId").and_then(|v| v.as_str()) {
                config.extra.insert("planModeOpenAiModelId".to_string(), Value::String(model.to_string()));
            }
            
            // 6. actModeOpenAiModelId
            if let Some(model) = obj.get("actModeOpenAiModelId").and_then(|v| v.as_str()) {
                config.extra.insert("actModeOpenAiModelId".to_string(), Value::String(model.to_string()));
            }
            
            // 7. anthropicBaseUrl
            if let Some(base_url) = obj.get("anthropicBaseUrl")
                .or_else(|| obj.get("baseUrl"))
                .or_else(|| obj.get("base_url"))
                .and_then(|v| v.as_str()) {
                config.extra.insert("anthropicBaseUrl".to_string(), Value::String(base_url.to_string()));
            }
            
            // 9. planModeApiModelId
            if let Some(model) = obj.get("planModeApiModelId").and_then(|v| v.as_str()) {
                config.extra.insert("planModeApiModelId".to_string(), Value::String(model.to_string()));
            } else if let Some(model) = obj.get("model").and_then(|v| v.as_str()) {
                // 兼容旧格式
                config.model = Some(model.to_string());
            }
            
            // 8. actModeApiModelId
            if let Some(model) = obj.get("actModeApiModelId").and_then(|v| v.as_str()) {
                config.extra.insert("actModeApiModelId".to_string(), Value::String(model.to_string()));
            }
        }
        
        Ok(config)
    }
}
