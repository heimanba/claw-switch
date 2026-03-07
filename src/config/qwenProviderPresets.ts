/**
 * Qwen Code 预设供应商配置模板
 * 预设分为两大类：Coding Plan、百炼；区域通过 Base URL 下拉在表单内切换。
 * 另从 OpenCode 预设映射国产 P0 供应商（DeepSeek、Kimi、MiniMax、智谱、豆包等）。
 */
import { ProviderCategory } from "../types";
import {
  BAILIAN_REGION_URLS,
  BAILIAN_BASE_MODELS,
  BAILIAN_DEFAULT_MODEL_IDS,
  getBailianNamePrefix,
  type BailianPresetType,
} from "./bailianShared";
import { opencodeProviderPresets } from "./opencodeProviderPresets";
import {
  opencodePresetToQwenPreset,
  isOpencodePresetMappable,
} from "./opencodeToQwenMapper";

export type QwenPresetType = BailianPresetType;

export interface QwenProviderPreset {
  name: string;
  websiteUrl: string;
  apiKeyUrl?: string; // 获取 API Key 的链接
  settingsConfig: object; // Qwen settings.json 结构
  isOfficial?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  category?: ProviderCategory;
  icon?: string;
  iconColor?: string;
  /** 百炼预设类型：coding_plan 支持国内/国际，general 支持国内/新加坡/弗吉尼亚 */
  qwenPresetType?: QwenPresetType;
}

// 模型配置接口
interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  description?: string;
  generationConfig?: {
    extra_body?: {
      enable_thinking?: boolean;
    };
  };
}

// 工厂函数：创建模型配置（使用公共 BAILIAN_BASE_MODELS）
function createModelConfig(
  modelId: string,
  baseUrl: string,
  envKey: string,
  namePrefix: string = "",
  description?: string
): ModelConfig {
  const baseModel = BAILIAN_BASE_MODELS[modelId];
  const id = baseModel?.id ?? modelId;
  const config: ModelConfig = {
    id,
    name: namePrefix ? `${namePrefix} ${id}` : id,
    baseUrl,
    envKey,
  };

  if (description) {
    config.description = description;
  }

  if (baseModel?.hasThinking) {
    config.generationConfig = {
      extra_body: {
        enable_thinking: true,
      },
    };
  }

  return config;
}

/** 获取百炼预设的 namePrefix（兼容旧引用） */
export function getNamePrefix(type: QwenPresetType): string {
  return getBailianNamePrefix(type);
}

/**
 * 统一工厂函数：创建百炼预设的模型配置
 * @param type 百炼预设类型：coding_plan 或 general
 * @param region 区域（可选，默认为"国内"）
 * @returns 包含 openai 和 anthropic 模型数组的对象
 */
function createBailianPresetConfig(
  type: QwenPresetType,
  region: string = "国内"
): { openai: ModelConfig[]; anthropic: ModelConfig[] } {
  const regionUrls = BAILIAN_REGION_URLS[type]?.[region];
  if (!regionUrls) {
    // 回退到默认区域
    const defaultRegion = type === "coding_plan" ? "国内" : "国内";
    const urls = BAILIAN_REGION_URLS[type]?.[defaultRegion];
    if (!urls) {
      throw new Error(`Invalid preset type or region: ${type}, ${region}`);
    }
    return createBailianPresetConfig(type, defaultRegion);
  }

  const envKey = "BAILIAN_CODING_PLAN_API_KEY";
  const namePrefix = getBailianNamePrefix(type);
  const modelIds = [...BAILIAN_DEFAULT_MODEL_IDS];

  return {
    openai: modelIds.map((modelId) =>
      createModelConfig(modelId, regionUrls.openai, envKey, namePrefix)
    ),
    anthropic: modelIds.map((modelId) =>
      createModelConfig(modelId, regionUrls.anthropic, envKey, namePrefix)
    ),
  };
}

/** 国产 P0 供应商名称（从 OpenCode 映射到 Qwen，不含已存在的 Coding Plan / 百炼） */
const QWEN_P0_OPencode_NAMES = new Set([
  "DeepSeek",
  "Zhipu GLM",
  "Zhipu GLM en",
  "Kimi k2.5",
  "Kimi For Coding",
  "MiniMax",
  "MiniMax en",
  "DouBaoSeed",
]);

const qwenMappedPresets: QwenProviderPreset[] = opencodeProviderPresets
  .filter(
    (p) =>
      QWEN_P0_OPencode_NAMES.has(p.name) && isOpencodePresetMappable(p)
  )
  .map(opencodePresetToQwenPreset);

export const qwenProviderPresets: QwenProviderPreset[] = [
  // Coding Plan（区域在表单内通过 TAG 切换：国内 / 国际）
  {
    name: "Coding Plan",
    websiteUrl: "https://www.aliyun.com/",
    apiKeyUrl: "https://bailian.console.aliyun.com/?tab=coding-plan#/efm/detail",
    category: "cn_official",
    isOfficial: true,
    icon: "bailian",
    iconColor: "#624AFF",
    qwenPresetType: "coding_plan",
    settingsConfig: {
      modelProviders: createBailianPresetConfig("coding_plan", "国内"),
      env: {
        BAILIAN_CODING_PLAN_API_KEY: "",
      },
      security: {
        auth: {
          selectedType: "openai",
        },
      },
      model: {
        name: "qwen3.5-plus",
      },
    },
  },

  // 百炼（区域在表单内通过 TAG 切换：国内 / 新加坡 / 弗吉尼亚）
  {
    name: "百炼",
    websiteUrl: "https://www.aliyun.com/",
    apiKeyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    category: "cn_official",
    isOfficial: true,
    icon: "bailian",
    iconColor: "#624AFF",
    qwenPresetType: "general",
    settingsConfig: {
      modelProviders: createBailianPresetConfig("general", "国内"),
      env: {
        BAILIAN_CODING_PLAN_API_KEY: "",
      },
      security: {
        auth: {
          selectedType: "openai",
        },
      },
      model: {
        name: "qwen3.5-plus",
      },
    },
  },

  // 自定义配置模板
  {
    name: "自定义配置",
    websiteUrl: "",
    category: "custom",
    icon: "bailian",
    iconColor: "#6B7280",
    settingsConfig: {
      modelProviders: {
        openai: [
          {
            id: "custom-model",
            name: "Custom Model",
            baseUrl: "https://your-api-endpoint.com/v1",
            description: "Custom Qwen-compatible endpoint",
            envKey: "CUSTOM_API_KEY",
          },
        ],
      },
      env: {
        CUSTOM_API_KEY: "",
      },
      security: {
        auth: {
          selectedType: "openai",
        },
      },
      model: {
        name: "custom-model",
      },
    },
  },
  ...qwenMappedPresets,
];
