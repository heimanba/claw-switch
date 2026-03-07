//! Provider service module
//!
//! Handles provider CRUD operations, switching, and configuration management.

mod endpoints;
mod gemini_auth;
pub mod live;
mod usage;

use indexmap::IndexMap;
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;

use crate::app_config::AppType;
use crate::error::AppError;
use crate::provider::{Provider, UsageResult};
use crate::services::mcp::McpService;
use crate::settings::CustomEndpoint;
use crate::store::AppState;

// Re-export sub-module functions for external access
pub use live::{
    import_default_config, import_openclaw_providers_from_live,
    import_opencode_providers_from_live, read_live_settings, sync_current_to_live,
};

// Internal re-exports (pub(crate))
pub(crate) use live::sanitize_claude_settings_for_live;
pub(crate) use live::write_live_snapshot;

// Internal re-exports
use live::{
    remove_openclaw_provider_from_live, remove_opencode_provider_from_live, write_gemini_live,
};
use usage::validate_usage_script;

/// Extract base URL from Qwen settings config
/// 
/// Priority:
/// 1. Match provider by model.name (if provided)
/// 2. First provider of the first provider type
/// 3. Empty string as fallback
pub(crate) fn extract_qwen_base_url(settings_config: &Value) -> String {
    let model_providers = match settings_config.get("modelProviders").and_then(|v| v.as_object()) {
        Some(mp) => mp,
        None => return String::new(),
    };

    // Try to get model.name for matching
    let model_name = settings_config
        .get("model")
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str());

    // Iterate through all provider types (openai, anthropic, gemini, vertex-ai)
    for (_, providers_value) in model_providers.iter() {
        let providers = match providers_value.as_array() {
            Some(arr) if !arr.is_empty() => arr,
            _ => continue,
        };

        // If we have a model name, try to match it
        if let Some(name) = model_name {
            for provider in providers.iter() {
                let provider_id = provider.get("id").and_then(|v| v.as_str());
                let provider_name = provider.get("name").and_then(|v| v.as_str());
                
                if provider_id == Some(name) || provider_name == Some(name) {
                    if let Some(base_url) = provider.get("baseUrl").and_then(|v| v.as_str()) {
                        return base_url.to_string();
                    }
                }
            }
        }

        // Fallback: use first provider's baseUrl
        if let Some(base_url) = providers[0]
            .get("baseUrl")
            .and_then(|v| v.as_str())
        {
            return base_url.to_string();
        }
    }

    String::new()
}

/// Provider business logic service
pub struct ProviderService;

/// Result of a provider switch operation, including any non-fatal warnings
#[derive(Debug, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub warnings: Vec<String>,
}

/// Result of "test connection" (endpoint + API key probe) – shared by all providers
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestConnectionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    /// English fallback message (for logging / unknown errors).
    /// Frontend should prefer `error_code` for i18n display.
    pub message: String,
    /// Semantic error code for frontend i18n translation (e.g. "missingUrl", "invalidUrl", "timeout").
    /// Only present when `ok` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

/// Alias kept for backward compatibility
pub type QwenTestConnectionResult = ProviderTestConnectionResult;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validate_provider_settings_rejects_missing_auth() {
        let provider = Provider::with_id(
            "codex".into(),
            "Codex".into(),
            json!({ "config": "base_url = \"https://example.com\"" }),
            None,
        );
        let err = ProviderService::validate_provider_settings(&AppType::Codex, &provider)
            .expect_err("missing auth should be rejected");
        assert!(
            err.to_string().contains("auth"),
            "expected auth error, got {err:?}"
        );
    }

    #[test]
    fn extract_credentials_returns_expected_values() {
        let provider = Provider::with_id(
            "claude".into(),
            "Claude".into(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "token",
                    "ANTHROPIC_BASE_URL": "https://claude.example"
                }
            }),
            None,
        );
        let (api_key, base_url) =
            ProviderService::extract_credentials(&provider, &AppType::Claude).unwrap();
        assert_eq!(api_key, "token");
        assert_eq!(base_url, "https://claude.example");
    }

    #[test]
    fn extract_codex_common_config_preserves_mcp_servers_base_url() {
        let config_toml = r#"model_provider = "azure"
model = "gpt-4"
disable_response_storage = true

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://azure.example/v1"
wire_api = "responses"

[mcp_servers.my_server]
base_url = "http://localhost:8080"
"#;

        let settings = json!({ "config": config_toml });
        let extracted = ProviderService::extract_codex_common_config(&settings)
            .expect("extract_codex_common_config should succeed");

        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model_provider")),
            "should remove top-level model_provider"
        );
        assert!(
            !extracted
                .lines()
                .any(|line| line.trim_start().starts_with("model =")),
            "should remove top-level model"
        );
        assert!(
            !extracted.contains("[model_providers"),
            "should remove entire model_providers table"
        );
        assert!(
            extracted.contains("http://localhost:8080"),
            "should keep mcp_servers.* base_url"
        );
    }
}

impl ProviderService {
    fn normalize_provider_if_claude(app_type: &AppType, provider: &mut Provider) {
        if matches!(app_type, AppType::Claude) {
            let mut v = provider.settings_config.clone();
            if normalize_claude_models_in_value(&mut v) {
                provider.settings_config = v;
            }
        }
    }

    /// List all providers for an app type
    pub fn list(
        state: &AppState,
        app_type: AppType,
    ) -> Result<IndexMap<String, Provider>, AppError> {
        state.db.get_all_providers(app_type.as_str())
    }

    /// Get current provider ID
    ///
    /// 使用有效的当前供应商 ID（验证过存在性）。
    /// 优先从本地 settings 读取，验证后 fallback 到数据库的 is_current 字段。
    /// 这确保了云同步场景下多设备可以独立选择供应商，且返回的 ID 一定有效。
    ///
    /// 对于累加模式应用（OpenCode, OpenClaw），不存在"当前供应商"概念，直接返回空字符串。
    pub fn current(state: &AppState, app_type: AppType) -> Result<String, AppError> {
        // Additive mode apps have no "current" provider concept
        if app_type.is_additive_mode() {
            return Ok(String::new());
        }
        crate::settings::get_effective_current_provider(&state.db, &app_type)
            .map(|opt| opt.unwrap_or_default())
    }

    /// Add a new provider
    pub fn add(state: &AppState, app_type: AppType, provider: Provider) -> Result<bool, AppError> {
        let mut provider = provider;
        // Normalize Claude model keys
        Self::normalize_provider_if_claude(&app_type, &mut provider);
        Self::validate_provider_settings(&app_type, &provider)?;

        // Save to database
        state.db.save_provider(app_type.as_str(), &provider)?;

        // Additive mode apps (OpenCode, OpenClaw) - always write to live config
        if app_type.is_additive_mode() {
            // OMO / OMO Slim providers use exclusive mode and write to dedicated config file.
            if matches!(app_type, AppType::OpenCode)
                && matches!(provider.category.as_deref(), Some("omo") | Some("omo-slim"))
            {
                // Do not auto-enable newly added OMO / OMO Slim providers.
                // Users must explicitly switch/apply an OMO provider to activate it.
                return Ok(true);
            }
            write_live_snapshot(&app_type, &provider)?;
            return Ok(true);
        }

        // For other apps: Check if sync is needed (if this is current provider, or no current provider)
        let current = state.db.get_current_provider(app_type.as_str())?;
        if current.is_none() {
            // No current provider, set as current and sync
            state
                .db
                .set_current_provider(app_type.as_str(), &provider.id)?;
            write_live_snapshot(&app_type, &provider)?;
        }

        Ok(true)
    }

