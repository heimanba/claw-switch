/// Gateway 认证命令
/// 提供 Ed25519 签名的 connect frame 生成，以及设备配对注册
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;

const DEVICE_KEY_FILE: &str = "claw-switch-device-key.json";
const SCOPES: &[&str] = &[
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
    "operator.read",
    "operator.write",
];

fn openclaw_dir() -> std::path::PathBuf {
    crate::openclaw_config::get_openclaw_dir()
}

/// base64url 编码（无 padding）
fn base64_url_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

mod hex_util {
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        data.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
    pub fn decode(s: &str) -> Result<Vec<u8>, String> {
        if s.len() % 2 != 0 {
            return Err("奇数长度".into());
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
            .collect()
    }
}

/// 获取或生成设备密钥（存储于 ~/.openclaw/claw-switch-device-key.json）
pub(crate) fn get_or_create_key() -> Result<(String, String, SigningKey), String> {
    let dir = openclaw_dir();
    let path = dir.join(DEVICE_KEY_FILE);

    if path.exists() {
        let content =
            fs::read_to_string(&path).map_err(|e| format!("读取设备密钥失败: {e}"))?;
        let json: Value =
            serde_json::from_str(&content).map_err(|e| format!("解析设备密钥失败: {e}"))?;

        let device_id = json["deviceId"].as_str().unwrap_or("").to_string();
        let pub_b64 = json["publicKey"].as_str().unwrap_or("").to_string();
        let secret_hex = json["secretKey"].as_str().unwrap_or("");

        let secret_bytes =
            hex_util::decode(secret_hex).map_err(|e| format!("解码密钥失败: {e}"))?;
        if secret_bytes.len() != 32 {
            return Err("密钥长度错误".into());
        }
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(&secret_bytes);
        let signing_key = SigningKey::from_bytes(&key_bytes);

        return Ok((device_id, pub_b64, signing_key));
    }

    // 生成新密钥
    let mut rng = rand::thread_rng();
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key: VerifyingKey = (&signing_key).into();
    let pub_bytes = verifying_key.to_bytes();

    let device_id = {
        let mut hasher = Sha256::new();
        hasher.update(pub_bytes);
        hex_util::encode(hasher.finalize())
    };
    let pub_b64 = base64_url_encode(&pub_bytes);
    let secret_hex = hex_util::encode(signing_key.to_bytes());

    let json = serde_json::json!({
        "deviceId": device_id,
        "publicKey": pub_b64,
        "secretKey": secret_hex,
    });

    let _ = fs::create_dir_all(&dir);
    fs::write(&path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("保存设备密钥失败: {e}"))?;

    Ok((device_id, pub_b64, signing_key))
}

/// 生成 Gateway connect 帧（含 Ed25519 签名）
/// 与 clawpanel 的 create_connect_frame 保持相同协议格式
#[tauri::command]
pub fn create_connect_frame(nonce: String, gateway_token: String) -> Result<Value, String> {
    let (device_id, pub_b64, signing_key) = get_or_create_key()?;
    let signed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    let platform = std::env::consts::OS; // "windows" | "macos" | "linux"
    let device_family = "desktop";

    let scopes_str = SCOPES.join(",");
    // v3 格式：v3|deviceId|clientId|clientMode|role|scopes|signedAt|token|nonce|platform|deviceFamily
    let payload_str = format!(
        "v3|{device_id}|openclaw-control-ui|ui|operator|{scopes_str}|{signed_at}|{gateway_token}|{nonce}|{platform}|{device_family}"
    );

    let signature = signing_key.sign(payload_str.as_bytes());
    let sig_b64 = base64_url_encode(&signature.to_bytes());

    let frame = serde_json::json!({
        "type": "req",
        "id": format!("connect-{:08x}-{:04x}", signed_at as u32, rand::random::<u16>()),
        "method": "connect",
        "params": {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": "openclaw-control-ui",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": platform,
                "deviceFamily": device_family,
                "mode": "ui"
            },
            "role": "operator",
            "scopes": SCOPES,
            "caps": [],
            "auth": { "token": gateway_token },
            "device": {
                "id": device_id,
                "publicKey": pub_b64,
                "signedAt": signed_at as u64,
                "nonce": nonce,
                "signature": sig_b64,
            },
            "locale": "zh-CN",
            "userAgent": format!("ClawSwitch/{}", env!("CARGO_PKG_VERSION")),
        }
    });

