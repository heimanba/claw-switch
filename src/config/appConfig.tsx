import React from "react";
import type { AppId } from "@/lib/api/types";
import type { VisibleApps } from "@/types";
import {
  ClaudeIcon,
  CodexIcon,
  GeminiIcon,
  OpenClawIcon,
} from "@/components/BrandIcons";
import { ProviderIcon } from "@/components/ProviderIcon";

export interface AppConfig {
  label: string;
  icon: React.ReactNode;
  activeClass: string;
  badgeClass: string;
}

/**
 * 应用可见性配置（用于设置页面）
 * 与 APP_IDS 保持同步，添加新 provider 时需要同时更新
 */
export const APP_VISIBILITY_CONFIG: Array<{
  id: AppId;
  icon: string;
  nameKey: string;
}> = [
  { id: "openclaw", icon: "openclaw", nameKey: "apps.openclaw" },
  { id: "claude", icon: "claude", nameKey: "apps.claude" },
  { id: "qwen", icon: "qwen", nameKey: "apps.qwen" },
  { id: "opencode", icon: "opencode", nameKey: "apps.opencode" },
  { id: "cline", icon: "cline", nameKey: "apps.cline" },
  { id: "codex", icon: "openai", nameKey: "apps.codex" },
  { id: "gemini", icon: "gemini", nameKey: "apps.gemini" },
];

/**
 * 获取默认的可见性配置（所有应用默认显示）
 * 添加新 provider 时需要在此添加默认值
 */
export const getDefaultVisibleApps = (): VisibleApps => ({
  openclaw: true,
  claude: true,
  qwen: true,
  opencode: true,
  cline: true,
  codex: false,
  gemini: false,
});

export const APP_IDS: AppId[] = [
  "openclaw",
  "claude",
  "qwen",
  "opencode",
  "cline",
  "codex",
  "gemini",
];

/** App IDs shown in MCP & Skills panels (excludes OpenClaw and Cline) */
export const MCP_SKILLS_APP_IDS: AppId[] = [
  "qwen",
  "claude",
  "opencode",
  "codex",
  "gemini",
];

export const APP_ICON_MAP: Record<AppId, AppConfig> = {
  claude: {
    label: "Claude",
    icon: <ClaudeIcon size={14} />,
    activeClass:
      "bg-orange-500/10 ring-1 ring-orange-500/20 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400",
    badgeClass:
      "bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20 border-0 gap-1.5",
  },
  codex: {
    label: "Codex",
    icon: <CodexIcon size={14} />,
    activeClass:
      "bg-green-500/10 ring-1 ring-green-500/20 hover:bg-green-500/20 text-green-600 dark:text-green-400",
    badgeClass:
      "bg-green-500/10 text-green-700 dark:text-green-300 hover:bg-green-500/20 border-0 gap-1.5",
  },
  gemini: {
    label: "Gemini",
    icon: <GeminiIcon size={14} />,
    activeClass:
      "bg-blue-500/10 ring-1 ring-blue-500/20 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400",
    badgeClass:
      "bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 border-0 gap-1.5",
  },
  opencode: {
    label: "OpenCode",
    icon: (
      <ProviderIcon
        icon="opencode"
        name="OpenCode"
        size={14}
        showFallback={false}
      />
    ),
    activeClass:
      "bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400",
    badgeClass:
      "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 border-0 gap-1.5",
  },
  openclaw: {
    label: "OpenClaw",
    icon: <OpenClawIcon size={14} />,
    activeClass:
      "bg-rose-500/10 ring-1 ring-rose-500/20 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400",
    badgeClass:
      "bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 border-0 gap-1.5",
  },
  qwen: {
    label: "Qwen Code",
    icon: (
      <ProviderIcon
        icon="qwen"
        name="Qwen Code"
        size={14}
        showFallback={false}
      />
    ),
    activeClass:
      "bg-orange-600/10 ring-1 ring-orange-600/20 hover:bg-orange-600/20 text-orange-700 dark:text-orange-400",
    badgeClass:
      "bg-orange-600/10 text-orange-800 dark:text-orange-300 hover:bg-orange-600/20 border-0 gap-1.5",
  },
  cline: {
    label: "Cline",
    icon: (
      <ProviderIcon icon="cline" name="Cline" size={14} showFallback={false} />
    ),
    activeClass:
      "bg-purple-500/10 ring-1 ring-purple-500/20 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400",
    badgeClass:
      "bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 border-0 gap-1.5",
  },
};