    /// Update a provider
    pub fn update(
        state: &AppState,
        app_type: AppType,
        provider: Provider,
    ) -> Result<bool, AppError> {
        let mut provider = provider;
        // Normalize Claude model keys
        Self::normalize_provider_if_claude(&app_type, &mut provider);
        Self::validate_provider_settings(&app_type, &provider)?;

        // Save to database
        state.db.save_provider(app_type.as_str(), &provider)?;

        // Additive mode apps (OpenCode, OpenClaw) - always update in live config
        if app_type.is_additive_mode() {
            if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo")
            {
                let is_omo_current =
                    state
                        .db
                        .is_omo_provider_current(app_type.as_str(), &provider.id, "omo")?;
                if is_omo_current {
                    crate::services::OmoService::write_config_to_file(
                        state,
                        &crate::services::omo::STANDARD,
                    )?;
                }
                return Ok(true);
            }
            if matches!(app_type, AppType::OpenCode)
                && provider.category.as_deref() == Some("omo-slim")
            {
                let is_current = state.db.is_omo_provider_current(
                    app_type.as_str(),
                    &provider.id,
                    "omo-slim",
                )?;
                if is_current {
                    crate::services::OmoService::write_config_to_file(
                        state,
                        &crate::services::omo::SLIM,
                    )?;
                }
                return Ok(true);
            }
            write_live_snapshot(&app_type, &provider)?;
            return Ok(true);
        }

        // For other apps: Check if this is current provider (use effective current, not just DB)
        let effective_current =
            crate::settings::get_effective_current_provider(&state.db, &app_type)?;
        let is_current = effective_current.as_deref() == Some(provider.id.as_str());

        if is_current {
            // 如果代理接管模式处于激活状态，并且代理服务正在运行：
            // - 不写 Live 配置（否则会破坏接管）
            // - 仅更新 Live 备份（保证关闭代理时能恢复到最新配置）
            let is_app_taken_over =
                futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))
                    .ok()
                    .flatten()
                    .is_some();
            let is_proxy_running = futures::executor::block_on(state.proxy_service.is_running());
            let should_skip_live_write = is_app_taken_over && is_proxy_running;

