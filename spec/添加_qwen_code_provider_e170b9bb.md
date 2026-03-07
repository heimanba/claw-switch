---
name: 添加 Qwen Code Provider
overview: 在 Claw switch 中添加 Qwen Code 作为新的 Provider 应用，配置文件为 `~/.qwen/settings.json`，采用与 Claude 相同的 switch 模式（单文件覆盖）。UI 表单中 `modelProviders` 字段使用 JSON 编辑器，其余字段以 ASCII 框线图方式标注对应 JSON 字段名。
todos:
  - id: rust-apptype
    content: 后端：在 app_config.rs 中添加 Qwen 变体到 AppType 及所有相关枚举/结构体
    status: in_progress
  - id: rust-settings
    content: 后端：在 settings.rs 中添加 qwen 相关字段（VisibleApps.qwen, qwen_config_dir, current_provider_qwen）
    status: pending
  - id: rust-config
    content: 后端：在 config.rs 中添加 get_qwen_config_dir() 和 get_qwen_settings_path()
    status: pending
  - id: rust-live
    content: 后端：在 services/provider/live.rs 中添加 AppType::Qwen 的 write/read 分支
    status: pending
  - id: fe-types
    content: 前端：在 types.ts 和 lib/api/types.ts 中添加 qwen 相关类型
    status: pending
  - id: fe-switcher
    content: 前端：在 AppSwitcher.tsx 中添加 qwen 应用标签页
    status: pending
  - id: fe-presets
    content: 前端：新建 qwenProviderPresets.ts，定义阿里官方预设
    status: pending
  - id: fe-formfields
    content: 前端：新建 QwenFormFields.tsx，实现 ASCII 框线图 + JSON 编辑器布局
    status: pending
  - id: fe-providerform
    content: 前端：在 ProviderForm.tsx 中集成 Qwen 分支逻辑
    status: pending
isProject: false
---

# 添加 Qwen Code Provider

## 架构概览

Qwen Code 与 Claude 类似，采用 **switch 模式**（非 additive），切换时将当前 provider 的 `settingsConfig` 整体写入 `~/.qwen/settings.json`。

根据[官方文档](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)，`~/.qwen/settings.json` 的完整结构为：

```
settingsConfig（Claw switch 存储）
        │
        ▼
~/.qwen/settings.json（live 配置）
{
  "modelProviders": {              // 模型提供商声明（openai/anthropic/gemini/vertex-ai）
    "openai": [
      {
        "id": "qwen3-coder-plus",
        "name": "qwen3-coder-plus",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "envKey": "DASHSCOPE_API_KEY"
      }
    ]
  },
  "env": {                         // API Key 存储（最低优先级 fallback）
    "DASHSCOPE_API_KEY": "sk-xxx"
  },
  "security": {                    // 认证配置（重要！决定启动时使用哪种协议）
    "auth": {
      "selectedType": "openai"     // openai | anthropic | gemini | vertex-ai
    }
  },
  "model": {                       // 默认激活模型（需与 modelProviders 中的 id 匹配）
    "name": "qwen3-coder-plus"
  }
}
```

## 需要修改的文件

### 后端（Rust）

- `**[src-tauri/src/app_config.rs](src-tauri/src/app_config.rs)**`
  - `AppType` 枚举增加 `Qwen` 变体
  - `McpApps`, `SkillApps`, `CommonConfigSnippets`, `PromptRoot` 等 match 分支全部补全 `AppType::Qwen`（OpenClaw 模式，不支持 MCP/Skill）
  - `MultiAppConfig::default()` 中插入 `"qwen"` key
  - `AppType::all()` 迭代器增加 `Qwen`
- `**[src-tauri/src/settings.rs](src-tauri/src/settings.rs)**`
  - `VisibleApps` 增加 `pub qwen: bool`，`is_visible` 加 `Qwen` 分支
  - `AppSettings` 增加 `qwen_config_dir`, `current_provider_qwen` 字段
- `**[src-tauri/src/config.rs](src-tauri/src/config.rs)**`
  - 新增 `get_qwen_config_dir()` → `~/.qwen` 或 settings 覆盖
  - 新增 `get_qwen_settings_path()` → `~/.qwen/settings.json`
  - 新增 `get_qwen_override_dir()` 读取 settings
- `**[src-tauri/src/services/provider/live.rs](src-tauri/src/services/provider/live.rs)**`
  - `write_live_snapshot` 增加 `AppType::Qwen` 分支 → 直接写 JSON 到 `get_qwen_settings_path()`
  - `read_live_settings` 增加 `AppType::Qwen` 分支 → 直接读 JSON
  - `import_default_config` 的 match 补全 `AppType::Qwen`

### 前端（TypeScript / React）

- `**[src/lib/api/types.ts](src/lib/api/types.ts)**`
  - `AppId` 增加 `"qwen"`
- `**[src/types.ts](src/types.ts)**`
  - `VisibleApps` 接口增加 `qwen: boolean`
- `**[src/components/AppSwitcher.tsx](src/components/AppSwitcher.tsx)**`
  - `ALL_APPS` 增加 `"qwen"`
  - `appIconName` 增加 `qwen: "qwen"`
  - `appDisplayName` 增加 `qwen: "Qwen Code"`
