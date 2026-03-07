---
name: cline-provider-integration
overview: 新增 `cline` 作为独立 Provider/App 类型，并按你给的映射读写 `~/.cline/data/globalState.json`。UI 仅编辑指定字段，写回时只更新这些字段，其它 JSON 字段保持原样不变。
todos:
  - id: register-cline-app
    content: 注册 cline 为新 AppId/AppType，并接入 AppSwitcher/可见性/默认 app 逻辑
    status: pending
  - id: add-cline-live-config
    content: 新增 cline_config 及 live.rs 分支，按读取-补丁-保存策略仅更新 10 个字段
    status: pending
  - id: build-cline-form
    content: 新增 ClineFormFields 并在 ProviderForm 接入结构化表单与 settingsConfig 序列化
    status: pending
  - id: add-i18n-strings
    content: 补齐 zh/en/ja 的 apps.cline 与 cline 表单文案
    status: pending
  - id: verify-behavior
    content: 执行翻译检查与功能验证，确认仅目标字段被写回且其余字段不变
    status: pending
isProject: false
---

# Cline Provider 接入计划

## 目标与边界

- 在现有多应用架构中新增 `cline`，与 `qwen` 类似使用结构化表单，不直接暴露整份 JSON 编辑。
- 仅允许 UI 修改以下字段并写回：`openAiBaseUrl`、`planModeOpenAiModelId`、`actModeOpenAiModelId`、`openAiApiKey`、`anthropicBaseUrl`、`planModeApiModelId`、`actModeApiModelId`、`apiKey`、`planModeApiProvider`、`actModeApiProvider`。
- 写回策略采用“读取-补丁-保存”：先读取 `~/.cline/data/globalState.json`，仅覆盖上述字段，其他字段原样保留。

## 代码改动范围

- 前端应用注册与切换
  - `[/Users/mamba/workspace/bailian/claw-switch/src/lib/api/types.ts](/Users/mamba/workspace/bailian/claw-switch/src/lib/api/types.ts)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/types.ts](/Users/mamba/workspace/bailian/claw-switch/src/types.ts)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/config/appConfig.tsx](/Users/mamba/workspace/bailian/claw-switch/src/config/appConfig.tsx)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/components/AppSwitcher.tsx](/Users/mamba/workspace/bailian/claw-switch/src/components/AppSwitcher.tsx)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/App.tsx](/Users/mamba/workspace/bailian/claw-switch/src/App.tsx)`
- 前端 Provider 表单与提交
  - `[/Users/mamba/workspace/bailian/claw-switch/src/components/providers/forms/ProviderForm.tsx](/Users/mamba/workspace/bailian/claw-switch/src/components/providers/forms/ProviderForm.tsx)`
  - 新增 `[/Users/mamba/workspace/bailian/claw-switch/src/components/providers/forms/ClineFormFields.tsx](/Users/mamba/workspace/bailian/claw-switch/src/components/providers/forms/ClineFormFields.tsx)`
- i18n 文案
  - `[/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/zh.json](/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/zh.json)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/en.json](/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/en.json)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/ja.json](/Users/mamba/workspace/bailian/claw-switch/src/i18n/locales/ja.json)`
- Tauri 后端 app 类型与 live 配置读写
  - `[/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/app_config.rs](/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/app_config.rs)`
  - 新增 `[/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/cline_config.rs](/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/cline_config.rs)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/services/provider/live.rs](/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/services/provider/live.rs)`
  - `[/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/lib.rs](/Users/mamba/workspace/bailian/claw-switch/src-tauri/src/lib.rs)`

## 数据结构与映射设计

- `settingsConfig`（DB 内）采用扁平结构保存 10 个字段：
  - `planModeApiProvider`、`actModeApiProvider`
  - `openAiBaseUrl`、`planModeOpenAiModelId`、`actModeOpenAiModelId`、`openAiApiKey`
  - `anthropicBaseUrl`、`planModeApiModelId`、`actModeApiModelId`、`apiKey`
- live 写入（`cline` 切换时）
  - 读取 `~/.cline/data/globalState.json`（不存在则以 `{}` 起始）
  - 仅覆写上述 10 个字段
  - 原文件其余字段不变