            if should_skip_live_write {
                futures::executor::block_on(
                    state
                        .proxy_service
                        .update_live_backup_from_provider(app_type.as_str(), &provider),
                )
                .map_err(|e| AppError::Message(format!("更新 Live 备份失败: {e}")))?;
            } else {
                write_live_snapshot(&app_type, &provider)?;
                // Sync MCP
                McpService::sync_all_enabled(state)?;
            }
        }

        Ok(true)
    }

    /// Delete a provider
    ///
    /// 同时检查本地 settings 和数据库的当前供应商，防止删除任一端正在使用的供应商。
    /// 对于累加模式应用（OpenCode, OpenClaw），可以随时删除任意供应商，同时从 live 配置中移除。
    pub fn delete(state: &AppState, app_type: AppType, id: &str) -> Result<(), AppError> {
        // Additive mode apps - no current provider concept
        if app_type.is_additive_mode() {
            if matches!(app_type, AppType::OpenCode) {
                let provider_category = state
                    .db
                    .get_provider_by_id(id, app_type.as_str())?
                    .and_then(|p| p.category);

                if provider_category.as_deref() == Some("omo") {
                    let was_current =
                        state
                            .db
                            .is_omo_provider_current(app_type.as_str(), id, "omo")?;

                    state.db.delete_provider(app_type.as_str(), id)?;
                    if was_current {
                        crate::services::OmoService::delete_config_file(
                            &crate::services::omo::STANDARD,
                        )?;
                    }
                    return Ok(());
                }

                if provider_category.as_deref() == Some("omo-slim") {
                    let was_current =
                        state
                            .db
                            .is_omo_provider_current(app_type.as_str(), id, "omo-slim")?;

                    state.db.delete_provider(app_type.as_str(), id)?;
                    if was_current {
                        crate::services::OmoService::delete_config_file(
                            &crate::services::omo::SLIM,
                        )?;
                    }
                    return Ok(());
                }
            }
            // Remove from database
            state.db.delete_provider(app_type.as_str(), id)?;
            // Also remove from live config
            match app_type {
                AppType::OpenCode => remove_opencode_provider_from_live(id)?,
                AppType::OpenClaw => remove_openclaw_provider_from_live(id)?,
                _ => {} // Should not reach here
            }
            return Ok(());
        }

        // For other apps: Check both local settings and database
        let local_current = crate::settings::get_current_provider(&app_type);
        let db_current = state.db.get_current_provider(app_type.as_str())?;

        // 如果本地配置文件不存在，说明 app 未安装或配置已被清除，
        // 此时忽略所有"使用中"限制，允许直接删除。
        let live_config_exists = Self::app_live_config_exists(&app_type);

        if !live_config_exists {
            return state.db.delete_provider(app_type.as_str(), id);
        }

        // 对于 switch-mode 的 app：配置文件存在但 CLI 未安装时，也允许直接删除。
        // 用户可能已卸载 CLI，但配置文件仍残留，此时不应阻止删除供应商。
        // 同时清理 live config 文件，防止删除后 DB 为空时重新 import。
        if !crate::commands::is_cli_installed(&app_type) {
            state.db.delete_provider(app_type.as_str(), id)?;
            Self::remove_live_config_file(&app_type);
            return Ok(());
        }

        let blocked_by_local = local_current.as_deref() == Some(id);
        let blocked_by_db = db_current.as_deref() == Some(id);

        if blocked_by_local || blocked_by_db {
            return Err(AppError::Message(
                "无法删除当前正在使用的供应商".to_string(),
            ));
        }

        state.db.delete_provider(app_type.as_str(), id)
    }

    /// 删除 app 的 live config 文件（用于 CLI 未安装时清理残留配置）。
    ///
    /// 静默忽略错误，避免影响主流程。
    fn remove_live_config_file(app_type: &AppType) {
        let path = match app_type {
            AppType::Claude => crate::config::get_claude_settings_path(),
            AppType::Codex => crate::codex_config::get_codex_config_path(),
            AppType::Gemini => crate::gemini_config::get_gemini_settings_path(),
            AppType::Qwen => crate::qwen_config::get_qwen_settings_path(),
            AppType::Cline => {
                if let Ok(p) = crate::cline_config::get_cline_global_state_path() {
                    p
                } else {
                    return;
                }
            }
            // Additive mode apps don't use a single live config file
            AppType::OpenCode | AppType::OpenClaw => return,
        };
        if path.exists() {
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("[delete] Failed to remove live config {:?}: {e}", path);
            } else {
                log::info!("[delete] Removed live config {:?}", path);
            }
        }
    }

    /// 检查指定 app 的本地配置文件是否存在。
    ///
    /// 用于删除逻辑：若本地配置文件不存在（app 未安装或配置已被清除），
    /// 则不应因 local_current 而阻止删除操作。
    pub fn app_live_config_exists(app_type: &AppType) -> bool {
        match app_type {
            AppType::Claude => crate::config::get_claude_settings_path().exists(),
            AppType::Codex => crate::codex_config::get_codex_config_path().exists(),
            AppType::Gemini => crate::gemini_config::get_gemini_settings_path().exists(),
            AppType::Qwen => crate::qwen_config::get_qwen_settings_path().exists(),
            AppType::OpenCode => crate::opencode_config::get_opencode_config_path().exists(),
            AppType::OpenClaw => crate::openclaw_config::get_openclaw_config_path().exists(),
            AppType::Cline => crate::cline_config::get_cline_settings_path().exists(),
        }
    }

    /// Remove provider from live config only (for additive mode apps like OpenCode, OpenClaw)
    ///
    /// Does NOT delete from database - provider remains in the list.
    /// This is used when user wants to "remove" a provider from active config
    /// but keep it available for future use.
    pub fn remove_from_live_config(
        state: &AppState,
        app_type: AppType,
        id: &str,
    ) -> Result<(), AppError> {
        match app_type {
            AppType::OpenCode => {
                let provider_category = state
                    .db
                    .get_provider_by_id(id, app_type.as_str())?
                    .and_then(|p| p.category);

                if provider_category.as_deref() == Some("omo") {
                    state
                        .db
                        .clear_omo_provider_current(app_type.as_str(), id, "omo")?;
                    let still_has_current = state
                        .db
                        .get_current_omo_provider("opencode", "omo")?
                        .is_some();
                    if still_has_current {
                        crate::services::OmoService::write_config_to_file(
                            state,
                            &crate::services::omo::STANDARD,
                        )?;
                    } else {
                        crate::services::OmoService::delete_config_file(
                            &crate::services::omo::STANDARD,
                        )?;
                    }
                } else if provider_category.as_deref() == Some("omo-slim") {
                    state
                        .db
                        .clear_omo_provider_current(app_type.as_str(), id, "omo-slim")?;
                    let still_has_current = state
                        .db
                        .get_current_omo_provider("opencode", "omo-slim")?
                        .is_some();
                    if still_has_current {
                        crate::services::OmoService::write_config_to_file(
                            state,
                            &crate::services::omo::SLIM,
                        )?;
                    } else {
                        crate::services::OmoService::delete_config_file(
                            &crate::services::omo::SLIM,
                        )?;
                    }
                } else {
                    remove_opencode_provider_from_live(id)?;
                }
            }
            AppType::OpenClaw => {
                remove_openclaw_provider_from_live(id)?;
            }
            _ => {
                return Err(AppError::Message(format!(
                    "App {} does not support remove from live config",
                    app_type.as_str()
                )));
            }
        }
        Ok(())
    }

    /// Switch to a provider
    ///
    /// Switch flow:
    /// 1. Validate target provider exists
    /// 2. Check if proxy takeover mode is active AND proxy server is running
    /// 3. If takeover mode active: hot-switch proxy target only (no Live config write)
    /// 4. If normal mode:
    ///    a. **Backfill mechanism**: Backfill current live config to current provider
    ///    b. Update local settings current_provider_xxx (device-level)
    ///    c. Update database is_current (as default for new devices)
    ///    d. Write target provider config to live files
    ///    e. Sync MCP configuration
    pub fn switch(state: &AppState, app_type: AppType, id: &str) -> Result<SwitchResult, AppError> {
        // Check if provider exists
        let providers = state.db.get_all_providers(app_type.as_str())?;
        let _provider = providers
            .get(id)
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

        // OMO providers are switched through their own exclusive path.
        if matches!(app_type, AppType::OpenCode) && _provider.category.as_deref() == Some("omo") {
            return Self::switch_normal(state, app_type, id, &providers);
        }

        // OMO Slim providers are switched through their own exclusive path.
        if matches!(app_type, AppType::OpenCode)
            && _provider.category.as_deref() == Some("omo-slim")
        {
            return Self::switch_normal(state, app_type, id, &providers);
        }

        // Check if proxy takeover mode is active AND proxy server is actually running
        // Both conditions must be true to use hot-switch mode
        // Use blocking wait since this is a sync function
        let is_app_taken_over =
            futures::executor::block_on(state.db.get_live_backup(app_type.as_str()))
                .ok()
                .flatten()
                .is_some();
        let is_proxy_running = futures::executor::block_on(state.proxy_service.is_running());
        let live_taken_over = state
            .proxy_service
            .detect_takeover_in_live_config_for_app(&app_type);

        // Hot-switch only when BOTH: this app is taken over AND proxy server is actually running
        let should_hot_switch = (is_app_taken_over || live_taken_over) && is_proxy_running;

        if should_hot_switch {
            // Proxy takeover mode: hot-switch only, don't write Live config
            log::info!(
                "代理接管模式：热切换 {} 的目标供应商为 {}",
                app_type.as_str(),
                id
            );

            // 获取新供应商的完整配置（用于更新备份）
            let provider = providers
                .get(id)
                .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

            // Update database is_current
            state.db.set_current_provider(app_type.as_str(), id)?;

            // Update local settings for consistency
            crate::settings::set_current_provider(&app_type, Some(id))?;

            // 更新 Live 备份（确保代理关闭时恢复正确的供应商配置）
            futures::executor::block_on(
                state
                    .proxy_service
                    .update_live_backup_from_provider(app_type.as_str(), provider),
            )
            .map_err(|e| AppError::Message(format!("更新 Live 备份失败: {e}")))?;

            // 关键修复：接管模式下切换供应商不会写回 Live 配置，
            // 需要主动清理 Claude Live 中的“模型覆盖”字段，避免仍以旧模型名发起请求。
            if matches!(app_type, AppType::Claude) {
                if let Err(e) = state.proxy_service.cleanup_claude_model_overrides_in_live() {
                    log::warn!("清理 Claude Live 模型字段失败（不影响切换结果）: {e}");
                }
            }

            // Note: No Live config write, no MCP sync
            // The proxy server will route requests to the new provider via is_current
            return Ok(SwitchResult::default());
        }

        // Normal mode: full switch with Live config write
        Self::switch_normal(state, app_type, id, &providers)
    }

    /// Normal switch flow (non-proxy mode)
    fn switch_normal(
        state: &AppState,
        app_type: AppType,
        id: &str,
        providers: &indexmap::IndexMap<String, Provider>,
    ) -> Result<SwitchResult, AppError> {
        let provider = providers
            .get(id)
            .ok_or_else(|| AppError::Message(format!("供应商 {id} 不存在")))?;

        if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo") {
            state
                .db
                .set_omo_provider_current(app_type.as_str(), id, "omo")?;
            crate::services::OmoService::write_config_to_file(
                state,
                &crate::services::omo::STANDARD,
            )?;
            // OMO ↔ OMO Slim mutually exclusive: remove Slim config
            let _ = crate::services::OmoService::delete_config_file(&crate::services::omo::SLIM);
            return Ok(SwitchResult::default());
        }

        if matches!(app_type, AppType::OpenCode) && provider.category.as_deref() == Some("omo-slim")
        {
            state
                .db
                .set_omo_provider_current(app_type.as_str(), id, "omo-slim")?;
            crate::services::OmoService::write_config_to_file(state, &crate::services::omo::SLIM)?;
            // OMO ↔ OMO Slim mutually exclusive: remove Standard config
            let _ =
                crate::services::OmoService::delete_config_file(&crate::services::omo::STANDARD);
            return Ok(SwitchResult::default());
        }

        let mut result = SwitchResult::default();

        // Backfill: Backfill current live config to current provider
        // Use effective current provider (validated existence) to ensure backfill targets valid provider
        let current_id = crate::settings::get_effective_current_provider(&state.db, &app_type)?;

        if let Some(current_id) = current_id {
            if current_id != id {
                // Additive mode apps - all providers coexist in the same file,
                // no backfill needed (backfill is for exclusive mode apps like Claude/Codex/Gemini)
                if !app_type.is_additive_mode() {
                    // Only backfill when switching to a different provider
                    if let Ok(live_config) = read_live_settings(app_type.clone()) {
                        if let Some(mut current_provider) = providers.get(&current_id).cloned() {
                            current_provider.settings_config = live_config;
                            if let Err(e) =
                                state.db.save_provider(app_type.as_str(), &current_provider)
                            {
                                log::warn!("Backfill failed: {e}");
                                result
                                    .warnings
                                    .push(format!("backfill_failed:{current_id}"));
                            }
                        }
                    }
                }
            }
        }

        // Additive mode apps skip setting is_current (no such concept)
        if !app_type.is_additive_mode() {
            // Update local settings (device-level, takes priority)
            crate::settings::set_current_provider(&app_type, Some(id))?;

            // Update database is_current (as default for new devices)
            state.db.set_current_provider(app_type.as_str(), id)?;
        }

        // Sync to live (write_gemini_live handles security flag internally for Gemini)
        write_live_snapshot(&app_type, provider)?;

        // Sync MCP
        McpService::sync_all_enabled(state)?;

        Ok(result)
    }

    /// Sync current provider to live configuration (re-export)
    pub fn sync_current_to_live(state: &AppState) -> Result<(), AppError> {
        sync_current_to_live(state)
    }

    /// Extract common config snippet from current provider
    ///
    /// Extracts the current provider's configuration and removes provider-specific fields
    /// (API keys, model settings, endpoints) to create a reusable common config snippet.
    pub fn extract_common_config_snippet(
        state: &AppState,
        app_type: AppType,
    ) -> Result<String, AppError> {
        // Get current provider
        let current_id = Self::current(state, app_type.clone())?;
        if current_id.is_empty() {
            return Err(AppError::Message("No current provider".to_string()));
        }

        let providers = state.db.get_all_providers(app_type.as_str())?;
        let provider = providers
            .get(&current_id)
            .ok_or_else(|| AppError::Message(format!("Provider {current_id} not found")))?;

        match app_type {
            AppType::Claude => Self::extract_claude_common_config(&provider.settings_config),
            AppType::Codex => Self::extract_codex_common_config(&provider.settings_config),
            AppType::Gemini => Self::extract_gemini_common_config(&provider.settings_config),
            AppType::OpenCode => Self::extract_opencode_common_config(&provider.settings_config),
            AppType::OpenClaw => Self::extract_openclaw_common_config(&provider.settings_config),
            AppType::Qwen => Self::extract_qwen_common_config(&provider.settings_config),
            AppType::Cline => Self::extract_cline_common_config(&provider.settings_config),
        }
    }

    /// Extract common config snippet from a config value (e.g. editor content).
    pub fn extract_common_config_snippet_from_settings(
        app_type: AppType,
        settings_config: &Value,
    ) -> Result<String, AppError> {
        match app_type {
            AppType::Claude => Self::extract_claude_common_config(settings_config),
            AppType::Codex => Self::extract_codex_common_config(settings_config),
            AppType::Gemini => Self::extract_gemini_common_config(settings_config),
            AppType::OpenCode => Self::extract_opencode_common_config(settings_config),
            AppType::OpenClaw => Self::extract_openclaw_common_config(settings_config),
            AppType::Qwen => Self::extract_qwen_common_config(settings_config),
            AppType::Cline => Self::extract_cline_common_config(settings_config),
        }
    }

    /// Extract common config for Cline (JSON format)
    fn extract_cline_common_config(settings: &Value) -> Result<String, AppError> {
        // Cline uses similar structure to Claude but with different field names
        let mut config = settings.clone();

        // Fields to exclude from common config
        const EXCLUDES: &[&str] = &[
            "apiKey",
            "api_key",
            "baseUrl",
            "base_url",
            "model",
        ];

        // Remove excluded fields from top level
        if let Some(obj) = config.as_object_mut() {
            for key in EXCLUDES {
                obj.remove(*key);
            }
        }

        // Serialize to JSON string
        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Config(format!("Failed to serialize Cline config: {e}")))
    }

    /// Extract common config for Claude (JSON format)
    fn extract_claude_common_config(settings: &Value) -> Result<String, AppError> {
        let mut config = settings.clone();

        // Fields to exclude from common config
        const ENV_EXCLUDES: &[&str] = &[
            // Auth
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            // Models (5 fields)
            "ANTHROPIC_MODEL",
            "ANTHROPIC_REASONING_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            // Endpoint
            "ANTHROPIC_BASE_URL",
        ];

        const TOP_LEVEL_EXCLUDES: &[&str] = &[
            "apiBaseUrl",
            // Legacy model fields
            "primaryModel",
            "smallFastModel",
        ];

        // Remove env fields
        if let Some(env) = config.get_mut("env").and_then(|v| v.as_object_mut()) {
            for key in ENV_EXCLUDES {
                env.remove(*key);
            }
            // If env is empty after removal, remove the env object itself
            if env.is_empty() {
                config.as_object_mut().map(|obj| obj.remove("env"));
            }
        }

        // Remove top-level fields
        if let Some(obj) = config.as_object_mut() {
            for key in TOP_LEVEL_EXCLUDES {
                obj.remove(*key);
            }
        }

        // Check if result is empty
        if config.as_object().is_none_or(|obj| obj.is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Extract common config for Codex (TOML format)
    fn extract_codex_common_config(settings: &Value) -> Result<String, AppError> {
        // Codex config is stored as { "auth": {...}, "config": "toml string" }
        let config_toml = settings
            .get("config")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if config_toml.is_empty() {
            return Ok(String::new());
        }

        let mut doc = config_toml
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| AppError::Message(format!("TOML parse error: {e}")))?;

        // Remove provider-specific fields.
        let root = doc.as_table_mut();
        root.remove("model");
        root.remove("model_provider");
        // Legacy/alt formats might use a top-level base_url.
        root.remove("base_url");

        // Remove entire model_providers table (provider-specific configuration)
        root.remove("model_providers");

        // Clean up multiple empty lines (keep at most one blank line).
        let mut cleaned = String::new();
        let mut blank_run = 0usize;
        for line in doc.to_string().lines() {
            if line.trim().is_empty() {
                blank_run += 1;
                if blank_run <= 1 {
                    cleaned.push('\n');
                }
                continue;
            }
            blank_run = 0;
            cleaned.push_str(line);
            cleaned.push('\n');
        }

        Ok(cleaned.trim().to_string())
    }

    /// Extract common config for Gemini (JSON format)
    ///
    /// Extracts `.env` values while excluding provider-specific credentials:
    /// - GOOGLE_GEMINI_BASE_URL
    /// - GEMINI_API_KEY
    fn extract_gemini_common_config(settings: &Value) -> Result<String, AppError> {
        let env = settings.get("env").and_then(|v| v.as_object());

        let mut snippet = serde_json::Map::new();
        if let Some(env) = env {
            for (key, value) in env {
                if key == "GOOGLE_GEMINI_BASE_URL" || key == "GEMINI_API_KEY" {
                    continue;
                }
                let Value::String(v) = value else {
                    continue;
                };
                let trimmed = v.trim();
                if !trimmed.is_empty() {
                    snippet.insert(key.to_string(), Value::String(trimmed.to_string()));
                }
            }
        }

        if snippet.is_empty() {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&Value::Object(snippet))
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Extract common config for OpenCode (JSON format)
    fn extract_opencode_common_config(settings: &Value) -> Result<String, AppError> {
        // OpenCode uses a different config structure with npm, options, models
        // For common config, we exclude provider-specific fields like apiKey
        let mut config = settings.clone();

        // Remove provider-specific fields
        if let Some(obj) = config.as_object_mut() {
            if let Some(options) = obj.get_mut("options").and_then(|v| v.as_object_mut()) {
                options.remove("apiKey");
                options.remove("baseURL");
            }
            // Keep npm and models as they might be common
        }

        if config.is_null() || (config.is_object() && config.as_object().unwrap().is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Extract common config for OpenClaw (JSON format)
    fn extract_openclaw_common_config(settings: &Value) -> Result<String, AppError> {
        // OpenClaw uses a different config structure with baseUrl, apiKey, api, models
        // For common config, we exclude provider-specific fields like apiKey
        let mut config = settings.clone();

        // Remove provider-specific fields
        if let Some(obj) = config.as_object_mut() {
            obj.remove("apiKey");
            obj.remove("baseUrl");
            // Keep api and models as they might be common
        }

        if config.is_null() || (config.is_object() && config.as_object().unwrap().is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    fn extract_qwen_common_config(settings: &Value) -> Result<String, AppError> {
        // Qwen uses a config structure with modelProviders, env, security, model
        // For common config, we exclude provider-specific fields like API keys
        let mut config = settings.clone();

        // Remove provider-specific fields (API keys from env)
        if let Some(obj) = config.as_object_mut() {
            if let Some(env) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
                // Remove all API key fields but keep the structure
                for (key, value) in env.iter_mut() {
                    if key.contains("API_KEY") || key.contains("TOKEN") {
                        *value = serde_json::Value::String("".to_string());
                    }
                }
            }
            // Remove deprecated auth fields if present
            if let Some(security) = obj.get_mut("security").and_then(|v| v.as_object_mut()) {
                if let Some(auth) = security.get_mut("auth").and_then(|v| v.as_object_mut()) {
                    auth.remove("apiKey");
                    auth.remove("baseUrl");
                }
            }
        }

        if config.is_null() || (config.is_object() && config.as_object().unwrap().is_empty()) {
            return Ok("{}".to_string());
        }

        serde_json::to_string_pretty(&config)
            .map_err(|e| AppError::Message(format!("Serialization failed: {e}")))
    }

    /// Import default configuration from live files (re-export)
    ///
    /// Returns `Ok(true)` if imported, `Ok(false)` if skipped.
    pub fn import_default_config(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
        import_default_config(state, app_type)
    }

    /// Read current live settings (re-export)
    pub fn read_live_settings(app_type: AppType) -> Result<Value, AppError> {
        read_live_settings(app_type)
    }

    /// Get custom endpoints list (re-export)
    pub fn get_custom_endpoints(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
    ) -> Result<Vec<CustomEndpoint>, AppError> {
        endpoints::get_custom_endpoints(state, app_type, provider_id)
    }

    /// Add custom endpoint (re-export)
    pub fn add_custom_endpoint(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::add_custom_endpoint(state, app_type, provider_id, url)
    }

    /// Remove custom endpoint (re-export)
    pub fn remove_custom_endpoint(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::remove_custom_endpoint(state, app_type, provider_id, url)
    }

    /// Update endpoint last used timestamp (re-export)
    pub fn update_endpoint_last_used(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        url: String,
    ) -> Result<(), AppError> {
        endpoints::update_endpoint_last_used(state, app_type, provider_id, url)
    }

    /// Update provider sort order
    pub fn update_sort_order(
        state: &AppState,
        app_type: AppType,
        updates: Vec<ProviderSortUpdate>,
    ) -> Result<bool, AppError> {
        let mut providers = state.db.get_all_providers(app_type.as_str())?;

        for update in updates {
            if let Some(provider) = providers.get_mut(&update.id) {
                provider.sort_index = Some(update.sort_index);
                state.db.save_provider(app_type.as_str(), provider)?;
            }
        }

        Ok(true)
    }

    /// Query provider usage (re-export)
    pub async fn query_usage(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
    ) -> Result<UsageResult, AppError> {
        usage::query_usage(state, app_type, provider_id).await
    }

    /// Test usage script (re-export)
    #[allow(clippy::too_many_arguments)]
    pub async fn test_usage_script(
        state: &AppState,
        app_type: AppType,
        provider_id: &str,
        script_code: &str,
        timeout: u64,
        api_key: Option<&str>,
        base_url: Option<&str>,
        access_token: Option<&str>,
        user_id: Option<&str>,
        template_type: Option<&str>,
    ) -> Result<UsageResult, AppError> {
        usage::test_usage_script(
            state,
            app_type,
            provider_id,
            script_code,
            timeout,
            api_key,
            base_url,
            access_token,
            user_id,
            template_type,
        )
        .await
    }

    pub(crate) fn write_gemini_live(provider: &Provider) -> Result<(), AppError> {
        write_gemini_live(provider)
    }

    fn validate_provider_settings(app_type: &AppType, provider: &Provider) -> Result<(), AppError> {
        match app_type {
            AppType::Claude => {
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.claude.settings.not_object",
                        "Claude 配置必须是 JSON 对象",
                        "Claude configuration must be a JSON object",
                    ));
                }
            }
            AppType::Codex => {
                let settings = provider.settings_config.as_object().ok_or_else(|| {
                    AppError::localized(
                        "provider.codex.settings.not_object",
                        "Codex 配置必须是 JSON 对象",
                        "Codex configuration must be a JSON object",
                    )
                })?;

                let auth = settings.get("auth").ok_or_else(|| {
                    AppError::localized(
                        "provider.codex.auth.missing",
                        format!("供应商 {} 缺少 auth 配置", provider.id),
                        format!("Provider {} is missing auth configuration", provider.id),
                    )
                })?;
                if !auth.is_object() {
                    return Err(AppError::localized(
                        "provider.codex.auth.not_object",
                        format!("供应商 {} 的 auth 配置必须是 JSON 对象", provider.id),
                        format!(
                            "Provider {} auth configuration must be a JSON object",
                            provider.id
                        ),
                    ));
                }

                if let Some(config_value) = settings.get("config") {
                    if !(config_value.is_string() || config_value.is_null()) {
                        return Err(AppError::localized(
                            "provider.codex.config.invalid_type",
                            "Codex config 字段必须是字符串",
                            "Codex config field must be a string",
                        ));
                    }
                    if let Some(cfg_text) = config_value.as_str() {
                        crate::codex_config::validate_config_toml(cfg_text)?;
                    }
                }
            }
            AppType::Gemini => {
                use crate::gemini_config::validate_gemini_settings;
                validate_gemini_settings(&provider.settings_config)?
            }
            AppType::OpenCode => {
                // OpenCode uses a different config structure: { npm, options, models }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.opencode.settings.not_object",
                        "OpenCode 配置必须是 JSON 对象",
                        "OpenCode configuration must be a JSON object",
                    ));
                }
            }
            AppType::OpenClaw => {
                // OpenClaw uses config structure: { baseUrl, apiKey, api, models }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.openclaw.settings.not_object",
                        "OpenClaw 配置必须是 JSON 对象",
                        "OpenClaw configuration must be a JSON object",
                    ));
                }
            }
            AppType::Qwen => {
                // Qwen uses config structure: { modelProviders, env, security, model }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.qwen.settings.not_object",
                        "Qwen Code 配置必须是 JSON 对象",
                        "Qwen Code configuration must be a JSON object",
                    ));
                }
            }
            AppType::Cline => {
                // Cline uses config structure: { apiKey, baseUrl, model, ... }
                // Basic validation - must be an object
                if !provider.settings_config.is_object() {
                    return Err(AppError::localized(
                        "provider.cline.settings.not_object",
                        "Cline 配置必须是 JSON 对象",
                        "Cline configuration must be a JSON object",
                    ));
                }
            }
        }

        // Validate and clean UsageScript configuration (common for all app types)
        if let Some(meta) = &provider.meta {
            if let Some(usage_script) = &meta.usage_script {
                validate_usage_script(usage_script)?;
            }
        }

        Ok(())
    }

    #[allow(dead_code)]
    fn extract_credentials(
        provider: &Provider,
        app_type: &AppType,
    ) -> Result<(String, String), AppError> {
        match app_type {
            AppType::Claude => {
                let env = provider
                    .settings_config
                    .get("env")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.env.missing",
                            "配置格式错误: 缺少 env",
                            "Invalid configuration: missing env section",
                        )
                    })?;

                let api_key = env
                    .get("ANTHROPIC_AUTH_TOKEN")
                    .or_else(|| env.get("ANTHROPIC_API_KEY"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = env
                    .get("ANTHROPIC_BASE_URL")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.claude.base_url.missing",
                            "缺少 ANTHROPIC_BASE_URL 配置",
                            "Missing ANTHROPIC_BASE_URL configuration",
                        )
                    })?
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::Codex => {
                let auth = provider
                    .settings_config
                    .get("auth")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.codex.auth.missing",
                            "配置格式错误: 缺少 auth",
                            "Invalid configuration: missing auth section",
                        )
                    })?;

                let api_key = auth
                    .get("OPENAI_API_KEY")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.codex.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let config_toml = provider
                    .settings_config
                    .get("config")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let base_url = if config_toml.contains("base_url") {
                    let re = Regex::new(r#"base_url\s*=\s*["']([^"']+)["']"#).map_err(|e| {
                        AppError::localized(
                            "provider.regex_init_failed",
                            format!("正则初始化失败: {e}"),
                            format!("Failed to initialize regex: {e}"),
                        )
                    })?;
                    re.captures(config_toml)
                        .and_then(|caps| caps.get(1))
                        .map(|m| m.as_str().to_string())
                        .ok_or_else(|| {
                            AppError::localized(
                                "provider.codex.base_url.invalid",
                                "config.toml 中 base_url 格式错误",
                                "base_url in config.toml has invalid format",
                            )
                        })?
                } else {
                    return Err(AppError::localized(
                        "provider.codex.base_url.missing",
                        "config.toml 中缺少 base_url 配置",
                        "base_url is missing from config.toml",
                    ));
                };

                Ok((api_key, base_url))
            }
            AppType::Gemini => {
                use crate::gemini_config::json_to_env;

                let env_map = json_to_env(&provider.settings_config)?;

                let api_key = env_map.get("GEMINI_API_KEY").cloned().ok_or_else(|| {
                    AppError::localized(
                        "gemini.missing_api_key",
                        "缺少 GEMINI_API_KEY",
                        "Missing GEMINI_API_KEY",
                    )
                })?;

                let base_url = env_map
                    .get("GOOGLE_GEMINI_BASE_URL")
                    .cloned()
                    .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string());

                Ok((api_key, base_url))
            }
            AppType::OpenCode => {
                // OpenCode uses options.apiKey and options.baseURL
                let options = provider
                    .settings_config
                    .get("options")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.opencode.options.missing",
                            "配置格式错误: 缺少 options",
                            "Invalid configuration: missing options section",
                        )
                    })?;

                let api_key = options
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.opencode.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = options
                    .get("baseURL")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::OpenClaw => {
                // OpenClaw uses apiKey and baseUrl directly on the object
                let api_key = provider
                    .settings_config
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.openclaw.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = provider
                    .settings_config
                    .get("baseUrl")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok((api_key, base_url))
            }
            AppType::Qwen => {
                // Qwen uses env for API keys and modelProviders for base URLs
                let env = provider
                    .settings_config
                    .get("env")
                    .and_then(|v| v.as_object())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.qwen.env.missing",
                            "配置格式错误: 缺少 env",
                            "Invalid configuration: missing env section",
                        )
                    })?;

                // Find first non-empty API key from env
                let api_key = env
                    .values()
                    .find_map(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.qwen.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                // Extract base URL from modelProviders using unified function
                let base_url = extract_qwen_base_url(&provider.settings_config);

                Ok((api_key, base_url))
            }
            AppType::Cline => {
                // Cline uses apiKey, baseUrl, model directly on the object
                let api_key = provider
                    .settings_config
                    .get("apiKey")
                    .or_else(|| provider.settings_config.get("api_key"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        AppError::localized(
                            "provider.cline.api_key.missing",
                            "缺少 API Key",
                            "API key is missing",
                        )
                    })?
                    .to_string();

                let base_url = provider
                    .settings_config
                    .get("baseUrl")
                    .or_else(|| provider.settings_config.get("base_url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                Ok((api_key, base_url))
            }
        }
    }
}