    Ok(frame)
}

/// 自动配对设备：将设备注册到 paired.json，并写入 allowedOrigins
/// 用于首次连接时触发静默本地配对
#[tauri::command]
pub fn auto_pair_device() -> Result<String, String> {
    // 首先确保 allowedOrigins 包含 cc-switch 的 origin
    patch_gateway_origins();

    let (device_id, public_key, _) = get_or_create_key()?;

    let paired_path = openclaw_dir().join("devices").join("paired.json");
    let devices_dir = openclaw_dir().join("devices");

    if !devices_dir.exists() {
        fs::create_dir_all(&devices_dir)
            .map_err(|e| format!("创建 devices 目录失败: {e}"))?;
    }

    let mut paired: Value = if paired_path.exists() {
        let content = fs::read_to_string(&paired_path)
            .map_err(|e| format!("读取 paired.json 失败: {e}"))?;
        serde_json::from_str(&content).map_err(|e| format!("解析 paired.json 失败: {e}"))?
    } else {
        serde_json::json!({})
    };

    let os_platform = std::env::consts::OS;

    // 如果已配对，检查 platform 字段是否正确
    if let Some(existing) = paired.get_mut(&device_id) {
        let current_platform = existing
            .get("platform")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if current_platform != os_platform {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert(
                    "platform".to_string(),
                    Value::String(os_platform.to_string()),
                );
                obj.insert(
                    "deviceFamily".to_string(),
                    Value::String("desktop".to_string()),
                );
            }
            let new_content = serde_json::to_string_pretty(&paired)
                .map_err(|e| format!("序列化 paired.json 失败: {e}"))?;
            fs::write(&paired_path, new_content)
                .map_err(|e| format!("更新 paired.json 失败: {e}"))?;
            return Ok("设备已配对（已修正平台字段）".into());
        }
        return Ok("设备已配对".into());
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    paired[&device_id] = serde_json::json!({
        "deviceId": device_id,
        "publicKey": public_key,
        "platform": os_platform,
        "deviceFamily": "desktop",
        "clientId": "openclaw-control-ui",
        "clientMode": "ui",
        "role": "operator",
        "roles": ["operator"],
        "scopes": [
            "operator.admin",
            "operator.approvals",
            "operator.pairing",
            "operator.read",
            "operator.write"
        ],
        "approvedScopes": [
            "operator.admin",
            "operator.approvals",
            "operator.pairing",
            "operator.read",
            "operator.write"
        ],
        "tokens": {},
        "createdAtMs": now_ms,
        "approvedAtMs": now_ms
    });

    let new_content = serde_json::to_string_pretty(&paired)
        .map_err(|e| format!("序列化 paired.json 失败: {e}"))?;
    fs::write(&paired_path, new_content)
        .map_err(|e| format!("写入 paired.json 失败: {e}"))?;

    Ok("设备配对成功".into())
}

/// 将 cc-switch 的 origin 写入 gateway.controlUi.allowedOrigins
fn patch_gateway_origins() {
    let config_path = openclaw_dir().join("openclaw.json");
    if !config_path.exists() {
        return;
    }
    let Ok(content) = fs::read_to_string(&config_path) else {
        return;
    };
    let Ok(mut config) = serde_json::from_str::<Value>(&content) else {
        return;
    };

    let origins = serde_json::json!([
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420"
    ]);

    if let Some(obj) = config.as_object_mut() {
        let gateway = obj
            .entry("gateway")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(gw) = gateway.as_object_mut() {
            let control_ui = gw
                .entry("controlUi")
                .or_insert_with(|| serde_json::json!({}));
            if let Some(cui) = control_ui.as_object_mut() {
                cui.insert("allowedOrigins".to_string(), origins);
            }
        }
    }

    if let Ok(new_json) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(&config_path, new_json);
    }
}
