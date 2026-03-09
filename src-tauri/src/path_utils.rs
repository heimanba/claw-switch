//! 公共路径工具
//!
//! 统一构建扩展的 PATH 环境变量，供 CLI 安装和版本检测使用。
//! `misc.rs`、`installer.rs`、`openclaw.rs` 等需要查找 node/npm 可执行文件的模块
//! 应使用此模块的 `get_extended_path()`，避免多处独立维护产生不同步。

/// 构建扩展的 PATH 环境变量。
///
/// GUI 应用启动时不继承用户 shell 的 PATH，需手动注入
/// Homebrew / nvm / volta / fnm / asdf / mise 等常见路径。
///
/// 优先级设计：
///   1. nvm 中版本号 >= 22 的路径（按版本降序）
///   2. Homebrew node@XX keg-only 公式（/opt/homebrew/opt/node@XX，按版本降序）
///   3. /opt/homebrew/bin（Homebrew 默认 node，版本通常较新）
///   4. fnm/volta/asdf/mise 等版本管理器的默认路径 + Windows 注册表 PATH
///   5. nvm 中版本号 < 22 的路径（兜底，避免挡住更新的 Homebrew node）
///   6. 当前进程 PATH（系统路径，可能含旧版 node）
///   7. /usr/bin:/bin 绝对兜底（非 Windows）
pub fn get_extended_path() -> String {
    let mut preferred: Vec<String> = Vec::new(); // nvm/Homebrew >= v22
    let mut mid: Vec<String> = Vec::new();       // fnm/volta/asdf/mise/npm-global
    let mut nvm_old: Vec<String> = Vec::new();   // nvm < v22，放在系统 PATH 之后

    let home = dirs::home_dir().unwrap_or_default();
    let home_str = home.display().to_string();
    let current = std::env::var("PATH").unwrap_or_default();

    if !home_str.is_empty() {
        // ① nvm：扫描所有已安装版本，>= 22 放 preferred，其余放 nvm_old
        #[cfg(not(target_os = "windows"))]
        {
            let nvm_base = format!("{home_str}/.nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                let mut nvm_bins: Vec<(u32, u32, u32, String)> = entries
                    .flatten()
                    .filter_map(|e| {
                        let bin = e.path().join("bin");
                        if !bin.exists() {
                            return None;
                        }
                        let name = e.file_name().into_string().ok()?;
                        let ver = name.trim_start_matches('v');
                        let mut nums = ver.split('.').filter_map(|s| s.parse::<u32>().ok());
                        let major = nums.next().unwrap_or(0);
                        let minor = nums.next().unwrap_or(0);
                        let patch = nums.next().unwrap_or(0);
                        Some((major, minor, patch, bin.display().to_string()))
                    })
                    .collect();
                nvm_bins.sort_unstable_by(|a, b| {
                    b.0.cmp(&a.0)
                        .then_with(|| b.1.cmp(&a.1))
                        .then_with(|| b.2.cmp(&a.2))
                });
                for (major, _, _, path) in nvm_bins {
                    if major >= 22 {
                        preferred.push(path);
                    } else {
                        nvm_old.push(path);
                    }
                }
            }

            // 其他版本管理器
            mid.push(format!("{home_str}/.fnm/aliases/default/bin"));
            mid.push(format!("{home_str}/.volta/bin"));
            mid.push(format!("{home_str}/.asdf/shims"));
            mid.push(format!("{home_str}/.local/share/mise/shims"));
            mid.push(format!("{home_str}/.npm-global/bin"));
            mid.push(format!("{home_str}/.local/bin"));
        }

        // Windows：nvm-windows 安装目录（默认 %APPDATA%\nvm）
        #[cfg(target_os = "windows")]
        {
            // 从注册表读取用户和系统 PATH，确保能识别到安装后写入注册表的 Node.js 路径。
            // GUI 应用启动时进程 PATH 是启动时的快照，不会自动反映安装后注册表的变更。
            {
                use winreg::enums::*;
                use winreg::RegKey;

                // 读取用户级 PATH（HKCU\Environment）
                if let Ok(hkcu_env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
                    if let Ok(user_path) = hkcu_env.get_value::<String, _>("Path") {
                        for p in user_path.split(';') {
                            let p = p.trim();
                            if !p.is_empty() {
                                mid.push(p.to_string());
                            }
                        }
                    }
                }

                // 读取系统级 PATH（HKLM\SYSTEM\...\Environment）
                if let Ok(hklm_env) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(
                    "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
                ) {
                    if let Ok(sys_path) = hklm_env.get_value::<String, _>("Path") {
                        for p in sys_path.split(';') {
                            let p = p.trim();
                            if !p.is_empty() {
                                mid.push(p.to_string());
                            }
                        }
                    }
                }
            }

            if let Some(appdata) = dirs::data_dir() {
                // npm 全局 bin
                mid.push(appdata.join("npm").display().to_string());
                // nvm-windows：当前激活版本在 %APPDATA%\nvm\vX.Y.Z 目录
                let nvm_root = appdata.join("nvm");
                if nvm_root.exists() {
                    if let Ok(entries) = std::fs::read_dir(&nvm_root) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            if p.is_dir() {
                                mid.push(p.display().to_string());
                            }
                        }
                    }
                }
            }
            // volta（Windows 用 %LOCALAPPDATA%\Programs\Volta\bin 或 ~/.volta/bin）
            if let Some(local_appdata) = dirs::data_local_dir() {
                mid.push(
                    local_appdata
                        .join("Programs")
                        .join("Volta")
                        .join("bin")
                        .display()
                        .to_string(),
                );
                // fnm（%LOCALAPPDATA%\fnm\aliases\default）
                let fnm_root = local_appdata.join("fnm");
                if fnm_root.exists() {
                    let alias_bin = fnm_root.join("aliases").join("default");
                    if alias_bin.exists() {
                        mid.push(alias_bin.display().to_string());
                    }
                }
            }
            mid.push(format!("{home_str}\\.volta\\bin"));
            // C:\Program Files\nodejs（官网安装包默认路径）
            mid.push("C:\\Program Files\\nodejs".to_string());
        }
    }

    // ② Homebrew node@XX keg-only 公式（如 /opt/homebrew/opt/node@22/bin）
    #[cfg(target_os = "macos")]
    {
        let homebrew_opt = "/opt/homebrew/opt";
        if let Ok(entries) = std::fs::read_dir(homebrew_opt) {
            let mut hb_nodes: Vec<(u32, String)> = entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().into_string().ok()?;
                    let ver_str = name.strip_prefix("node@")?;
                    let major: u32 = ver_str.parse().ok()?;
                    let bin = e.path().join("bin");
                    if bin.join("node").exists() {
                        Some((major, bin.display().to_string()))
                    } else {
                        None
                    }
                })
                .collect();
            hb_nodes.sort_unstable_by(|a, b| b.0.cmp(&a.0));
            for (major, path) in hb_nodes {
                if major >= 22 {
                    preferred.push(path);
                } else {
                    mid.push(path);
                }
            }
        }

        // ③ Homebrew 默认 node
        preferred.push("/opt/homebrew/bin".to_string()); // Apple Silicon
        preferred.push("/usr/local/bin".to_string());    // Intel Mac
    }

    // 组合最终 PATH
    let mut parts: Vec<String> = Vec::new();
    parts.extend(preferred);
    parts.extend(mid);
    if !current.is_empty() {
        parts.push(current);
    }
    parts.extend(nvm_old);

    #[cfg(not(target_os = "windows"))]
    {
        parts.push("/usr/bin".to_string());
        parts.push("/bin".to_string());
    }

    parts.join(if cfg!(target_os = "windows") { ";" } else { ":" })
}