/// Normalize Claude model keys in a JSON value
///
/// Reads old key (ANTHROPIC_SMALL_FAST_MODEL), writes new keys (DEFAULT_*), and deletes old key.
pub(crate) fn normalize_claude_models_in_value(settings: &mut Value) -> bool {
    let mut changed = false;
    let env = match settings.get_mut("env").and_then(|v| v.as_object_mut()) {
        Some(obj) => obj,
        None => return changed,
    };

    let model = env
        .get("ANTHROPIC_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let small_fast = env
        .get("ANTHROPIC_SMALL_FAST_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let current_haiku = env
        .get("ANTHROPIC_DEFAULT_HAIKU_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let current_sonnet = env
        .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let current_opus = env
        .get("ANTHROPIC_DEFAULT_OPUS_MODEL")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let target_haiku = current_haiku
        .or_else(|| small_fast.clone())
        .or_else(|| model.clone());
    let target_sonnet = current_sonnet
        .or_else(|| model.clone())
        .or_else(|| small_fast.clone());
    let target_opus = current_opus
        .or_else(|| model.clone())
        .or_else(|| small_fast.clone());

    if env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").is_none() {
        if let Some(v) = target_haiku {
            env.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(),
                Value::String(v),
            );
            changed = true;
        }
    }
    if env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").is_none() {
        if let Some(v) = target_sonnet {
            env.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(),
                Value::String(v),
            );
            changed = true;
        }
    }
    if env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").is_none() {
        if let Some(v) = target_opus {
            env.insert("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), Value::String(v));
            changed = true;
        }
    }

    if env.remove("ANTHROPIC_SMALL_FAST_MODEL").is_some() {
        changed = true;
    }

    changed
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderSortUpdate {
    pub id: String,
    #[serde(rename = "sortIndex")]
    pub sort_index: usize,
}