- live 读取（导入默认/读取当前）
  - 从 `globalState.json` 抽取上述 10 个字段组成 provider 配置
  - 缺失字段按空字符串或默认 provider 值处理（provider 默认：`anthropic`）

## UI 方案（最终交互稿，主界面一致）

```text
新增入口：主界面 Providers 页右上角 [+] -> 全屏面板标题「添加新供应商」
编辑入口：Provider 卡片 [编辑]         -> 全屏面板标题「编辑供应商」

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ 添加新供应商 / 编辑供应商                                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 基础信息                                                                                     │
│  - 供应商名称(name)                                                                          │
│  - 官网(websiteUrl)                                                                          │
│  - 备注(notes)                                                                               │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ Cline 配置（仅编辑映射字段）                                                                  │
│ 认证协议 *: [anthropic | openai]                                                              │
│   -> 决定“当前编辑字段区”显示哪套协议字段（交互参考 qwen）                                   │
│                                                                                                │
│ Plan Mode Provider *: [anthropic | openai] -> planModeApiProvider                            │
│ Act Mode Provider * : [anthropic | openai] -> actModeApiProvider                             │
│                                                                                                │
│ 当前认证协议字段区（API Key 靠前，参考 Claude 顺序）                                          │
│                                                                                                │
│ if 认证协议 == anthropic:                                                                     │
│   API Key      -> apiKey                                                                       │
│   Base URL     -> anthropicBaseUrl                                                             │
│   Plan Model   -> planModeApiModelId                                                           │
│   Act Model    -> actModeApiModelId                                                            │
│                                                                                                │
│ if 认证协议 == openai:                                                                        │
│   API Key      -> openAiApiKey                                                                 │
│   Base URL     -> openAiBaseUrl                                                                │
│   Plan Model   -> planModeOpenAiModelId                                                        │
│   Act Model    -> actModeOpenAiModelId                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ 底部按钮：新增场景 [取消][添加]；编辑场景 [保存]                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

交互规则：
1) 切换“认证协议”只影响当前可见编辑字段，不清空另一协议已有值；
2) Plan/Act Provider 仅更新 provider 选择字段，不强制联动认证协议；
3) 保存时仅读取并 patch 指定 10 个字段，globalState.json 其余字段保持不变。
```

## 实施步骤

1. 扩展 `AppId`/`AppType` 与可见应用配置，把 `cline` 接入应用切换与主页面状态管理。
2. 新增 `cline_config` 路径工具（固定 `~/.cline/data/globalState.json`），并在 live 读写层加入 `AppType::Cline` 分支。
3. 在 `ProviderForm` 增加 `cline` 分支，接入 `ClineFormFields`，将结构化输入序列化到 `settingsConfig`（仅 10 字段）。
4. 复用现有 provider 增删改查命令链路，不新增独立命令；保持 `providersApi` 行为一致。
5. 增补中英日 i18n 文案：`apps.cline`、`provider.addClineProvider`、`provider.editClineProvider`、`cline.*` 表单文案。
6. 运行翻译检查与基础类型/构建校验，确认 `cline` 可添加、可切换、可写入且不会改动非目标字段。

## 验证清单

- 新建 `cline` provider 后切换：`~/.cline/data/globalState.json` 仅目标字段变化。
- 在文件中手工增加无关字段，再次切换 provider：无关字段仍保留。
- Plan/Act 分别切换 provider 时，模型 ID 对应写入正确键名。
- UI 中未出现“可编辑任意 JSON”入口，仅结构化字段可改。
- `src/i18n/scripts/check-translations.cjs` 检查通过。

## 实现约束（必须满足）

- `AppType::Cline` 的 `read_live_settings()` 只返回 10 个映射字段子集，不能返回整份 `globalState.json`。
- `write_live_snapshot(AppType::Cline, provider)` 必须采用“读取原文件 -> patch 10 字段 -> 写回”策略，禁止整文件覆盖。
- Cline 的切换回填（backfill）只能回填上述 10 字段，不能把 live 里的其它字段写回数据库 provider 配置。
- 表单校验按 `planModeApiProvider` / `actModeApiProvider` 判定必填，不仅按“当前认证协议可见区”判定，避免隐藏字段漏填。