- `**[src/config/qwenProviderPresets.ts](src/config/qwenProviderPresets.ts)**`（新建）
  - 定义 `QwenProviderPreset` 类型
  - 导出 `qwenProviderPresets` 数组，包含阿里官方预设
- `**[src/components/providers/forms/QwenFormFields.tsx](src/components/providers/forms/QwenFormFields.tsx)**`（新建）
  - 展示 ASCII 框线图标注 `apiKey`、`baseUrl`、`model` 字段及其在 settings.json 中的位置
  - 嵌入对应输入框
  - 底部单独用 `JsonEditor` 编辑 `modelProviders` 字段
- `**[src/components/providers/forms/ProviderForm.tsx](src/components/providers/forms/ProviderForm.tsx)**`
  - `presetEntries` 增加 `qwen` 分支（引用 `qwenProviderPresets`）
  - `defaultValues` 增加 `qwen` 分支对应 `QWEN_DEFAULT_CONFIG`
  - 在 JSX 中增加 `{appId === "qwen" && <QwenFormFields ... />}` 分支
  - 配置编辑器部分增加 `qwen` 使用 JSON Editor 的分支
- `**[src/components/providers/forms/helpers/opencodeFormUtils.ts](src/components/providers/forms/helpers/opencodeFormUtils.ts)**`（或同级 helpers 文件）
  - 增加 `QWEN_DEFAULT_CONFIG` 默认 JSON 字符串

## UI 表单 ASCII 示意（QwenFormFields 渲染效果）

表单字段分为两部分：**结构化字段**（用 ASCII 框线图标注 JSON 路径）+ `**modelProviders` JSON 编辑器**。

```
┌─ ~/.qwen/settings.json ──────────────────────────────────────────────┐
│                                                                       │
│  "security" > "auth" > "selectedType"    认证协议（必填）              │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  [ openai ▼ ]  openai / anthropic / gemini / vertex-ai     │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                       │
│  "model" > "name"    默认模型名称（需与 modelProviders id 匹配）        │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  qwen3-coder-plus                                           │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                       │
│  "env"    API Key 存储（键 = envKey 名, 值 = API Key）                │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  DASHSCOPE_API_KEY  │  sk-xxxxxxxxxxxxxxxxxx                │      │
│  │  + 添加             │                                       │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                       │
│  "modelProviders"    ← JSON 编辑器（复杂嵌套结构直接编辑）             │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  { "openai": [{ "id": "...", "envKey": "...", ... }] }      │      │
│  └─────────────────────────────────────────────────────────────┘      │
│                                                                       │
│  ▼ 兼容旧版配置（已废弃，建议迁移到 modelProviders + env）  [可折叠]   │
│  ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄  │
│  ⚠ "security" > "auth" > "apiKey"   [deprecated since v0.10.1] │      │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  sk-xxx（留空则不写入）                                       │      │
│  └─────────────────────────────────────────────────────────────┘      │
│  ⚠ "security" > "auth" > "baseUrl"  [deprecated since v0.10.1] │      │
│  ┌─────────────────────────────────────────────────────────────┐      │
│  │  https://...（留空则不写入）                                  │      │
│  └─────────────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────────────┘
```

### 兼容策略（向后兼容 deprecated 字段）

- **读取时**：从 `settingsConfig` 中提取 `security.auth.apiKey` / `security.auth.baseUrl`，若存在则回填到废弃字段输入框中，同时展开折叠区域
- **写入时**：
  - 若废弃字段输入框**非空** → 保留写入 `security.auth.apiKey` / `security.auth.baseUrl`（兼容老用户）
  - 若废弃字段输入框**留空** → 不写入这两个字段（不强制清除，避免破坏存量配置）
- **UI 提示**：废弃字段区域显示 `⚠ 已废弃` 警告 badge，并附迁移建议（推荐改用 `modelProviders` + `env`）
- **折叠行为**：默认收起；当读取到非空的废弃字段时自动展开

### 组件实现要点

- 外层大框和字段路径标注用 Unicode 框线字符在 React 中渲染（`font-mono` + CSS border）
- `security.auth.selectedType` 使用 `<Select>` 下拉，选项固定为 4 种：`openai` / `anthropic` / `gemini` / `vertex-ai`
- `env` 使用键值对动态列表（可增删行）
- `model.name` 使用普通文本输入框
- `modelProviders` 使用现有的 `JsonEditor` 组件
- 废弃字段 `security.auth.apiKey` / `security.auth.baseUrl` 折叠在 `<Collapsible>` 区域内

### 预设示例（qwenProviderPresets.ts）

- **阿里云 Bailian（通用）**: `DASHSCOPE_API_KEY` + `https://dashscope.aliyuncs.com/compatible-mode/v1`
- **阿里云 Coding Plan（中国区）**: `BAILIAN_CODING_PLAN_API_KEY` + `https://coding.dashscope.aliyuncs.com/v1`
- **阿里云 Coding Plan（国际区）**: `BAILIAN_CODING_PLAN_API_KEY` + `https://coding-intl.dashscope.aliyuncs.com/v1`
- **自定义**: 空配置模板