// ============================================================================
// 统一供应商（Universal Provider）服务方法
// ============================================================================

use crate::provider::UniversalProvider;
use std::collections::HashMap;

impl ProviderService {
    /// 获取所有统一供应商
    pub fn list_universal(
        state: &AppState,
    ) -> Result<HashMap<String, UniversalProvider>, AppError> {
        state.db.get_all_universal_providers()
    }

    /// 获取单个统一供应商
    pub fn get_universal(
        state: &AppState,
        id: &str,
    ) -> Result<Option<UniversalProvider>, AppError> {
        state.db.get_universal_provider(id)
    }

    /// 添加或更新统一供应商（不自动同步，需手动调用 sync_universal_to_apps）
    pub fn upsert_universal(
        state: &AppState,
        provider: UniversalProvider,
    ) -> Result<bool, AppError> {
        // 保存统一供应商
        state.db.save_universal_provider(&provider)?;

        Ok(true)
    }

    /// 删除统一供应商
    pub fn delete_universal(state: &AppState, id: &str) -> Result<bool, AppError> {
        // 获取统一供应商（用于删除生成的子供应商）
        let provider = state.db.get_universal_provider(id)?;

        // 删除统一供应商
        state.db.delete_universal_provider(id)?;

        // 删除生成的子供应商
        if let Some(p) = provider {
            if p.apps.claude {
                let claude_id = format!("universal-claude-{id}");
                let _ = state.db.delete_provider("claude", &claude_id);
            }
            if p.apps.codex {
                let codex_id = format!("universal-codex-{id}");
                let _ = state.db.delete_provider("codex", &codex_id);
            }
            if p.apps.gemini {
                let gemini_id = format!("universal-gemini-{id}");
                let _ = state.db.delete_provider("gemini", &gemini_id);
            }
        }

        Ok(true)
    }

