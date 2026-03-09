import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import type { AppId } from "@/lib/api";
import type {
  ProviderCategory,
  ProviderMeta,
  ProviderTestConfig,
  ProviderProxyConfig,
  ClaudeApiFormat,
} from "@/types";
import {
  providerPresets,
  type ProviderPreset,
} from "@/config/claudeProviderPresets";
import {
  BAILIAN_DEFAULT_MODEL_IDS,
  bailianModelSupportsThinking,
} from "@/config/bailianShared";
import {
  codexProviderPresets,
  type CodexProviderPreset,
} from "@/config/codexProviderPresets";
import {
  geminiProviderPresets,
  type GeminiProviderPreset,
} from "@/config/geminiProviderPresets";
import {
  opencodeProviderPresets,
  type OpenCodeProviderPreset,
} from "@/config/opencodeProviderPresets";
import {
  openclawProviderPresets,
  type OpenClawProviderPreset,
  type OpenClawSuggestedDefaults,
} from "@/config/openclawProviderPresets";
import {
  qwenProviderPresets,
  type QwenProviderPreset,
  type QwenPresetType,
} from "@/config/qwenProviderPresets";
import { OpenCodeFormFields } from "./OpenCodeFormFields";
import { OpenClawFormFields } from "./OpenClawFormFields";
import { QwenFormFields } from "./QwenFormFields";
import { ClineFormFields } from "./ClineFormFields";
import type { UniversalProviderPreset } from "@/config/universalProviderPresets";
import {
  applyTemplateValues,
  hasApiKeyField,
} from "@/utils/providerConfigUtils";
import { mergeProviderMeta } from "@/utils/providerMetaUtils";
import { getCodexCustomTemplate } from "@/config/codexTemplates";
import CodexConfigEditor from "./CodexConfigEditor";
import { CommonConfigEditor } from "./CommonConfigEditor";
import GeminiConfigEditor from "./GeminiConfigEditor";
import JsonEditor from "@/components/JsonEditor";
import { Label } from "@/components/ui/label";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { BasicFormFields } from "./BasicFormFields";
import { ClaudeFormFields } from "./ClaudeFormFields";
import { CodexFormFields } from "./CodexFormFields";
import { GeminiFormFields } from "./GeminiFormFields";
import { OmoFormFields } from "./OmoFormFields";
import { parseOmoOtherFieldsObject } from "@/types/omo";
import {
  ProviderAdvancedConfig,
  type PricingModelSourceOption,
} from "./ProviderAdvancedConfig";
import {
  useProviderCategory,
  useApiKeyState,
  useBaseUrlState,
  useModelState,
  useCodexConfigState,
  useApiKeyLink,
  useTemplateValues,
  useCommonConfigSnippet,
  useCodexCommonConfig,
  useSpeedTestEndpoints,
  useCodexTomlValidation,
  useGeminiConfigState,
  useGeminiCommonConfig,
  useOmoModelSource,
  useOpencodeFormState,
  useOmoDraftState,
  useOpenclawFormState,
} from "./hooks";
import {
  CLAUDE_DEFAULT_CONFIG,
  CODEX_DEFAULT_CONFIG,
  GEMINI_DEFAULT_CONFIG,
  OPENCODE_DEFAULT_CONFIG,
  OPENCLAW_DEFAULT_CONFIG,
  normalizePricingSource,
} from "./helpers/opencodeFormUtils";

const QWEN_DEFAULT_CONFIG = JSON.stringify(
  {
    modelProviders: {
      openai: [
        {
          id: "qwen3-coder-plus",
          name: "qwen3-coder-plus",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          envKey: "DASHSCOPE_API_KEY",
        },
      ],
    },
    env: {
      DASHSCOPE_API_KEY: "",
    },
    security: {
      auth: {
        selectedType: "openai",
      },
    },
    model: {
      name: "qwen3-coder-plus",
    },
  },
  null,
  2,
);

const CLINE_DEFAULT_CONFIG = JSON.stringify(
  {
    authProtocol: "anthropic",
    planModeApiProvider: "anthropic",
    actModeApiProvider: "anthropic",
    openAiBaseUrl: "",
    planModeOpenAiModelId: "",
    actModeOpenAiModelId: "",
    anthropicBaseUrl: "",
    planModeApiModelId: "",
    actModeApiModelId: "",
  },
  null,
  2,
);

type PresetEntry = {
  id: string;
  preset:
    | ProviderPreset
    | CodexProviderPreset
    | GeminiProviderPreset
    | OpenCodeProviderPreset
    | OpenClawProviderPreset
    | QwenProviderPreset;
};

interface ProviderFormProps {
  appId: AppId;
  providerId?: string;
  submitLabel: string;
  onSubmit: (values: ProviderFormValues) => void;
  onCancel: () => void;
  onUniversalPresetSelect?: (preset: UniversalProviderPreset) => void;
  onManageUniversalProviders?: () => void;
  initialData?: {
    name?: string;
    websiteUrl?: string;
    notes?: string;
    settingsConfig?: Record<string, unknown>;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    icon?: string;
    iconColor?: string;
  };
  showButtons?: boolean;
  /** 隐藏内部预设选择器（双栏模式下由外部控制） */
  hidePresetSelector?: boolean;
  /** 初始化时预选的预设 ID（外部控制模式） */
  initialPresetId?: string;
}

