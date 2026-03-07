# OpenClaw 概览页面增强设计

## 背景

OpenClaw 是一个多渠道 AI 网关平台，支持 WhatsApp、Telegram、Discord、iMessage 等渠道。当前概览页面只展示服务状态指标和 2 个管理工具入口，无法体现 OpenClaw 的核心能力（多渠道、会话管理）。

## 目标

按优先级增强概览页面：
1. **高优**：新增渠道配置状态卡片
2. **中优**：管理工具扩展为 2×2（新增消息渠道、会话记录入口）

## 设计方案

### 整体布局（从上到下）

```
┌─────────────────────────────────────┐
│ 运行中 •          [重启] [停止]       │  ← 现有：服务状态栏
│ 端口 18789 │ 进程 ID xxxxx │ 供应商 0 │  ← 现有：指标行（不变）
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 渠道状态            2 / 8 已配置 →   │  ← 新增卡片
│ [Telegram ●] [Discord ○] [WhatsApp ●]│
│ [飞书 ○]    [Slack ○]   [iMessage ○] │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 管理工具                             │  ← 现有：扩展为 2×2
│ [系统诊断]     [供应商配置]           │
│ [消息渠道]     [会话记录]             │  ← 新增两个入口
│ 快速访问：环境配置 · 工具管理          │
└─────────────────────────────────────┘
```

### 渠道状态卡片

- **数据来源**：`get_openclaw_channels_config` Tauri 命令（已有）
- **新增 hook**：`useOpenClawChannels(enabled: boolean)` 加入 `src/hooks/useOpenClaw.ts`
- **查询 key**：`openclawKeys.channels`（加入 `openclawKeys` 对象）
- **轮询**：仅服务运行时每 3s 刷新
- **展示逻辑**：
  - `enabled=true` → 彩色图标 + 渠道名（已配置）
  - `enabled=false` → 灰色图标（未配置）
  - 标题右侧显示"X / 8 已配置"，可点击跳转 `openclawChannels`
  - 服务未运行时整体半透明，展示提示文案
- **渠道图标映射**：与 `ChannelsPanel.tsx` 中 `channelInfo` 保持一致

### 管理工具扩展

当前 2 个入口扩展为 4 个（2×2 网格）：

| 入口 | 图标 | 颜色 | 跳转 |
|------|------|------|------|
| 系统诊断 | Stethoscope | 蓝色 | `openclawTesting` |
| 供应商配置 | Users | 紫色 | `providers` |
| 消息渠道 | MessageCircle | 绿色 | `openclawChannels` |
| 会话记录 | History | 橙色 | `sessions` |

底部快速访问链接（环境配置 · 工具管理）保持不变。

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `src/hooks/useOpenClaw.ts` | 新增 `useOpenClawChannels` hook 和 `channels` query key |
| `src/lib/api/openclaw.ts` | 新增 `getChannelsConfig()` 方法 |
| `src/components/dashboard/AppDashboard.tsx` | 插入渠道状态卡片；管理工具扩展为 2×2 |

## 技术约束

- 渠道状态为"已配置"判断（`enabled` 字段），不需要运行时 HTTP 探测
- 新增 hook 遵循现有 `useOpenClawServiceStatus` 模式
- 不新增 Tauri 命令，复用 `get_openclaw_channels_config`