    /// 同步统一供应商到各应用
    pub fn sync_universal_to_apps(state: &AppState, id: &str) -> Result<bool, AppError> {
        let provider = state
            .db
            .get_universal_provider(id)?
            .ok_or_else(|| AppError::Message(format!("统一供应商 {id} 不存在")))?;

        // 同步到 Claude
        if let Some(mut claude_provider) = provider.to_claude_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&claude_provider.id, "claude")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &claude_provider.settings_config);
                claude_provider.settings_config = merged;
            }
            state.db.save_provider("claude", &claude_provider)?;
        } else {
            // 如果禁用了 Claude，删除对应的子供应商
            let claude_id = format!("universal-claude-{id}");
            let _ = state.db.delete_provider("claude", &claude_id);
        }

        // 同步到 Codex
        if let Some(mut codex_provider) = provider.to_codex_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&codex_provider.id, "codex")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &codex_provider.settings_config);
                codex_provider.settings_config = merged;
            }
            state.db.save_provider("codex", &codex_provider)?;
        } else {
            let codex_id = format!("universal-codex-{id}");
            let _ = state.db.delete_provider("codex", &codex_id);
        }

        // 同步到 Gemini
        if let Some(mut gemini_provider) = provider.to_gemini_provider() {
            // 合并已有配置
            if let Some(existing) = state.db.get_provider_by_id(&gemini_provider.id, "gemini")? {
                let mut merged = existing.settings_config.clone();
                Self::merge_json(&mut merged, &gemini_provider.settings_config);
                gemini_provider.settings_config = merged;
            }
            state.db.save_provider("gemini", &gemini_provider)?;
        } else {
            let gemini_id = format!("universal-gemini-{id}");
            let _ = state.db.delete_provider("gemini", &gemini_id);
        }

        Ok(true)
    }

    /// 递归合并 JSON：base 为底，patch 覆盖同名字段
    fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
        use serde_json::Value;

        match (base, patch) {
            (Value::Object(base_map), Value::Object(patch_map)) => {
                for (k, v_patch) in patch_map {
                    match base_map.get_mut(k) {
                        Some(v_base) => Self::merge_json(v_base, v_patch),
                        None => {
                            base_map.insert(k.clone(), v_patch.clone());
                        }
                    }
                }
            }
            // 其它类型：直接覆盖
            (base_val, patch_val) => {
                *base_val = patch_val.clone();
            }
        }
    }

    /// 检测 Qwen 配置一致性
    ///
    /// 比较表单字段与本地文件配置是否一致
    pub fn check_qwen_config_consistency(
        _state: &AppState,
        _provider_id: &str,
        form_config: &serde_json::Value,
    ) -> Result<bool, AppError> {
        use crate::qwen_config::get_qwen_settings_path;
        use crate::config::read_json_file;

        // 读取本地文件配置
        let path = get_qwen_settings_path();
        if !path.exists() {
            // 文件不存在，认为不一致（表单有配置但文件不存在）
            return Ok(false);
        }

        let file_config = read_json_file::<serde_json::Value>(&path)?;
        let result = Self::json_partial_equal(form_config, &file_config);
        // 仅比较表单中存在的字段
        Ok(result)
    }

    /// 刷新 Qwen 配置：从本地文件读取并更新数据库
    pub fn refresh_qwen_live_config(
        state: &AppState,
        provider_id: &str,
    ) -> Result<Provider, AppError> {
        use crate::qwen_config::get_qwen_settings_path;
        use crate::config::read_json_file;

        // 读取本地文件配置
        let path = get_qwen_settings_path();
        if !path.exists() {
            return Err(AppError::localized(
                "qwen.config.missing",
                "Qwen Code 配置文件不存在",
                "Qwen Code configuration file not found",
            ));
        }

        let file_config = read_json_file(&path)?;

        // 获取数据库中的 provider
        let mut provider = state
            .db
            .get_provider_by_id(provider_id, AppType::Qwen.as_str())?
            .ok_or_else(|| AppError::Message(format!("Provider {provider_id} not found")))?;

        // 更新配置
        provider.settings_config = file_config;

        // 保存到数据库
        state.db.save_provider(AppType::Qwen.as_str(), &provider)?;

        Ok(provider)
    }

    /// 测试 Qwen 连接：验证 Base URL 可达且 API Key 鉴权通过（不验证模型是否可调用）
    ///
    /// * `selected_type`: "openai" | "anthropic"（与表单认证协议一致）
    /// * `base_url`: 当前表单的 Base URL
    /// * `api_key`: 当前协议对应的 API Key
    pub async fn test_qwen_connection(
        selected_type: &str,
        base_url: &str,
        api_key: &str,
        model_name: &str,
    ) -> Result<QwenTestConnectionResult, AppError> {
        use std::time::Instant;

        let base_url = base_url.trim();
        let api_key = api_key.trim();

        if base_url.is_empty() {
            return Ok(QwenTestConnectionResult {
                ok: false,
                http_status: None,
                message: "Base URL is required".to_string(),
                error_code: Some("missingUrl".to_string()),
                latency_ms: None,
            });
        }
        if api_key.is_empty() {
            return Ok(QwenTestConnectionResult {
                ok: false,
                http_status: None,
                message: "API Key is required".to_string(),
                error_code: Some("missingKey".to_string()),
                latency_ms: None,
            });
        }

        if reqwest::Url::parse(base_url).is_err() {
            return Ok(QwenTestConnectionResult {
                ok: false,
                http_status: None,
                message: "Base URL format is invalid".to_string(),
                error_code: Some("invalidUrl".to_string()),
                latency_ms: None,
            });
        }

        // 测试连接使用一次性 client，禁用连接池，避免复用已断开的空闲连接导致偶发失败
        let timeout = std::time::Duration::from_secs(15); // 增加超时时间
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(std::time::Duration::from_secs(10))
            .pool_max_idle_per_host(0) // 禁用连接池
            .pool_idle_timeout(None) // 禁用空闲超时
            .tcp_keepalive(None) // 禁用 TCP keepalive
            .build()
            .unwrap_or_else(|_| crate::proxy::http_client::get());
        let start = Instant::now();

        let result = match selected_type.to_lowercase().as_str() {
            "openai" => {
                Self::probe_qwen_openai(&client, base_url, api_key, model_name, timeout).await
            }
            "anthropic" => {
                Self::probe_qwen_anthropic(&client, base_url, api_key, model_name, timeout).await
            }
            _ => {
                return Ok(QwenTestConnectionResult {
                    ok: false,
                    http_status: None,
                    message: format!("Unsupported protocol: {selected_type}. Only openai / anthropic are supported"),
                    error_code: Some("unsupportedType".to_string()),
                    latency_ms: None,
                });
            }
        };

        let latency_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(status) => Ok(QwenTestConnectionResult {
                ok: status >= 200 && status < 300,
                http_status: Some(status),
                message: if status >= 200 && status < 300 {
                    "Connection OK, API Key valid".to_string()
                } else if status == 401 || status == 403 {
                    "API Key invalid or unauthorized".to_string()
                } else {
                    format!("HTTP {status}")
                },
                error_code: if status >= 200 && status < 300 {
                    None
                } else if status == 401 || status == 403 {
                    Some("unauthorized".to_string())
                } else {
                    Some(format!("httpError_{status}"))
                },
                latency_ms: Some(latency_ms),
            }),
            Err(e) => {
                let msg = e.to_string();
                let (error_code, error_message) = if msg.contains("timeout") || msg.contains("Timed out") {
                    ("timeout", "Request timed out. Please check your network or Base URL.".to_string())
                } else if msg.contains("connection") || msg.contains("Connection refused") {
                    ("connectionRefused", "Connection refused. Please check Base URL or service availability.".to_string())
                } else if msg.contains("dns") || msg.contains("Name or service not known") {
                    ("dnsError", "DNS resolution failed. Please check Base URL format.".to_string())
                } else if msg.contains("SSL") || msg.contains("certificate") {
                    ("sslError", "SSL certificate error. Please check HTTPS configuration.".to_string())
                } else if msg.contains("Too many open files") {
                    ("resourceExhausted", "System resource exhausted. Please try again later.".to_string())
                } else {
                    ("networkError", format!("Network error: {}", msg))
                };
                
                Ok(QwenTestConnectionResult {
                    ok: false,
                    http_status: None,
                    message: error_message,
                    error_code: Some(error_code.to_string()),
                    latency_ms: Some(latency_ms),
                })
            }
        }
    }

    /// 测试 Provider 连接：通用方法，支持 openai / anthropic 协议
    ///
    /// * `selected_type`: "openai" | "anthropic"
    /// * `base_url`: API 端点
    /// * `api_key`: 对应协议的 API Key
    /// * `model_name`: 可选，测试使用的模型名，空则回退默认模型
    pub async fn test_provider_connection(
        selected_type: &str,
        base_url: &str,
        api_key: &str,
        model_name: &str,
    ) -> Result<ProviderTestConnectionResult, AppError> {
        // Reuse the same logic as test_qwen_connection
        Self::test_qwen_connection(selected_type, base_url, api_key, model_name).await
    }

    async fn probe_qwen_openai(
        client: &reqwest::Client,
        base_url: &str,
        api_key: &str,
        model_name: &str,
        timeout: std::time::Duration,
    ) -> Result<u16, AppError> {
        let base = base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{base}/v1/chat/completions");

        // Use provided model name, fall back to a common default
        let model = if model_name.is_empty() { "gpt-3.5-turbo" } else { model_name };

        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "Hi" }]
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .header("User-Agent", "Claw-Switch/1.0")
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("timeout") {
                    AppError::Message(format!("timeout: {msg}"))
                } else if msg.contains("connection") {
                    AppError::Message(format!("connection error: {msg}"))
                } else {
                    AppError::Message(format!("network request failed: {}", msg))
                }
            })?;

        Ok(response.status().as_u16())
    }

    async fn probe_qwen_anthropic(
        client: &reqwest::Client,
        base_url: &str,
        api_key: &str,
        model_name: &str,
        timeout: std::time::Duration,
    ) -> Result<u16, AppError> {
        let base = base_url.trim_end_matches('/').trim_end_matches("/v1");
        let url = format!("{base}/v1/messages");

        // Use provided model name, fall back to a common default
        let model = if model_name.is_empty() { "claude-3-haiku-20240307" } else { model_name };

        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{ "role": "user", "content": "Hi" }]
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key)
            .header("Content-Type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .header("User-Agent", "Claw-Switch/1.0")
            .timeout(timeout)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("timeout") {
                    AppError::Message(format!("timeout: {msg}"))
                } else if msg.contains("connection") {
                    AppError::Message(format!("connection error: {msg}"))
                } else {
                    AppError::Message(format!("network request failed: {}", msg))
                }
            })?;

        Ok(response.status().as_u16())
    }

    /// 检测 Cline 配置一致性
    ///
    /// 比较表单字段与本地文件配置是否一致
    pub fn check_cline_config_consistency(
        _state: &AppState,
        _provider_id: &str,
        form_config: &serde_json::Value,
    ) -> Result<bool, AppError> {
        use crate::cline_config::{get_cline_global_state_path, read_cline_provider_config};

        // 读取本地文件配置
        let path = get_cline_global_state_path()?;
        if !path.exists() {
            // 文件不存在，认为不一致（表单有配置但文件不存在）
            return Ok(false);
        }

        let file_config = read_cline_provider_config()?;
        let file_json: Value = file_config.into();

        // 仅比较管理的 8 个字段
        Ok(Self::json_partial_equal(form_config, &file_json))
    }

    /// 刷新 Cline 配置：从本地文件读取并更新数据库
    pub fn refresh_cline_live_config(
        state: &AppState,
        provider_id: &str,
    ) -> Result<Provider, AppError> {
        use crate::cline_config::{get_cline_global_state_path, read_cline_provider_config};

        let path = get_cline_global_state_path()?;
        if !path.exists() {
            return Err(AppError::localized(
                "cline.config.missing",
                "Cline 配置文件不存在",
                "Cline configuration file not found",
            ));
        }

        let file_config = read_cline_provider_config()?;
        let file_json: Value = file_config.into();

        // 获取数据库中的 provider
        let mut provider = state
            .db
            .get_provider_by_id(provider_id, AppType::Cline.as_str())?
            .ok_or_else(|| AppError::Message(format!("Provider {provider_id} not found")))?;

        // 更新配置
        provider.settings_config = file_json;

        // 保存到数据库
        state.db.save_provider(AppType::Cline.as_str(), &provider)?;

        Ok(provider)
    }

    /// JSON 深度比较（忽略顺序）
    #[allow(dead_code)]
    fn json_deep_equal(a: &serde_json::Value, b: &serde_json::Value) -> bool {
        use serde_json::Value;

        match (a, b) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(x), Value::Bool(y)) => x == y,
            (Value::Number(x), Value::Number(y)) => {
                // 比较数字（处理整数和浮点数）
                if let (Some(x_f64), Some(y_f64)) = (x.as_f64(), y.as_f64()) {
                    (x_f64 - y_f64).abs() < f64::EPSILON
                } else {
                    x == y
                }
            }
            (Value::String(x), Value::String(y)) => x == y,
            (Value::Array(x), Value::Array(y)) => {
                if x.len() != y.len() {
                    return false;
                }
                x.iter().zip(y.iter()).all(|(a, b)| Self::json_deep_equal(a, b))
            }
            (Value::Object(x), Value::Object(y)) => {
                if x.len() != y.len() {
                    return false;
                }
                for (key, val_a) in x {
                    match y.get(key) {
                        Some(val_b) => {
                            if !Self::json_deep_equal(val_a, val_b) {
                                return false;
                            }
                        }
                        None => return false,
                    }
                }
                true
            }
            _ => false,
        }
    }

    /// JSON 部分比较：仅比较 form_config 中存在的字段
    /// form_config 是表单配置（待比较的字段集合）
    /// file_config 是本地文件配置（完整配置）
    fn json_partial_equal(
        form_config: &serde_json::Value,
        file_config: &serde_json::Value,
    ) -> bool {
        use serde_json::Value;

        match (form_config, file_config) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(x), Value::Bool(y)) => x == y,
            (Value::Number(x), Value::Number(y)) => {
                if let (Some(x_f64), Some(y_f64)) = (x.as_f64(), y.as_f64()) {
                    (x_f64 - y_f64).abs() < f64::EPSILON
                } else {
                    x == y
                }
            }
            (Value::String(x), Value::String(y)) => x == y,
            (Value::Array(x), Value::Array(y)) => {
                // 如果数组元素是带 "id" 字段的对象，按 id 匹配（顺序无关，文件多出的元素忽略）
                // 否则退回到长度+顺序比较
                let all_have_id = x.iter().all(|v| v.get("id").is_some());
                if all_have_id && !x.is_empty() {
                    // 对表单数组中每个元素，在文件数组里找到 id 相同的元素进行部分比较
                    for form_item in x.iter() {
                        let form_id = form_item.get("id").and_then(|v| v.as_str());
                        let matched = y.iter().find(|file_item| {
                            file_item.get("id").and_then(|v| v.as_str()) == form_id
                        });
                        match matched {
                            Some(file_item) => {
                                if !Self::json_partial_equal(form_item, file_item) {
                                    return false;
                                }
                            }
                            None => {
                                // 文件中没有该 id 的元素，视为不一致
                                return false;
                            }
                        }
                    }
                    true
                } else {
                    // 允许文件数组比表单长（如 Qwen Code 在磁盘上多加了模型），只要求表单元素与文件前 len(x) 个逐项一致
                    if x.len() > y.len() {
                        return false;
                    }
                    x.iter()
                        .zip(y.iter())
                        .all(|(a, b)| Self::json_partial_equal(a, b))
                }
            }
            (Value::Object(form_obj), Value::Object(file_obj)) => {
                // 仅检查 form_obj 中存在的键
                for (key, form_val) in form_obj {
                    match file_obj.get(key) {
                        Some(file_val) => {
                            if !Self::json_partial_equal(form_val, file_val) {
                                return false;
                            }
                        }
                        None => {
                            // 文件配置中不存在该键
                            // 检查是否是空值（空对象、空数组、空字符串、null）
                            if !Self::is_empty_value(form_val) {
                                return false;
                            }
                        }
                    }
                }
                true
            }
            (Value::Null, _) => true, // 表单字段为 null，认为匹配
            _ => false,
        }
    }

    /// 检查值是否为空（空对象、空数组、空字符串、null）
    fn is_empty_value(val: &serde_json::Value) -> bool {
        use serde_json::Value;
        match val {
            Value::Null => true,
            Value::String(s) => s.is_empty(),
            Value::Array(arr) => arr.is_empty(),
            Value::Object(obj) => obj.is_empty(),
            _ => false,
        }
    }
}

