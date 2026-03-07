use crate::config::get_home_dir;
use std::path::PathBuf;

/// 获取 Qwen Code 配置目录路径（支持设置覆盖）
pub fn get_qwen_config_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_qwen_override_dir() {
        return custom;
    }

    get_home_dir().join(".qwen")
}

/// 获取 Qwen Code 主配置文件路径
pub fn get_qwen_settings_path() -> PathBuf {
    get_qwen_config_dir().join("settings.json")
}