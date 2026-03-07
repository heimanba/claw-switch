/**
 * 将 OpenCode 供应商预设映射为 Qwen settingsConfig。
 * 用于 QwenCode 复用 Opencode 预设，仅支持 baseURL + apiKey 直映射（无模板变量）。
 */
import type { OpenCodeProviderConfig } from "../types";
import type { OpenCodeProviderPreset } from "./opencodeProviderPresets";
import type { QwenProviderPreset } from "./qwenProviderPresets";

type QwenSettingsConfig = QwenProviderPreset["settingsConfig"];

interface QwenModelItem {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  description?: string;
}

/** 生成 Qwen env 用的 API Key 变量名（如 DEEPSEEK_API_KEY） */
function presetNameToEnvKey(presetName: string): string {
  const key = presetName
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
  return key ? `${key}_API_KEY` : "CUSTOM_API_KEY";
}

/** npm 包名 -> Qwen security.auth.selectedType */
function npmToSelectedType(npm: string): "openai" | "anthropic" {
  if (npm.includes("anthropic")) return "anthropic";
  return "openai";
}

/** 判断 OpenCode 预设是否可安全映射（无 baseURL 模板变量） */
export function isOpencodePresetMappable(preset: OpenCodeProviderPreset): boolean {
  const baseURL = preset.settingsConfig?.options?.baseURL;
  if (!baseURL || typeof baseURL !== "string") return false;
  return !baseURL.includes("${");
}

/**
 * 将 OpenCode 预设的 settingsConfig 转为 Qwen settingsConfig。
 * 仅处理 openai-compatible / openai / anthropic；baseURL 不得含模板变量。
 */
export function opencodePresetToQwenSettingsConfig(
  preset: OpenCodeProviderPreset
): QwenSettingsConfig {
  const config = preset.settingsConfig as OpenCodeProviderConfig;
  const { npm, options = {}, models = {} } = config;
  const baseURL = (options.baseURL ?? "").trim();
  const apiKey = (options.apiKey ?? "").trim();

  if (!baseURL) {
    throw new Error(
      `[opencodeToQwen] preset "${preset.name}" has no options.baseURL`
    );
  }
  if (baseURL.includes("${")) {
    throw new Error(
      `[opencodeToQwen] preset "${preset.name}" has template in baseURL, cannot map`
    );
  }

  const selectedType = npmToSelectedType(npm);
  const envKey = presetNameToEnvKey(preset.name);

  const modelEntries = Object.entries(models);
  const providerList: QwenModelItem[] = modelEntries.map(([id, m]) => ({
    id,
    name: (m?.name as string) ?? id,
    baseUrl: baseURL,
    envKey,
  }));

  const firstModelId = modelEntries[0]?.[0] ?? "custom-model";

  const modelProviders: Record<string, QwenModelItem[]> = {
    [selectedType]: providerList,
  };

  const env: Record<string, string> = {
    [envKey]: apiKey,
  };

  return {
    modelProviders,
    env,
    security: {
      auth: {
        selectedType,
      },
    },
    model: {
      name: firstModelId,
    },
  } as QwenSettingsConfig;
}

/**
 * 将 OpenCode 预设转为完整的 QwenProviderPreset（含 name、websiteUrl 等）。
 */
export function opencodePresetToQwenPreset(
  preset: OpenCodeProviderPreset
): QwenProviderPreset {
  const settingsConfig = opencodePresetToQwenSettingsConfig(preset);
  return {
    name: preset.name,
    websiteUrl: preset.websiteUrl ?? "",
    apiKeyUrl: preset.apiKeyUrl,
    settingsConfig,
    isOfficial: preset.isOfficial,
    isPartner: preset.isPartner,
    partnerPromotionKey: preset.partnerPromotionKey,
    category: preset.category,
    icon: preset.icon,
    iconColor: preset.iconColor,
  };
}