#[cfg(test)]
mod partial_equal_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_partial_equal_matches_subset_of_fields() {
        // 表单仅填写部分字段
        let form_config = json!({
            "modelProviders": {
                "openai": [
                    {
                        "id": "qwen3-coder-plus",
                        "baseUrl": "https://coding.dashscope.aliyuncs.com/v1"
                    }
                ]
            },
            "model": {
                "name": "qwen3-coder-plus"
            }
        });

        // 文件配置包含更多字段
        let file_config = json!({
            "modelProviders": {
                "openai": [
                    {
                        "id": "qwen3-coder-plus",
                        "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
                        "envKey": "API_KEY",
                        "generationConfig": {}
                    }
                ],
                "anthropic": []
            },
            "model": {
                "name": "qwen3-coder-plus"
            },
            "env": {
                "API_KEY": "secret"
            },
            "extraField": "value"
        });

        // 应该匹配，因为表单中的字段在文件中都存在且值相同
        assert!(ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }

    #[test]
    fn test_partial_equal_detects_mismatch() {
        let form_config = json!({
            "model": {
                "name": "qwen3-coder-plus"
            }
        });

        let file_config = json!({
            "model": {
                "name": "different-model"
            }
        });

        // 不应该匹配，因为 model.name 不同
        assert!(!ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }

    #[test]
    fn test_partial_equal_handles_missing_field_with_empty_value() {
        // 表单中有一个空字段
        let form_config = json!({
            "model": {
                "name": "qwen3-coder-plus"
            },
            "emptyField": ""
        });

        // 文件中没有该字段
        let file_config = json!({
            "model": {
                "name": "qwen3-coder-plus"
            }
        });

        // 应该匹配，因为 emptyField 是空字符串
        assert!(ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }

    #[test]
    fn test_partial_equal_array_order_independent() {
        // 表单中的模型数组顺序与文件不同，应该仍然匹配
        let form_config = json!({
            "modelProviders": {
                "openai": [
                    {"id": "model-a", "baseUrl": "https://api.example.com/v1"},
                    {"id": "model-b", "baseUrl": "https://api.example.com/v1"}
                ]
            }
        });

        // 文件中顺序不同，且多出一个 model-c
        let file_config = json!({
            "modelProviders": {
                "openai": [
                    {"id": "model-b", "baseUrl": "https://api.example.com/v1", "envKey": "KEY"},
                    {"id": "model-c", "baseUrl": "https://api.example.com/v1"},
                    {"id": "model-a", "baseUrl": "https://api.example.com/v1", "name": "Model A"}
                ]
            }
        });

        // 应该匹配：顺序无关，文件多出的 model-c 不影响结果
        assert!(ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }

    #[test]
    fn test_partial_equal_array_detects_missing_id() {
        // 表单中有某个 id，但文件中不存在该 id
        let form_config = json!({
            "modelProviders": {
                "openai": [
                    {"id": "model-a", "baseUrl": "https://api.example.com/v1"},
                    {"id": "model-x", "baseUrl": "https://api.example.com/v1"}
                ]
            }
        });

        let file_config = json!({
            "modelProviders": {
                "openai": [
                    {"id": "model-a", "baseUrl": "https://api.example.com/v1"}
                ]
            }
        });

        // 不应该匹配：文件中缺少 model-x
        assert!(!ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }

    #[test]
    fn test_partial_equal_handles_missing_field_with_non_empty_value() {
        let form_config = json!({
            "model": {
                "name": "qwen3-coder-plus"
            },
            "requiredField": "value"
        });

        let file_config = json!({
            "model": {
                "name": "qwen3-coder-plus"
            }
        });

        // 不应该匹配，因为 requiredField 不为空且文件中不存在
        assert!(!ProviderService::json_partial_equal(
            &form_config,
            &file_config
        ));
    }
}
