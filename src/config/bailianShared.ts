/**
 * 百炼 (Bailian) 与 Claude Code / Qwen Code 共用的模型与区域配置
 * 供 claudeProviderPresets、qwenProviderPresets、ClaudeFormFields、QwenFormFields 等引用
 */

export type BailianPresetType = "coding_plan" | "general";

/** 默认主模型 ID */
export const BAILIAN_DEFAULT_MODEL = "qwen3.5-plus";

/** 默认推理 (Thinking) 模型 ID，用于 ANTHROPIC_REASONING_MODEL */
export const BAILIAN_DEFAULT_REASONING_MODEL = "qwen3-max-2026-01-23";

/** 百炼默认模型 ID 列表（与 Qwen 侧下拉保持一致） */
export const BAILIAN_DEFAULT_MODEL_IDS: readonly string[] = [
  "qwen3.5-plus",
  "qwen3-coder-plus",
  "qwen3-coder-next",
  "qwen3-max-2026-01-23",
  "glm-4.7",
  "glm-5",
  "MiniMax-M2.5",
  "kimi-k2.5",
] as const;

/** 模型元数据：是否支持 Thinking */
export const BAILIAN_BASE_MODELS: Record<
  string,
  { id: string; hasThinking: boolean }
> = {
  "qwen3.5-plus": { id: "qwen3.5-plus", hasThinking: true },
  "qwen3-coder-plus": { id: "qwen3-coder-plus", hasThinking: false },
  "qwen3-coder-next": { id: "qwen3-coder-next", hasThinking: false },
  "qwen3-max-2026-01-23": { id: "qwen3-max-2026-01-23", hasThinking: true },
  "glm-4.7": { id: "glm-4.7", hasThinking: true },
  "glm-5": { id: "glm-5", hasThinking: true },
  "MiniMax-M2.5": { id: "MiniMax-M2.5", hasThinking: true },
  "kimi-k2.5": { id: "kimi-k2.5", hasThinking: true },
  "claude-3-5-sonnet-20241022": {
    id: "claude-3-5-sonnet-20241022",
    hasThinking: false,
  },
};

/** 指定模型是否支持 Thinking */
export function bailianModelSupportsThinking(modelId: string): boolean {
  const meta = BAILIAN_BASE_MODELS[modelId];
  return meta?.hasThinking ?? false;
}

/** 百炼默认模型在 OpenCode 中的显示名（与 Qwen 侧展示一致） */
const BAILIAN_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "qwen3.5-plus": "Qwen 3.5 Plus",
  "qwen3-coder-plus": "Qwen 3 Coder Plus",
  "qwen3-coder-next": "Qwen 3 Coder Next",
  "qwen3-max-2026-01-23": "Qwen 3 Max",
  "glm-4.7": "GLM 4.7",
  "glm-5": "GLM 5",
  "MiniMax-M2.5": "MiniMax M2.5",
  "kimi-k2.5": "Kimi K2.5",
};

/** OpenCode 模型默认项：name 必填，支持 thinking 的模型带 options.thinking */
const OPENCODE_THINKING_OPTION = { type: "enabled" as const };

/**
 * 生成百炼在 OpenCode 预设中使用的默认 models（复用 BAILIAN_DEFAULT_MODEL_IDS）。
 * 供 opencodeProviderPresets 中「百炼」「Coding Plan」共用。
 * 对 BAILIAN_BASE_MODELS 中 hasThinking 为 true 的模型自动加上 options.thinking: { type: "enabled" }。
 */
export function getBailianOpencodeDefaultModels(): Record<
  string,
  { name: string; options?: { thinking: { type: "enabled" } } }
> {
  const out: Record<
    string,
    { name: string; options?: { thinking: { type: "enabled" } } }
  > = {};
  for (const id of BAILIAN_DEFAULT_MODEL_IDS) {
    const name = BAILIAN_MODEL_DISPLAY_NAMES[id] ?? id;
    const base = BAILIAN_BASE_MODELS[id];
    if (base?.hasThinking) {
      out[id] = {
        name,
        options: { thinking: OPENCODE_THINKING_OPTION },
      };
    } else {
      out[id] = { name };
    }
  }
  return out;
}

/** 百炼预设类型对应的区域及 Base URL（OpenAI + Anthropic） */
export const BAILIAN_REGION_URLS: Record<
  BailianPresetType,
  Record<string, { openai: string; anthropic: string }>
> = {
  coding_plan: {
    国内: {
      openai: "https://coding.dashscope.aliyuncs.com/v1",
      anthropic: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    },
    国际: {
      openai: "https://coding-intl.dashscope.aliyuncs.com/v1",
      anthropic: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    },
  },
  general: {
    国内: {
      openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      anthropic: "https://dashscope.aliyuncs.com/apps/anthropic",
    },
    新加坡: {
      openai: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      anthropic: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    },
    弗吉尼亚: {
      openai: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
      anthropic: "https://dashscope-us.aliyuncs.com/apps/anthropic",
    },
  },
};

/** Claude 预设用：区域 -> ANTHROPIC_BASE_URL（仅 Anthropic） */
export const BAILIAN_ANTHROPIC_REGION_URLS: Record<string, string> = {
  国内: "https://dashscope.aliyuncs.com/apps/anthropic",
  新加坡: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
  弗吉尼亚: "https://dashscope-us.aliyuncs.com/apps/anthropic",
};

export function getBailianNamePrefix(type: BailianPresetType): string {
  return type === "general" ? "[Bailian]" : "[Bailian Coding Plan]";
}

export const BAILIAN_ICON = "bailian" as const;
export const BAILIAN_ICON_COLOR = "#624AFF";