export function ProviderForm({
  appId,
  providerId,
  submitLabel,
  onSubmit,
  onCancel,
  onUniversalPresetSelect,
  onManageUniversalProviders,
  initialData,
  showButtons = true,
  hidePresetSelector = false,
  initialPresetId,
}: ProviderFormProps) {
  const { t } = useTranslation();
  const isEditMode = Boolean(initialData);

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    initialData ? null : (initialPresetId ?? "custom"),
  );
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
    isPartner?: boolean;
    partnerPromotionKey?: string;
    suggestedDefaults?: OpenClawSuggestedDefaults;
    qwenPresetType?: QwenPresetType;
    /** Bailian 预设：区域 -> ANTHROPIC_BASE_URL */
    bailianRegionUrls?: Record<string, string>;
    /** Bailian 预设：锁定 API 格式为 anthropic */
    lockApiFormat?: boolean;
    /** OpenClaw 预设：API 协议 -> baseUrl 映射 */
    apiBaseUrlMap?: Partial<Record<string, string>>;
  } | null>(null);
  const [isEndpointModalOpen, setIsEndpointModalOpen] = useState(false);
  const [isCodexEndpointModalOpen, setIsCodexEndpointModalOpen] =
    useState(false);

  // 用于跟踪输入法（IME）组合输入状态，避免中文输入法产生多余连字符
  const isOpencodeKeyComposing = useRef(false);
  const isOpenclawKeyComposing = useRef(false);

  const [draftCustomEndpoints, setDraftCustomEndpoints] = useState<string[]>(
    () => {
      if (initialData) return [];
      return [];
    },
  );
  const [endpointAutoSelect, setEndpointAutoSelect] = useState<boolean>(
    () => initialData?.meta?.endpointAutoSelect ?? true,
  );

  const [testConfig, setTestConfig] = useState<ProviderTestConfig>(
    () => initialData?.meta?.testConfig ?? { enabled: false },
  );
  const [proxyConfig, setProxyConfig] = useState<ProviderProxyConfig>(
    () => initialData?.meta?.proxyConfig ?? { enabled: false },
  );
  const [pricingConfig, setPricingConfig] = useState<{
    enabled: boolean;
    costMultiplier?: string;
    pricingModelSource: PricingModelSourceOption;
  }>(() => ({
    enabled:
      initialData?.meta?.costMultiplier !== undefined ||
      initialData?.meta?.pricingModelSource !== undefined,
    costMultiplier: initialData?.meta?.costMultiplier,
    pricingModelSource: normalizePricingSource(
      initialData?.meta?.pricingModelSource,
    ),
  }));

  const { category } = useProviderCategory({
    appId,
    selectedPresetId,
    isEditMode,
    initialCategory: initialData?.category,
  });
  const isOmoCategory = appId === "opencode" && category === "omo";
  const isOmoSlimCategory = appId === "opencode" && category === "omo-slim";
  const isAnyOmoCategory = isOmoCategory || isOmoSlimCategory;

  useEffect(() => {
    const resolvedPresetId = initialData ? null : (initialPresetId ?? "custom");
    setSelectedPresetId(resolvedPresetId);

    // 如果有 initialPresetId，初始化 activePreset（主要用于新增模式预设切换）
    if (!initialData && resolvedPresetId && resolvedPresetId !== "custom") {
      const allPresets: PresetEntry[] = appId === "qwen"
        ? qwenProviderPresets.map((p, i) => ({ id: `qwen-${i}`, preset: p }))
        : appId === "openclaw"
          ? openclawProviderPresets.map((p, i) => ({ id: `openclaw-${i}`, preset: p }))
          : [];
      const entry = allPresets.find((e) => e.id === resolvedPresetId);
      if (entry) {
        setActivePreset({
          id: resolvedPresetId,
          category: entry.preset.category,
          isPartner: entry.preset.isPartner,
          partnerPromotionKey: entry.preset.partnerPromotionKey,
          ...(appId === "qwen" && "qwenPresetType" in entry.preset
            ? { qwenPresetType: (entry.preset as QwenProviderPreset).qwenPresetType }
            : {}),
          ...(appId === "openclaw" && "apiBaseUrlMap" in entry.preset
            ? { apiBaseUrlMap: (entry.preset as OpenClawProviderPreset).apiBaseUrlMap }
            : {}),
        });
        // 重置 form 基础字段（注意：仅当 defaultValues 未包含预设数据时才需要，通常由 defaultValues useMemo 处理）
        // 这里不调用 form.reset 是因为 defaultValues effect 会在此之后运行
      } else {
        setActivePreset(null);
      }
    } else {
      setActivePreset(null);
    }

    if (!initialData) {
      setDraftCustomEndpoints([]);
    }
    setEndpointAutoSelect(initialData?.meta?.endpointAutoSelect ?? true);
    setTestConfig(initialData?.meta?.testConfig ?? { enabled: false });
    setProxyConfig(initialData?.meta?.proxyConfig ?? { enabled: false });
    setPricingConfig({
      enabled:
        initialData?.meta?.costMultiplier !== undefined ||
        initialData?.meta?.pricingModelSource !== undefined,
      costMultiplier: initialData?.meta?.costMultiplier,
      pricingModelSource: normalizePricingSource(
        initialData?.meta?.pricingModelSource,
      ),
    });
  }, [appId, initialData]);

  const defaultValues: ProviderFormData = useMemo(
    () => {
      // 新增模式且有 initialPresetId 时，从对应预设加载默认值
      if (!initialData && initialPresetId && initialPresetId !== "custom") {
        if (appId === "qwen") {
          const presetIndex = parseInt(initialPresetId.replace("qwen-", ""));
          if (!isNaN(presetIndex) && presetIndex >= 0 && presetIndex < qwenProviderPresets.length) {
            const preset = qwenProviderPresets[presetIndex];
            return {
              name: preset.name,
              websiteUrl: preset.websiteUrl ?? "",
              notes: "",
              settingsConfig: JSON.stringify(preset.settingsConfig, null, 2),
              icon: preset.icon ?? "",
              iconColor: preset.iconColor ?? "",
            };
          }
        }
        if (appId === "openclaw") {
          const presetIndex = parseInt(initialPresetId.replace("openclaw-", ""));
          if (!isNaN(presetIndex) && presetIndex >= 0 && presetIndex < openclawProviderPresets.length) {
            const preset = openclawProviderPresets[presetIndex];
            return {
              name: preset.name,
              websiteUrl: preset.websiteUrl ?? "",
              notes: "",
              settingsConfig: JSON.stringify(preset.settingsConfig, null, 2),
              icon: preset.icon ?? "",
              iconColor: preset.iconColor ?? "",
            };
          }
        }
      }
      return {
        name: initialData?.name ?? "",
        websiteUrl: initialData?.websiteUrl ?? "",
        notes: initialData?.notes ?? "",
        settingsConfig: initialData?.settingsConfig
          ? JSON.stringify(initialData.settingsConfig, null, 2)
          : appId === "codex"
            ? CODEX_DEFAULT_CONFIG
            : appId === "gemini"
              ? GEMINI_DEFAULT_CONFIG
              : appId === "opencode"
                ? OPENCODE_DEFAULT_CONFIG
                : appId === "openclaw"
                  ? OPENCLAW_DEFAULT_CONFIG
                  : appId === "qwen"
                    ? QWEN_DEFAULT_CONFIG
                    : appId === "cline"
                      ? CLINE_DEFAULT_CONFIG
                      : CLAUDE_DEFAULT_CONFIG,
        icon: initialData?.icon ?? "",
        iconColor: initialData?.iconColor ?? "",
      };
    },
    [initialData, appId, initialPresetId],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });

  const {
    apiKey,
    handleApiKeyChange,
    showApiKey: shouldShowApiKey,
  } = useApiKeyState({
    initialConfig: form.getValues("settingsConfig"),
    onConfigChange: (config) => form.setValue("settingsConfig", config),
    selectedPresetId,
    category,
    appType: appId,
  });

  const { baseUrl, handleClaudeBaseUrlChange } = useBaseUrlState({
    appType: appId,
    category,
    settingsConfig: form.getValues("settingsConfig"),
    codexConfig: "",
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    onCodexConfigChange: () => {},
  });

  const {
    claudeModel,
    reasoningModel,
    defaultHaikuModel,
    defaultSonnetModel,
    defaultOpusModel,
    handleModelChange,
  } = useModelState({
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: (config) => form.setValue("settingsConfig", config),
  });

  const [localApiFormat, setLocalApiFormat] = useState<ClaudeApiFormat>(() => {
    if (appId !== "claude") return "anthropic";
    return initialData?.meta?.apiFormat ?? "anthropic";
  });

  const handleApiFormatChange = useCallback((format: ClaudeApiFormat) => {
    setLocalApiFormat(format);
  }, []);

  const {
    codexAuth,
    codexConfig,
    codexApiKey,
    codexBaseUrl,
    codexModelName,
    codexAuthError,
    setCodexAuth,
    handleCodexApiKeyChange,
    handleCodexBaseUrlChange,
    handleCodexModelNameChange,
    handleCodexConfigChange: originalHandleCodexConfigChange,
    resetCodexConfig,
  } = useCodexConfigState({ initialData });

  const { configError: codexConfigError, debouncedValidate } =
    useCodexTomlValidation();

  const handleCodexConfigChange = useCallback(
    (value: string) => {
      originalHandleCodexConfigChange(value);
      debouncedValidate(value);
    },
    [originalHandleCodexConfigChange, debouncedValidate],
  );

  useEffect(() => {
    if (appId === "codex" && !initialData && selectedPresetId === "custom") {
      const template = getCodexCustomTemplate();
      resetCodexConfig(template.auth, template.config);
    }
  }, [appId, initialData, selectedPresetId, resetCodexConfig]);

  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  const presetEntries = useMemo(() => {
    if (appId === "codex") {
      return codexProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `codex-${index}`,
        preset,
      }));
    } else if (appId === "gemini") {
      return geminiProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `gemini-${index}`,
        preset,
      }));
    } else if (appId === "opencode") {
      return opencodeProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `opencode-${index}`,
        preset,
      }));
    } else if (appId === "openclaw") {
      return openclawProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `openclaw-${index}`,
        preset,
      }));
    } else if (appId === "qwen") {
      return qwenProviderPresets.map<PresetEntry>((preset, index) => ({
        id: `qwen-${index}`,
        preset,
      }));
    }
    return providerPresets.map<PresetEntry>((preset, index) => ({
      id: `claude-${index}`,
      preset,
    }));
  }, [appId]);

  const {
    templateValues,
    templateValueEntries,
    selectedPreset: templatePreset,
    handleTemplateValueChange,
    validateTemplateValues,
  } = useTemplateValues({
    selectedPresetId: appId === "claude" ? selectedPresetId : null,
    presetEntries: appId === "claude" ? presetEntries : [],
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: (config) => form.setValue("settingsConfig", config),
  });

  const {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    isExtracting: isClaudeExtracting,
    handleExtract: handleClaudeExtract,
  } = useCommonConfigSnippet({
    settingsConfig: form.getValues("settingsConfig"),
    onConfigChange: (config) => form.setValue("settingsConfig", config),
    initialData: appId === "claude" ? initialData : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
    enabled: appId === "claude",
  });

  const {
    useCommonConfig: useCodexCommonConfigFlag,
    commonConfigSnippet: codexCommonConfigSnippet,
    commonConfigError: codexCommonConfigError,
    handleCommonConfigToggle: handleCodexCommonConfigToggle,
    handleCommonConfigSnippetChange: handleCodexCommonConfigSnippetChange,
    isExtracting: isCodexExtracting,
    handleExtract: handleCodexExtract,
  } = useCodexCommonConfig({
    codexConfig,
    onConfigChange: handleCodexConfigChange,
    initialData: appId === "codex" ? initialData : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  const {
    geminiEnv,
    geminiConfig,
    geminiApiKey,
    geminiBaseUrl,
    geminiModel,
    envError,
    configError: geminiConfigError,
    handleGeminiApiKeyChange: originalHandleGeminiApiKeyChange,
    handleGeminiBaseUrlChange: originalHandleGeminiBaseUrlChange,
    handleGeminiModelChange: originalHandleGeminiModelChange,
    handleGeminiEnvChange,
    handleGeminiConfigChange,
    resetGeminiConfig,
    envStringToObj,
    envObjToString,
  } = useGeminiConfigState({
    initialData: appId === "gemini" ? initialData : undefined,
  });

  const updateGeminiEnvField = useCallback(
    (
      key: "GEMINI_API_KEY" | "GOOGLE_GEMINI_BASE_URL" | "GEMINI_MODEL",
      value: string,
    ) => {
      try {
        const config = JSON.parse(form.getValues("settingsConfig") || "{}") as {
          env?: Record<string, unknown>;
        };
        if (!config.env || typeof config.env !== "object") {
          config.env = {};
        }
        config.env[key] = value;
        form.setValue("settingsConfig", JSON.stringify(config, null, 2));
      } catch {}
    },
    [form],
  );

  const handleGeminiApiKeyChange = useCallback(
    (key: string) => {
      originalHandleGeminiApiKeyChange(key);
      updateGeminiEnvField("GEMINI_API_KEY", key.trim());
    },
    [originalHandleGeminiApiKeyChange, updateGeminiEnvField],
  );

  const handleGeminiBaseUrlChange = useCallback(
    (url: string) => {
      originalHandleGeminiBaseUrlChange(url);
      updateGeminiEnvField(
        "GOOGLE_GEMINI_BASE_URL",
        url.trim().replace(/\/+$/, ""),
      );
    },
    [originalHandleGeminiBaseUrlChange, updateGeminiEnvField],
  );

  const handleGeminiModelChange = useCallback(
    (model: string) => {
      originalHandleGeminiModelChange(model);
      updateGeminiEnvField("GEMINI_MODEL", model.trim());
    },
    [originalHandleGeminiModelChange, updateGeminiEnvField],
  );

  const {
    useCommonConfig: useGeminiCommonConfigFlag,
    commonConfigSnippet: geminiCommonConfigSnippet,
    commonConfigError: geminiCommonConfigError,
    handleCommonConfigToggle: handleGeminiCommonConfigToggle,
    handleCommonConfigSnippetChange: handleGeminiCommonConfigSnippetChange,
    isExtracting: isGeminiExtracting,
    handleExtract: handleGeminiExtract,
  } = useGeminiCommonConfig({
    envValue: geminiEnv,
    onEnvChange: handleGeminiEnvChange,
    envStringToObj,
    envObjToString,
    initialData: appId === "gemini" ? initialData : undefined,
    selectedPresetId: selectedPresetId ?? undefined,
  });

  // ── Extracted hooks: OpenCode / OMO / OpenClaw ─────────────────────

  const {
    omoModelOptions,
    omoModelVariantsMap,
    omoPresetMetaMap,
    existingOpencodeKeys,
  } = useOmoModelSource({ isOmoCategory: isAnyOmoCategory, providerId });

  const opencodeForm = useOpencodeFormState({
    initialData,
    appId,
    providerId,
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    getSettingsConfig: () => form.getValues("settingsConfig"),
  });

  const initialOmoSettings =
    appId === "opencode" &&
    (initialData?.category === "omo" || initialData?.category === "omo-slim")
      ? (initialData.settingsConfig as Record<string, unknown> | undefined)
      : undefined;

  const omoDraft = useOmoDraftState({
    initialOmoSettings,
    isEditMode,
    appId,
    category,
  });

  const openclawForm = useOpenclawFormState({
    initialData,
    appId,
    providerId,
    initialPresetConfig: (() => {
      // 新增模式下，从 initialPresetId 加载预设配置作为初始状态
      if (appId === "openclaw" && !initialData && initialPresetId && initialPresetId !== "custom") {
        const presetIndex = parseInt(initialPresetId.replace("openclaw-", ""));
        if (!isNaN(presetIndex) && presetIndex >= 0 && presetIndex < openclawProviderPresets.length) {
          const preset = openclawProviderPresets[presetIndex];
          const config = preset.settingsConfig;
          return {
            providerKey: preset.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
            baseUrl: config.baseUrl ?? "",
            apiKey: config.apiKey ?? "",
            api: config.api ?? "openai-completions",
            models: (config.models as import("@/types").OpenClawModel[]) ?? [],
          };
        }
      }
      return undefined;
    })(),
    apiBaseUrlMap: activePreset?.apiBaseUrlMap,
    onSettingsConfigChange: (config) => form.setValue("settingsConfig", config),
    getSettingsConfig: () => form.getValues("settingsConfig"),
  });

  // ── Qwen 状态管理 ─────────────────────────────────────────────────
  // 辅助：从 initialPresetId 加载预设配置（新增模式下用于初始化状态）
  const getQwenPresetConfig = () => {
    if (appId !== "qwen" || !initialPresetId || initialPresetId === "custom") return null;
    const presetIndex = parseInt(initialPresetId.replace("qwen-", ""));
    if (isNaN(presetIndex)) return null;
    const preset = qwenProviderPresets[presetIndex];
    return preset ? (preset.settingsConfig as any) : null;
  };

  const [qwenSelectedType, setQwenSelectedType] = useState(() => {
    if (appId !== "qwen") return "openai";
    if (initialData) {
      try {
        const config = initialData.settingsConfig as any;
        return config?.security?.auth?.selectedType || "openai";
      } catch {
        return "openai";
      }
    }
    const presetConfig = getQwenPresetConfig();
    return presetConfig?.security?.auth?.selectedType || "openai";
  });

  const [qwenModelName, setQwenModelName] = useState(() => {
    if (appId !== "qwen") return "qwen3-coder-plus";
    if (initialData) {
      try {
        const config = initialData.settingsConfig as any;
        return config?.model?.name ?? "qwen3-coder-plus";
      } catch {
        return "qwen3-coder-plus";
      }
    }
    const presetConfig = getQwenPresetConfig();
    return presetConfig?.model?.name ?? "qwen3-coder-plus";
  });

  const [qwenEnvVars, setQwenEnvVars] = useState(() => {
    if (appId !== "qwen") return { DASHSCOPE_API_KEY: "" };
    if (initialData) {
      try {
        const config = initialData.settingsConfig as any;
        return config?.env || { DASHSCOPE_API_KEY: "" };
      } catch {
        return { DASHSCOPE_API_KEY: "" };
      }
    }
    const presetConfig = getQwenPresetConfig();
    return presetConfig?.env || { BAILIAN_CODING_PLAN_API_KEY: "" };
  });

  const [qwenModelProviders, setQwenModelProviders] = useState(() => {
    if (appId !== "qwen") {
      return JSON.stringify(
        {
          openai: [
            {
              id: "qwen3-coder-plus",
              name: "qwen3-coder-plus",
              baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
              envKey: "DASHSCOPE_API_KEY",
            },
          ],
        },
        null,
        2,
      );
    }
    if (initialData) {
      try {
        const config = initialData.settingsConfig as any;
        return JSON.stringify(config?.modelProviders || {}, null, 2);
      } catch {
        return "{}";
      }
    }
    const presetConfig = getQwenPresetConfig();
    if (presetConfig?.modelProviders) {
      return JSON.stringify(presetConfig.modelProviders, null, 2);
    }
    return JSON.stringify(
      {
        openai: [
          {
            id: "qwen3-coder-plus",
            name: "qwen3-coder-plus",
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            envKey: "DASHSCOPE_API_KEY",
          },
        ],
      },
      null,
      2,
    );
  });

  const [qwenDeprecatedApiKey, setQwenDeprecatedApiKey] = useState(() => {
    if (appId !== "qwen" || !initialData) return "";
    try {
      const config = initialData.settingsConfig as any;
      return config?.security?.auth?.apiKey || "";
    } catch {
      return "";
    }
  });

  const [qwenDeprecatedBaseUrl, setQwenDeprecatedBaseUrl] = useState(() => {
    if (appId !== "qwen" || !initialData) return "";
    try {
      const config = initialData.settingsConfig as any;
      return config?.security?.auth?.baseUrl || "";
    } catch {
      return "";
    }
  });

  // ── Cline 状态管理 ─────────────────────────────────────────────────
  const [clineConfig, setClineConfig] = useState(() => {
    if (appId !== "cline" || !initialData) {
      return {
        authProtocol: "anthropic",
        openAiBaseUrl: "",
        planModeOpenAiModelId: "",
        actModeOpenAiModelId: "",
        openAiApiKey: "",
        anthropicBaseUrl: "",
        planModeApiModelId: "",
        actModeApiModelId: "",
        apiKey: "",
      };
    }
    try {
      // 处理 settingsConfig 可能是字符串或对象的情况
      let config: any;
      if (typeof initialData.settingsConfig === "string") {
        config = JSON.parse(initialData.settingsConfig);
      } else {
        config = initialData.settingsConfig;
      }

      // 兼容旧数据：如果存在 planModeApiProvider，使用它作为 authProtocol
      const legacyProvider = config?.planModeApiProvider || "anthropic";
      const result = {
        authProtocol: config?.authProtocol || legacyProvider,
        openAiBaseUrl: config?.openAiBaseUrl || "",
        planModeOpenAiModelId: config?.planModeOpenAiModelId || "",
        actModeOpenAiModelId: config?.actModeOpenAiModelId || "",
        openAiApiKey: config?.openAiApiKey || "",
        anthropicBaseUrl: config?.anthropicBaseUrl || "",
        planModeApiModelId: config?.planModeApiModelId || "",
        actModeApiModelId: config?.actModeApiModelId || "",
        apiKey: config?.apiKey || "",
      };
      return result;
    } catch {
      return {
        authProtocol: "anthropic",
        openAiBaseUrl: "",
        planModeOpenAiModelId: "",
        actModeOpenAiModelId: "",
        openAiApiKey: "",
        anthropicBaseUrl: "",
        planModeApiModelId: "",
        actModeApiModelId: "",
        apiKey: "",
      };
    }
  });

  // 监听 initialData 变化，更新 clineConfig 状态
  useEffect(() => {
    if (appId !== "cline" || !initialData) {
      return;
    }

    try {
      // 处理 settingsConfig 可能是字符串或对象的情况
      let config: any;
      if (typeof initialData.settingsConfig === "string") {
        config = JSON.parse(initialData.settingsConfig);
      } else {
        config = initialData.settingsConfig;
      }

      // 兼容旧数据：如果存在 planModeApiProvider，使用它作为 authProtocol
      const legacyProvider = config?.planModeApiProvider || "anthropic";
      const newConfig = {
        authProtocol: config?.authProtocol || legacyProvider,
        openAiBaseUrl: config?.openAiBaseUrl || "",
        planModeOpenAiModelId: config?.planModeOpenAiModelId || "",
        actModeOpenAiModelId: config?.actModeOpenAiModelId || "",
        openAiApiKey: config?.openAiApiKey || "",
        anthropicBaseUrl: config?.anthropicBaseUrl || "",
        planModeApiModelId: config?.planModeApiModelId || "",
        actModeApiModelId: config?.actModeApiModelId || "",
        apiKey: config?.apiKey || "",
      };
      setClineConfig(newConfig);
    } catch (error) {
      console.warn("Failed to parse Cline config from initialData:", error);
    }
  }, [appId, initialData]);

  // 仅当「当前编辑的 provider」变化时从 initialData 同步 Qwen 状态，避免重渲染时用旧 config 覆盖用户已改的 region/modelProviders（修复：协议 OpenAI 时切换 Region 后 Base URL 回滚）
  const qwenInitialDataRef = useRef<typeof initialData>(undefined);
  const qwenAppliedProviderIdRef = useRef<string | null>(null);
  if (appId === "qwen") {
    qwenInitialDataRef.current = initialData ?? undefined;
  }
  useEffect(() => {
    if (appId !== "qwen") {
      qwenAppliedProviderIdRef.current = null;
      return;
    }
    const data = qwenInitialDataRef.current;
    if (!data) return;
    const currentProviderId = providerId ?? "edit";
    if (qwenAppliedProviderIdRef.current === currentProviderId) return;
    qwenAppliedProviderIdRef.current = currentProviderId;
    try {
      let config: Record<string, unknown> | undefined;
      if (typeof data.settingsConfig === "string") {
        config = JSON.parse(data.settingsConfig) as Record<string, unknown>;
      } else {
        config = data.settingsConfig as Record<string, unknown> | undefined;
      }
      if (!config) return;
      const security = config.security as Record<string, unknown> | undefined;
      const auth = security?.auth as Record<string, unknown> | undefined;
      const model = config.model as Record<string, unknown> | undefined;
      setQwenSelectedType((auth?.selectedType as string) || "openai");
      setQwenModelName((model?.name as string) ?? "qwen3-coder-plus");
      setQwenEnvVars(
        (config.env as Record<string, string>) || { DASHSCOPE_API_KEY: "" },
      );
      setQwenModelProviders(
        JSON.stringify(
          (config.modelProviders as Record<string, unknown>) || {},
          null,
          2,
        ),
      );
      setQwenDeprecatedApiKey((auth?.apiKey as string) || "");
      setQwenDeprecatedBaseUrl((auth?.baseUrl as string) || "");
    } catch (error) {
      console.warn("Failed to parse Qwen config from initialData:", error);
    }
  }, [appId, providerId]);

  // 编辑态推断 qwenPresetType，使区域切换在编辑预设创建的 provider 时可用
  const qwenPresetTypeFromInitialData = useMemo(():
    | QwenPresetType
    | undefined => {
    if (appId !== "qwen" || !initialData?.settingsConfig) return undefined;
    try {
      const config =
        typeof initialData.settingsConfig === "string"
          ? (JSON.parse(initialData.settingsConfig) as Record<string, unknown>)
          : (initialData.settingsConfig as Record<string, unknown>);
      const mp = config?.modelProviders as
        | Record<string, unknown[] | undefined>
        | undefined;
      if (!mp) return undefined;
      const openaiArr = mp.openai;
      const firstBaseUrl =
        Array.isArray(openaiArr) && openaiArr.length > 0
          ? ((openaiArr[0] as Record<string, unknown>)?.baseUrl as
              | string
              | undefined)
          : undefined;
      if (!firstBaseUrl || typeof firstBaseUrl !== "string") return undefined;
      if (
        firstBaseUrl.includes("coding.dashscope.aliyuncs.com") ||
        firstBaseUrl.includes("coding-intl.dashscope.aliyuncs.com")
      )
        return "coding_plan";
      if (
        firstBaseUrl.includes("dashscope.aliyuncs.com/compatible-mode") ||
        firstBaseUrl.includes("dashscope-intl.aliyuncs.com") ||
        firstBaseUrl.includes("dashscope-us.aliyuncs.com")
      )
        return "general";
      return undefined;
    } catch {
      return undefined;
    }
  }, [appId, initialData?.settingsConfig]);

  const [isCommonConfigModalOpen, setIsCommonConfigModalOpen] = useState(false);

  const handleSubmit = (values: ProviderFormData) => {
    if (appId === "claude" && templateValueEntries.length > 0) {
      const validation = validateTemplateValues();
      if (!validation.isValid && validation.missingField) {
        toast.error(
          t("providerForm.fillParameter", {
            label: validation.missingField.label,
            defaultValue: `请填写 ${validation.missingField.label}`,
          }),
        );
        return;
      }
    }

    if (!values.name.trim()) {
      toast.error(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
      return;
    }

    if (appId === "opencode" && !isAnyOmoCategory) {
      const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!opencodeForm.opencodeProviderKey.trim()) {
        toast.error(t("opencode.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(opencodeForm.opencodeProviderKey)) {
        toast.error(t("opencode.providerKeyInvalid"));
        return;
      }
      if (
        !isEditMode &&
        existingOpencodeKeys.includes(opencodeForm.opencodeProviderKey)
      ) {
        toast.error(t("opencode.providerKeyDuplicate"));
        return;
      }
      if (Object.keys(opencodeForm.opencodeModels).length === 0) {
        toast.error(t("opencode.modelsRequired"));
        return;
      }
    }

    // OpenClaw: validate provider key
    if (appId === "openclaw") {
      const keyPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
      if (!openclawForm.openclawProviderKey.trim()) {
        toast.error(t("openclaw.providerKeyRequired"));
        return;
      }
      if (!keyPattern.test(openclawForm.openclawProviderKey)) {
        toast.error(t("openclaw.providerKeyInvalid"));
        return;
      }
      if (
        !isEditMode &&
        openclawForm.existingOpenclawKeys.includes(
          openclawForm.openclawProviderKey,
        )
      ) {
        toast.error(t("openclaw.providerKeyDuplicate"));
        return;
      }
    }

    // 非官方供应商必填校验：端点和 API Key
    // cloud_provider（如 Bedrock）通过模板变量处理认证，跳过通用校验
    if (category !== "official" && category !== "cloud_provider") {
      if (appId === "claude") {
        if (!baseUrl.trim()) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (!apiKey.trim()) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      } else if (appId === "codex") {
        if (!codexBaseUrl.trim()) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (!codexApiKey.trim()) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      } else if (appId === "gemini") {
        if (!geminiBaseUrl.trim()) {
          toast.error(
            t("providerForm.endpointRequired", {
              defaultValue: "非官方供应商请填写 API 端点",
            }),
          );
          return;
        }
        if (!geminiApiKey.trim()) {
          toast.error(
            t("providerForm.apiKeyRequired", {
              defaultValue: "非官方供应商请填写 API Key",
            }),
          );
          return;
        }
      }
    }

    let settingsConfig: string;

    if (appId === "codex") {
      try {
        const authJson = JSON.parse(codexAuth);
        const configObj = {
          auth: authJson,
          config: codexConfig ?? "",
        };
        settingsConfig = JSON.stringify(configObj);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (appId === "gemini") {
      try {
        const envObj = envStringToObj(geminiEnv);
        const configObj = geminiConfig.trim() ? JSON.parse(geminiConfig) : {};
        const combined = {
          env: envObj,
          config: configObj,
        };
        settingsConfig = JSON.stringify(combined);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (
      appId === "opencode" &&
      (category === "omo" || category === "omo-slim")
    ) {
      const omoConfig: Record<string, unknown> = {};
      if (Object.keys(omoDraft.omoAgents).length > 0) {
        omoConfig.agents = omoDraft.omoAgents;
      }
      if (
        category === "omo" &&
        Object.keys(omoDraft.omoCategories).length > 0
      ) {
        omoConfig.categories = omoDraft.omoCategories;
      }
      if (omoDraft.omoOtherFieldsStr.trim()) {
        try {
          const otherFields = parseOmoOtherFieldsObject(
            omoDraft.omoOtherFieldsStr,
          );
          if (!otherFields) {
            toast.error(
              t("omo.jsonMustBeObject", {
                field: t("omo.otherFields", {
                  defaultValue: "Other Config",
                }),
                defaultValue: "{{field}} must be a JSON object",
              }),
            );
            return;
          }
          omoConfig.otherFields = otherFields;
        } catch {
          toast.error(
            t("omo.invalidJson", {
              defaultValue: "Other Fields contains invalid JSON",
            }),
          );
          return;
        }
      }
      settingsConfig = JSON.stringify(omoConfig);
    } else if (appId === "qwen") {
      try {
        // 构建 Qwen settings.json 结构（与 QwenFormFields 联动一致）
        // 提交 payload 仅来自 qwen* 状态，保证以下路径提交 JSON 可复现 UI：
        // - 切换协议：selectedType/modelProviders 由 onSelectedTypeChange / useEffect 同步 baseUrl
        // - 仅改 Base URL：handleBaseUrlChange -> applyBaseUrlToModelProviders -> onModelProvidersChange
        // - 区域切换：handleRegionChange -> applyRegionToModelProviders -> onModelProvidersChange
        // - 重置默认：handleResetToDefault -> 整块写入当前协议 -> onModelProvidersChange
        const qwenConfig: Record<string, unknown> = {};

        // 解析 modelProviders JSON
        let modelProvidersObj = {};
        try {
          modelProvidersObj = JSON.parse(qwenModelProviders);
        } catch (e) {
          console.warn("Failed to parse modelProviders JSON:", e);
        }

        qwenConfig.modelProviders = modelProvidersObj;
        qwenConfig.env = qwenEnvVars;
        qwenConfig.security = {
          auth: {
            selectedType: qwenSelectedType,
            // 兼容旧版字段：仅在有值时写入
            ...(qwenDeprecatedApiKey && { apiKey: qwenDeprecatedApiKey }),
            ...(qwenDeprecatedBaseUrl && { baseUrl: qwenDeprecatedBaseUrl }),
          },
        };
        qwenConfig.model = {
          name: qwenModelName,
        };

        settingsConfig = JSON.stringify(qwenConfig);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (appId === "cline") {
      try {
        // 构建 Cline 配置结构（仅包含 8 个管理字段）
        // authProtocol 同时控制 planModeApiProvider 和 actModeApiProvider
        // 注意：apiKey 和 openAiApiKey 不在 globalState.json 中，不包含在配置中
        const clineConfigObj = {
          authProtocol: clineConfig.authProtocol,
          planModeApiProvider: clineConfig.authProtocol,
          actModeApiProvider: clineConfig.authProtocol,
          openAiBaseUrl: clineConfig.openAiBaseUrl,
          planModeOpenAiModelId: clineConfig.planModeOpenAiModelId,
          actModeOpenAiModelId: clineConfig.actModeOpenAiModelId,
          anthropicBaseUrl: clineConfig.anthropicBaseUrl,
          planModeApiModelId: clineConfig.planModeApiModelId,
          actModeApiModelId: clineConfig.actModeApiModelId,
        };

        settingsConfig = JSON.stringify(clineConfigObj);
      } catch (err) {
        settingsConfig = values.settingsConfig.trim();
      }
    } else if (appId === "openclaw") {
      // 保存时过滤 models 中 id 为空的条目，避免触发 OpenClaw schema 校验错误
      try {
        const configObj = JSON.parse(values.settingsConfig.trim()) as Record<string, unknown>;
        if (Array.isArray(configObj.models)) {
          configObj.models = (configObj.models as Array<{ id?: string }>).filter(
            (m) => typeof m.id === "string" && m.id.trim().length > 0,
          );
        }
        settingsConfig = JSON.stringify(configObj);
      } catch {
        settingsConfig = values.settingsConfig.trim();
      }
    } else {
      settingsConfig = values.settingsConfig.trim();
    }

    const payload: ProviderFormValues = {
      ...values,
      name: values.name.trim(),
      websiteUrl: values.websiteUrl?.trim() ?? "",
      settingsConfig,
    };

    if (appId === "opencode") {
      if (isAnyOmoCategory) {
        if (!isEditMode) {
          const prefix = category === "omo" ? "omo" : "omo-slim";
          payload.providerKey = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
        }
      } else {
        payload.providerKey = opencodeForm.opencodeProviderKey;
      }
    } else if (appId === "openclaw") {
      payload.providerKey = openclawForm.openclawProviderKey;
    }

    if (isAnyOmoCategory && !payload.presetCategory) {
      payload.presetCategory = category;
    }

    if (activePreset) {
      payload.presetId = activePreset.id;
      if (activePreset.category) {
        payload.presetCategory = activePreset.category;
      }
      if (activePreset.isPartner) {
        payload.isPartner = activePreset.isPartner;
      }
      // OpenClaw: 传递预设的 suggestedDefaults 到提交数据
      if (activePreset.suggestedDefaults) {
        payload.suggestedDefaults = activePreset.suggestedDefaults;
      }
    }

    if (!isEditMode && draftCustomEndpoints.length > 0) {
      const customEndpointsToSave: Record<
        string,
        import("@/types").CustomEndpoint
      > = draftCustomEndpoints.reduce(
        (acc, url) => {
          const now = Date.now();
          acc[url] = { url, addedAt: now, lastUsed: undefined };
          return acc;
        },
        {} as Record<string, import("@/types").CustomEndpoint>,
      );

      const hadEndpoints =
        initialData?.meta?.custom_endpoints &&
        Object.keys(initialData.meta.custom_endpoints).length > 0;
      const needsClearEndpoints =
        hadEndpoints && draftCustomEndpoints.length === 0;

      let mergedMeta = needsClearEndpoints
        ? mergeProviderMeta(initialData?.meta, {})
        : mergeProviderMeta(initialData?.meta, customEndpointsToSave);

      if (activePreset?.isPartner) {
        mergedMeta = {
          ...(mergedMeta ?? {}),
          isPartner: true,
        };
      }

      if (activePreset?.partnerPromotionKey) {
        mergedMeta = {
          ...(mergedMeta ?? {}),
          partnerPromotionKey: activePreset.partnerPromotionKey,
        };
      }

      if (mergedMeta !== undefined) {
        payload.meta = mergedMeta;
      }
    }

    const baseMeta: ProviderMeta | undefined =
      payload.meta ?? (initialData?.meta ? { ...initialData.meta } : undefined);
    payload.meta = {
      ...(baseMeta ?? {}),
      endpointAutoSelect,
      testConfig: testConfig.enabled ? testConfig : undefined,
      proxyConfig: proxyConfig.enabled ? proxyConfig : undefined,
      costMultiplier: pricingConfig.enabled
        ? pricingConfig.costMultiplier
        : undefined,
      pricingModelSource:
        pricingConfig.enabled && pricingConfig.pricingModelSource !== "inherit"
          ? pricingConfig.pricingModelSource
          : undefined,
      apiFormat:
        appId === "claude" && category !== "official"
          ? localApiFormat
          : undefined,
    };

    onSubmit(payload);
  };

  const groupedPresets = useMemo(() => {
    return presetEntries.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
      const category = entry.preset.category ?? "others";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(entry);
      return acc;
    }, {});
  }, [presetEntries]);

  const categoryKeys = useMemo(() => {
    const keys = Object.keys(groupedPresets).filter(
      (key) => key !== "custom" && groupedPresets[key]?.length,
    );
    if (appId === "opencode") {
      const cnOfficialIndex = keys.indexOf("cn_official");
      if (cnOfficialIndex > -1) {
        keys.splice(cnOfficialIndex, 1);
      }
    }
    return keys;
  }, [appId, groupedPresets]);

  const shouldShowSpeedTest =
    category !== "official" && category !== "cloud_provider";

  const {
    shouldShowApiKeyLink: shouldShowClaudeApiKeyLink,
    websiteUrl: claudeWebsiteUrl,
    isPartner: isClaudePartner,
    partnerPromotionKey: claudePartnerPromotionKey,
  } = useApiKeyLink({
    appId: "claude",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  const {
    shouldShowApiKeyLink: shouldShowCodexApiKeyLink,
    websiteUrl: codexWebsiteUrl,
    isPartner: isCodexPartner,
    partnerPromotionKey: codexPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "codex",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  const {
    shouldShowApiKeyLink: shouldShowGeminiApiKeyLink,
    websiteUrl: geminiWebsiteUrl,
    isPartner: isGeminiPartner,
    partnerPromotionKey: geminiPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "gemini",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  const {
    shouldShowApiKeyLink: shouldShowOpencodeApiKeyLink,
    websiteUrl: opencodeWebsiteUrl,
    isPartner: isOpencodePartner,
    partnerPromotionKey: opencodePartnerPromotionKey,
  } = useApiKeyLink({
    appId: "opencode",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  // 使用 API Key 链接 hook (OpenClaw)
  const {
    shouldShowApiKeyLink: shouldShowOpenclawApiKeyLink,
    websiteUrl: openclawWebsiteUrl,
    isPartner: isOpenclawPartner,
    partnerPromotionKey: openclawPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "openclaw",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  const {
    shouldShowApiKeyLink: shouldShowQwenApiKeyLink,
    websiteUrl: qwenWebsiteUrl,
    isPartner: isQwenPartner,
    partnerPromotionKey: qwenPartnerPromotionKey,
  } = useApiKeyLink({
    appId: "qwen",
    category,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  // 使用端点测速候选 hook
  const speedTestEndpoints = useSpeedTestEndpoints({
    appId,
    selectedPresetId,
    presetEntries,
    baseUrl,
    codexBaseUrl,
    initialData,
  });

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);
    if (value === "custom") {
      setActivePreset(null);
      form.reset(defaultValues);

      if (appId === "codex") {
        const template = getCodexCustomTemplate();
        resetCodexConfig(template.auth, template.config);
      }
      if (appId === "gemini") {
        resetGeminiConfig({}, {});
      }
      if (appId === "opencode") {
        opencodeForm.resetOpencodeState();
        omoDraft.resetOmoDraftState();
      }
      // OpenClaw 自定义模式：重置为空配置
      if (appId === "openclaw") {
        openclawForm.resetOpenclawState();
      }
      // Qwen 自定义模式：重置为默认配置
      if (appId === "qwen") {
        setQwenSelectedType("openai");
        setQwenModelName("qwen3-coder-plus");
        setQwenEnvVars({ DASHSCOPE_API_KEY: "" });
        setQwenModelProviders(
          JSON.stringify(
            {
              openai: [
                {
                  id: "qwen3-coder-plus",
                  name: "qwen3-coder-plus",
                  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                  envKey: "DASHSCOPE_API_KEY",
                },
              ],
            },
            null,
            2,
          ),
        );
        setQwenDeprecatedApiKey("");
        setQwenDeprecatedBaseUrl("");
      }
      // Cline 自定义模式：重置为默认配置
      if (appId === "cline") {
        setClineConfig({
          authProtocol: "anthropic",
          openAiBaseUrl: "",
          planModeOpenAiModelId: "",
          actModeOpenAiModelId: "",
          openAiApiKey: "",
          anthropicBaseUrl: "",
          planModeApiModelId: "",
          actModeApiModelId: "",
          apiKey: "",
        });
      }
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) {
      return;
    }

    setActivePreset({
      id: value,
      category: entry.preset.category,
      isPartner: entry.preset.isPartner,
      partnerPromotionKey: entry.preset.partnerPromotionKey,
      ...(appId === "qwen" && "qwenPresetType" in entry.preset
        ? {
            qwenPresetType: (entry.preset as QwenProviderPreset).qwenPresetType,
          }
        : {}),
    });

    if (appId === "codex") {
      const preset = entry.preset as CodexProviderPreset;
      const auth = preset.auth ?? {};
      const config = preset.config ?? "";

      resetCodexConfig(auth, config);

      form.reset({
        name: preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify({ auth, config }, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "gemini") {
      const preset = entry.preset as GeminiProviderPreset;
      const env = (preset.settingsConfig as any)?.env ?? {};
      const config = (preset.settingsConfig as any)?.config ?? {};

      resetGeminiConfig(env, config);

      form.reset({
        name: preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(preset.settingsConfig, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    if (appId === "opencode") {
      const preset = entry.preset as OpenCodeProviderPreset;
      const config = preset.settingsConfig;

      if (preset.category === "omo" || preset.category === "omo-slim") {
        omoDraft.resetOmoDraftState();
        form.reset({
          name: preset.category === "omo" ? "OMO" : "OMO Slim",
          websiteUrl: preset.websiteUrl ?? "",
          settingsConfig: JSON.stringify({}, null, 2),
          icon: preset.icon ?? "",
          iconColor: preset.iconColor ?? "",
        });
        return;
      }

      opencodeForm.resetOpencodeState(config);

      form.reset({
        name: preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    // OpenClaw preset handling
    if (appId === "openclaw") {
      const preset = entry.preset as OpenClawProviderPreset;
      const config = preset.settingsConfig;

      // Update activePreset with suggestedDefaults for OpenClaw
      setActivePreset({
        id: value,
        category: preset.category,
        isPartner: preset.isPartner,
        partnerPromotionKey: preset.partnerPromotionKey,
        suggestedDefaults: preset.suggestedDefaults,
        apiBaseUrlMap: preset.apiBaseUrlMap,
      });

      openclawForm.resetOpenclawState(config);

      // Update form fields
      form.reset({
        name: preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    // Qwen preset handling
    if (appId === "qwen") {
      const preset = entry.preset as QwenProviderPreset;
      const config = preset.settingsConfig as any;

      // 更新 Qwen 状态
      setQwenSelectedType(config?.security?.auth?.selectedType || "openai");
      setQwenModelName(config?.model?.name || "qwen3-coder-plus");
      setQwenEnvVars(config?.env || {});
      setQwenModelProviders(
        JSON.stringify(config?.modelProviders || {}, null, 2),
      );
      setQwenDeprecatedApiKey(config?.security?.auth?.apiKey || "");
      setQwenDeprecatedBaseUrl(config?.security?.auth?.baseUrl || "");

      form.reset({
        name: preset.name,
        websiteUrl: preset.websiteUrl ?? "",
        settingsConfig: JSON.stringify(config, null, 2),
        icon: preset.icon ?? "",
        iconColor: preset.iconColor ?? "",
      });
      return;
    }

    const preset = entry.preset as ProviderPreset;
    const config = applyTemplateValues(
      preset.settingsConfig,
      preset.templateValues,
    );

    if (preset.apiFormat) {
      setLocalApiFormat(preset.apiFormat);
    } else {
      setLocalApiFormat("anthropic");
    }
    if (preset.lockApiFormat) {
      setLocalApiFormat("anthropic");
    }
    setActivePreset((prev) =>
      prev
        ? {
            ...prev,
            bailianRegionUrls: preset.bailianRegionUrls,
            lockApiFormat: preset.lockApiFormat,
          }
        : null,
    );

    form.reset({
      name: preset.name,
      websiteUrl: preset.websiteUrl ?? "",
      settingsConfig: JSON.stringify(config, null, 2),
      icon: preset.icon ?? "",
      iconColor: preset.iconColor ?? "",
    });
  };

  const settingsConfigErrorField = (
    <FormField
      control={form.control}
      name="settingsConfig"
      render={() => (
        <FormItem className="space-y-0">
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6 glass rounded-xl p-6 border border-white/10"
      >
        {!initialData && !hidePresetSelector && (
          <ProviderPresetSelector
            selectedPresetId={selectedPresetId}
            groupedPresets={groupedPresets}
            categoryKeys={categoryKeys}
            onPresetChange={handlePresetChange}
            onUniversalPresetSelect={onUniversalPresetSelect}
            onManageUniversalProviders={onManageUniversalProviders}
            category={category}
          />
        )}

        <BasicFormFields
          form={form}
          beforeNameSlot={
            appId === "opencode" && !isAnyOmoCategory ? (
              <div className="space-y-2">
                <Label htmlFor="opencode-key">
                  {t("opencode.providerKey")}
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  id="opencode-key"
                  value={opencodeForm.opencodeProviderKey}
                  onCompositionStart={() => { isOpencodeKeyComposing.current = true; }}
                  onCompositionEnd={(e) => {
                    isOpencodeKeyComposing.current = false;
                    opencodeForm.setOpencodeProviderKey(
                      (e.target as HTMLInputElement).value.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, ""),
                    );
                  }}
                  onChange={(e) => {
                    if (isOpencodeKeyComposing.current) return;
                    opencodeForm.setOpencodeProviderKey(
                      e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                    );
                  }}
                  placeholder={t("opencode.providerKeyPlaceholder")}
                  disabled={isEditMode}
                  inputMode="text"
                  lang="en"
                  autoComplete="off"
                  className={
                    (existingOpencodeKeys.includes(
                      opencodeForm.opencodeProviderKey,
                    ) &&
                      !isEditMode) ||
                    (opencodeForm.opencodeProviderKey.trim() !== "" &&
                      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        opencodeForm.opencodeProviderKey,
                      ))
                      ? "border-destructive"
                      : ""
                  }
                />
                {existingOpencodeKeys.includes(
                  opencodeForm.opencodeProviderKey,
                ) &&
                  !isEditMode && (
                    <p className="text-xs text-destructive">
                      {t("opencode.providerKeyDuplicate")}
                    </p>
                  )}
                {opencodeForm.opencodeProviderKey.trim() !== "" &&
                  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                    opencodeForm.opencodeProviderKey,
                  ) && (
                    <p className="text-xs text-destructive">
                      {t("opencode.providerKeyInvalid")}
                    </p>
                  )}
                {!(
                  existingOpencodeKeys.includes(
                    opencodeForm.opencodeProviderKey,
                  ) && !isEditMode
                ) &&
                  (opencodeForm.opencodeProviderKey.trim() === "" ||
                    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      opencodeForm.opencodeProviderKey,
                    )) && (
                    <p className="text-xs text-text-muted">
                      {t("opencode.providerKeyHint")}
                    </p>
                  )}
              </div>
            ) : appId === "openclaw" ? (
              <div className="space-y-2">
                <Label htmlFor="openclaw-key">
                  {t("openclaw.providerKey")}
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  id="openclaw-key"
                  value={openclawForm.openclawProviderKey}
                  onCompositionStart={() => { isOpenclawKeyComposing.current = true; }}
                  onCompositionEnd={(e) => {
                    isOpenclawKeyComposing.current = false;
                    openclawForm.setOpenclawProviderKey(
                      (e.target as HTMLInputElement).value.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, ""),
                    );
                  }}
                  onChange={(e) => {
                    if (isOpenclawKeyComposing.current) return;
                    openclawForm.setOpenclawProviderKey(
                      e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                    );
                  }}
                  placeholder={t("openclaw.providerKeyPlaceholder")}
                  disabled={isEditMode}
                  inputMode="text"
                  lang="en"
                  autoComplete="off"
                  className={
                    (openclawForm.existingOpenclawKeys.includes(
                      openclawForm.openclawProviderKey,
                    ) &&
                      !isEditMode) ||
                    (openclawForm.openclawProviderKey.trim() !== "" &&
                      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                        openclawForm.openclawProviderKey,
                      ))
                      ? "border-destructive"
                      : ""
                  }
                />
                {openclawForm.existingOpenclawKeys.includes(
                  openclawForm.openclawProviderKey,
                ) &&
                  !isEditMode && (
                    <p className="text-xs text-destructive">
                      {t("openclaw.providerKeyDuplicate")}
                    </p>
                  )}
                {openclawForm.openclawProviderKey.trim() !== "" &&
                  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                    openclawForm.openclawProviderKey,
                  ) && (
                    <p className="text-xs text-destructive">
                      {t("openclaw.providerKeyInvalid")}
                    </p>
                  )}
                {!(
                  openclawForm.existingOpenclawKeys.includes(
                    openclawForm.openclawProviderKey,
                  ) && !isEditMode
                ) &&
                  (openclawForm.openclawProviderKey.trim() === "" ||
                    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(
                      openclawForm.openclawProviderKey,
                    )) && (
                    <p className="text-xs text-text-muted">
                      {t("openclaw.providerKeyHint")}
                    </p>
                  )}
              </div>
            ) : undefined
          }
        />

        {appId === "claude" && (
          <ClaudeFormFields
            providerId={providerId}
            shouldShowApiKey={
              (category !== "cloud_provider" ||
                hasApiKeyField(form.getValues("settingsConfig"), "claude")) &&
              shouldShowApiKey(form.getValues("settingsConfig"), isEditMode)
            }
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            category={category}
            shouldShowApiKeyLink={shouldShowClaudeApiKeyLink}
            websiteUrl={claudeWebsiteUrl}
            isPartner={isClaudePartner}
            partnerPromotionKey={claudePartnerPromotionKey}
            templateValueEntries={templateValueEntries}
            templateValues={templateValues}
            templatePresetName={templatePreset?.name || ""}
            onTemplateValueChange={handleTemplateValueChange}
            shouldShowSpeedTest={shouldShowSpeedTest}
            baseUrl={baseUrl}
            onBaseUrlChange={handleClaudeBaseUrlChange}
            isEndpointModalOpen={isEndpointModalOpen}
            onEndpointModalToggle={setIsEndpointModalOpen}
            onCustomEndpointsChange={
              isEditMode ? undefined : setDraftCustomEndpoints
            }
            autoSelect={endpointAutoSelect}
            onAutoSelectChange={setEndpointAutoSelect}
            shouldShowModelSelector={category !== "official"}
            claudeModel={claudeModel}
            reasoningModel={reasoningModel}
            defaultHaikuModel={defaultHaikuModel}
            defaultSonnetModel={defaultSonnetModel}
            defaultOpusModel={defaultOpusModel}
            onModelChange={handleModelChange}
            speedTestEndpoints={speedTestEndpoints}
            apiFormat={localApiFormat}
            onApiFormatChange={handleApiFormatChange}
            bailianRegionUrls={activePreset?.bailianRegionUrls}
            lockApiFormat={activePreset?.lockApiFormat ?? false}
            modelOptions={
              activePreset?.bailianRegionUrls
                ? [...BAILIAN_DEFAULT_MODEL_IDS]
                : undefined
            }
            reasoningModelOptions={
              activePreset?.bailianRegionUrls
                ? [...BAILIAN_DEFAULT_MODEL_IDS]
                : undefined
            }
            mainModelSupportsThinking={
              activePreset?.bailianRegionUrls
                ? bailianModelSupportsThinking(claudeModel)
                : false
            }
          />
        )}

        {appId === "codex" && (
          <CodexFormFields
            providerId={providerId}
            codexApiKey={codexApiKey}
            onApiKeyChange={handleCodexApiKeyChange}
            category={category}
            shouldShowApiKeyLink={shouldShowCodexApiKeyLink}
            websiteUrl={codexWebsiteUrl}
            isPartner={isCodexPartner}
            partnerPromotionKey={codexPartnerPromotionKey}
            shouldShowSpeedTest={shouldShowSpeedTest}
            codexBaseUrl={codexBaseUrl}
            onBaseUrlChange={handleCodexBaseUrlChange}
            isEndpointModalOpen={isCodexEndpointModalOpen}
            onEndpointModalToggle={setIsCodexEndpointModalOpen}
            onCustomEndpointsChange={
              isEditMode ? undefined : setDraftCustomEndpoints
            }
            autoSelect={endpointAutoSelect}
            onAutoSelectChange={setEndpointAutoSelect}
            shouldShowModelField={category !== "official"}
            modelName={codexModelName}
            onModelNameChange={handleCodexModelNameChange}
            speedTestEndpoints={speedTestEndpoints}
          />
        )}

        {appId === "gemini" && (
          <GeminiFormFields
            providerId={providerId}
            shouldShowApiKey={shouldShowApiKey(
              form.getValues("settingsConfig"),
              isEditMode,
            )}
            apiKey={geminiApiKey}
            onApiKeyChange={handleGeminiApiKeyChange}
            category={category}
            shouldShowApiKeyLink={shouldShowGeminiApiKeyLink}
            websiteUrl={geminiWebsiteUrl}
            isPartner={isGeminiPartner}
            partnerPromotionKey={geminiPartnerPromotionKey}
            shouldShowSpeedTest={shouldShowSpeedTest}
            baseUrl={geminiBaseUrl}
            onBaseUrlChange={handleGeminiBaseUrlChange}
            isEndpointModalOpen={isEndpointModalOpen}
            onEndpointModalToggle={setIsEndpointModalOpen}
            onCustomEndpointsChange={setDraftCustomEndpoints}
            autoSelect={endpointAutoSelect}
            onAutoSelectChange={setEndpointAutoSelect}
            shouldShowModelField={true}
            model={geminiModel}
            onModelChange={handleGeminiModelChange}
            speedTestEndpoints={speedTestEndpoints}
          />
        )}

        {appId === "opencode" && !isAnyOmoCategory && (
          <OpenCodeFormFields
            npm={opencodeForm.opencodeNpm}
            onNpmChange={opencodeForm.handleOpencodeNpmChange}
            apiKey={opencodeForm.opencodeApiKey}
            onApiKeyChange={opencodeForm.handleOpencodeApiKeyChange}
            category={category}
            shouldShowApiKeyLink={shouldShowOpencodeApiKeyLink}
            websiteUrl={opencodeWebsiteUrl}
            isPartner={isOpencodePartner}
            partnerPromotionKey={opencodePartnerPromotionKey}
            baseUrl={opencodeForm.opencodeBaseUrl}
            onBaseUrlChange={opencodeForm.handleOpencodeBaseUrlChange}
            models={opencodeForm.opencodeModels}
            onModelsChange={opencodeForm.handleOpencodeModelsChange}
            extraOptions={opencodeForm.opencodeExtraOptions}
            onExtraOptionsChange={opencodeForm.handleOpencodeExtraOptionsChange}
            allowedNpmPackages={
              selectedPresetId
                ? (presetEntries.find((e) => e.id === selectedPresetId)
                    ?.preset as OpenCodeProviderPreset | undefined)
                    ?.allowedNpmPackages
                : undefined
            }
          />
        )}

        {appId === "opencode" &&
          (category === "omo" || category === "omo-slim") && (
            <OmoFormFields
              modelOptions={omoModelOptions}
              modelVariantsMap={omoModelVariantsMap}
              presetMetaMap={omoPresetMetaMap}
              agents={omoDraft.omoAgents}
              onAgentsChange={omoDraft.setOmoAgents}
              categories={
                category === "omo" ? omoDraft.omoCategories : undefined
              }
              onCategoriesChange={
                category === "omo" ? omoDraft.setOmoCategories : undefined
              }
              otherFieldsStr={omoDraft.omoOtherFieldsStr}
              onOtherFieldsStrChange={omoDraft.setOmoOtherFieldsStr}
              isSlim={category === "omo-slim"}
            />
          )}

        {/* OpenClaw 专属字段 */}
        {appId === "openclaw" && (
          <OpenClawFormFields
            baseUrl={openclawForm.openclawBaseUrl}
            onBaseUrlChange={openclawForm.handleOpenclawBaseUrlChange}
            apiKey={openclawForm.openclawApiKey}
            onApiKeyChange={openclawForm.handleOpenclawApiKeyChange}
            category={category}
            shouldShowApiKeyLink={shouldShowOpenclawApiKeyLink}
            websiteUrl={openclawWebsiteUrl}
            isPartner={isOpenclawPartner}
            partnerPromotionKey={openclawPartnerPromotionKey}
            api={openclawForm.openclawApi}
            onApiChange={openclawForm.handleOpenclawApiChange}
            models={openclawForm.openclawModels}
            onModelsChange={openclawForm.handleOpenclawModelsChange}
          />
        )}

        {/* Qwen 专属字段 */}
        {appId === "qwen" && (
          <QwenFormFields
            providerId={providerId}
            category={category}
            qwenPresetType={
              appId === "qwen"
                ? (activePreset?.qwenPresetType ??
                  qwenPresetTypeFromInitialData)
                : undefined
            }
            shouldShowApiKeyLink={shouldShowQwenApiKeyLink}
            websiteUrl={qwenWebsiteUrl}
            isPartner={isQwenPartner}
            partnerPromotionKey={qwenPartnerPromotionKey}
            selectedType={qwenSelectedType}
            onSelectedTypeChange={setQwenSelectedType}
            modelName={qwenModelName}
            onModelNameChange={setQwenModelName}
            envVars={qwenEnvVars}
            onEnvVarsChange={setQwenEnvVars}
            modelProviders={qwenModelProviders}
            onModelProvidersChange={setQwenModelProviders}
            deprecatedApiKey={qwenDeprecatedApiKey}
            onDeprecatedApiKeyChange={setQwenDeprecatedApiKey}
            deprecatedBaseUrl={qwenDeprecatedBaseUrl}
            onDeprecatedBaseUrlChange={setQwenDeprecatedBaseUrl}
            onConfigSynced={(config) => {
              // 统一入口：同步后同时更新 form 与 Qwen 本地状态，避免分叉
              const settingsConfig = JSON.stringify(config, null, 2);
              form.setValue("settingsConfig", settingsConfig);
              const auth = (
                config?.security as Record<string, unknown> | undefined
              )?.auth as Record<string, unknown> | undefined;
              const model = config?.model as
                | Record<string, unknown>
                | undefined;
              setQwenSelectedType((auth?.selectedType as string) || "openai");
              setQwenModelName((model?.name as string) ?? "qwen3-coder-plus");
              setQwenEnvVars((config?.env as Record<string, string>) || {});
              setQwenModelProviders(
                JSON.stringify(
                  (config?.modelProviders as Record<string, unknown>) || {},
                  null,
                  2,
                ),
              );
              setQwenDeprecatedApiKey((auth?.apiKey as string) || "");
              setQwenDeprecatedBaseUrl((auth?.baseUrl as string) || "");
            }}
          />
        )}

        {/* Cline 专属字段 */}
        {appId === "cline" && (
          <ClineFormFields
            providerId={providerId}
            category={category}
            shouldShowApiKeyLink={false} // Cline 暂不支持 API Key 链接
            websiteUrl=""
            isPartner={false}
            partnerPromotionKey=""
            authProtocol={clineConfig.authProtocol}
            onAuthProtocolChange={(protocol) =>
              setClineConfig((prev) => ({
                ...prev,
                authProtocol: protocol,
              }))
            }
            openAiApiKey={clineConfig.openAiApiKey}
            onOpenAiApiKeyChange={(key) =>
              setClineConfig((prev) => ({ ...prev, openAiApiKey: key }))
            }
            openAiBaseUrl={clineConfig.openAiBaseUrl}
            onOpenAiBaseUrlChange={(url) =>
              setClineConfig((prev) => ({ ...prev, openAiBaseUrl: url }))
            }
            planModeOpenAiModelId={clineConfig.planModeOpenAiModelId}
            onPlanModeOpenAiModelIdChange={(model) =>
              setClineConfig((prev) => ({
                ...prev,
                planModeOpenAiModelId: model,
              }))
            }
            actModeOpenAiModelId={clineConfig.actModeOpenAiModelId}
            onActModeOpenAiModelIdChange={(model) =>
              setClineConfig((prev) => ({
                ...prev,
                actModeOpenAiModelId: model,
              }))
            }
            apiKey={clineConfig.apiKey}
            onApiKeyChange={(key) =>
              setClineConfig((prev) => ({ ...prev, apiKey: key }))
            }
            anthropicBaseUrl={clineConfig.anthropicBaseUrl}
            onAnthropicBaseUrlChange={(url) =>
              setClineConfig((prev) => ({ ...prev, anthropicBaseUrl: url }))
            }
            planModeApiModelId={clineConfig.planModeApiModelId}
            onPlanModeApiModelIdChange={(model) =>
              setClineConfig((prev) => ({ ...prev, planModeApiModelId: model }))
            }
            actModeApiModelId={clineConfig.actModeApiModelId}
            onActModeApiModelIdChange={(model) =>
              setClineConfig((prev) => ({ ...prev, actModeApiModelId: model }))
            }
          />
        )}

        {/* 配置编辑器：Codex、Claude、Gemini 分别使用不同的编辑器，Qwen、Cline 使用结构化表单不显示配置JSON */}
        {appId === "codex" ? (
          <>
            <CodexConfigEditor
              authValue={codexAuth}
              configValue={codexConfig}
              onAuthChange={setCodexAuth}
              onConfigChange={handleCodexConfigChange}
              useCommonConfig={useCodexCommonConfigFlag}
              onCommonConfigToggle={handleCodexCommonConfigToggle}
              commonConfigSnippet={codexCommonConfigSnippet}
              onCommonConfigSnippetChange={handleCodexCommonConfigSnippetChange}
              commonConfigError={codexCommonConfigError}
              authError={codexAuthError}
              configError={codexConfigError}
              onExtract={handleCodexExtract}
              isExtracting={isCodexExtracting}
            />
            {settingsConfigErrorField}
          </>
        ) : appId === "gemini" ? (
          <>
            <GeminiConfigEditor
              envValue={geminiEnv}
              configValue={geminiConfig}
              onEnvChange={handleGeminiEnvChange}
              onConfigChange={handleGeminiConfigChange}
              useCommonConfig={useGeminiCommonConfigFlag}
              onCommonConfigToggle={handleGeminiCommonConfigToggle}
              commonConfigSnippet={geminiCommonConfigSnippet}
              onCommonConfigSnippetChange={
                handleGeminiCommonConfigSnippetChange
              }
              commonConfigError={geminiCommonConfigError}
              envError={envError}
              configError={geminiConfigError}
              onExtract={handleGeminiExtract}
              isExtracting={isGeminiExtracting}
            />
            {settingsConfigErrorField}
          </>
        ) : appId === "opencode" &&
          (category === "omo" || category === "omo-slim") ? (
          <div className="space-y-2">
            <Label>{t("provider.configJson")}</Label>
            <JsonEditor
              value={omoDraft.mergedOmoJsonPreview}
              onChange={() => {}}
              rows={14}
              showValidation={false}
              language="json"
            />
          </div>
        ) : appId === "opencode" &&
          category !== "omo" &&
          category !== "omo-slim" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="settingsConfig">{t("provider.configJson")}</Label>
              <JsonEditor
                value={form.getValues("settingsConfig")}
                onChange={(config) => form.setValue("settingsConfig", config)}
                placeholder={`{
  "npm": "@ai-sdk/openai-compatible",
  "options": {
    "baseURL": "https://your-api-endpoint.com",
    "apiKey": "your-api-key-here"
  },
  "models": {}
}`}
                rows={14}
                showValidation={true}
                language="json"
              />
            </div>
            {settingsConfigErrorField}
          </>
        ) : appId === "openclaw" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="settingsConfig">{t("provider.configJson")}</Label>
              <JsonEditor
                value={form.getValues("settingsConfig")}
                onChange={(config) => form.setValue("settingsConfig", config)}
                placeholder={`{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "your-api-key-here",
  "api": "openai-completions",
  "models": []
}`}
                rows={14}
                showValidation={true}
                language="json"
              />
            </div>
            <FormField
              control={form.control}
              name="settingsConfig"
              render={() => (
                <FormItem className="space-y-0">
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        ) : appId === "qwen" || appId === "cline" ? (
          // Qwen 和 Cline 不显示配置JSON字段，使用结构化表单代替
          <div className="hidden">
            <FormField
              control={form.control}
              name="settingsConfig"
              render={() => (
                <FormItem className="space-y-0">
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ) : (
          <>
            <CommonConfigEditor
              value={form.getValues("settingsConfig")}
              onChange={(value) => form.setValue("settingsConfig", value)}
              useCommonConfig={useCommonConfig}
              onCommonConfigToggle={handleCommonConfigToggle}
              commonConfigSnippet={commonConfigSnippet}
              onCommonConfigSnippetChange={handleCommonConfigSnippetChange}
              commonConfigError={commonConfigError}
              onEditClick={() => setIsCommonConfigModalOpen(true)}
              isModalOpen={isCommonConfigModalOpen}
              onModalClose={() => setIsCommonConfigModalOpen(false)}
              onExtract={handleClaudeExtract}
              isExtracting={isClaudeExtracting}
            />
            {settingsConfigErrorField}
          </>
        )}

        {!isAnyOmoCategory && appId !== "opencode" && appId !== "openclaw" && (
          <ProviderAdvancedConfig
            testConfig={testConfig}
            proxyConfig={proxyConfig}
            pricingConfig={pricingConfig}
            onTestConfigChange={setTestConfig}
            onProxyConfigChange={setProxyConfig}
            onPricingConfigChange={setPricingConfig}
          />
        )}

        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        )}
      </form>
    </Form>
  );
}

export type ProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  isPartner?: boolean;
  meta?: ProviderMeta;
  providerKey?: string; // OpenCode/OpenClaw: user-defined provider key
  suggestedDefaults?: OpenClawSuggestedDefaults; // OpenClaw: suggested default model configuration
};
