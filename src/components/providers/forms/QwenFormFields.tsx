import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Plus,
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
  RefreshCw,
  X,
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import JsonEditor from "@/components/JsonEditor";
import { providersApi } from "@/lib/api";
import type { ProviderCategory } from "@/types";
import type { QwenPresetType } from "@/config/qwenProviderPresets";
import { getNamePrefix as getBailianNamePrefix } from "@/config/qwenProviderPresets";
import {
  BAILIAN_REGION_URLS,
  BAILIAN_DEFAULT_MODEL_IDS,
} from "@/config/bailianShared";

interface QwenFormFieldsProps {
  providerId?: string;
  category?: ProviderCategory;
  /** 百炼预设类型：用于显示区域下拉（coding_plan = 国内/国际，general = 国内/新加坡/弗吉尼亚） */
  qwenPresetType?: QwenPresetType;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // 结构化字段的值和变更回调
  selectedType: string;
  onSelectedTypeChange: (type: string) => void;
  modelName: string;
  onModelNameChange: (name: string) => void;
  envVars: Record<string, string>;
  onEnvVarsChange: (vars: Record<string, string>) => void;
  modelProviders: string; // JSON 字符串
  onModelProvidersChange: (json: string) => void;

  // 兼容旧版字段（deprecated）
  deprecatedApiKey: string;
  onDeprecatedApiKeyChange: (key: string) => void;
  deprecatedBaseUrl: string;
  onDeprecatedBaseUrlChange: (url: string) => void;

  // 配置同步回调（用于同步后更新表单）
  onConfigSynced?: (config: Record<string, unknown>) => void;
}

// 百炼预设支持的认证协议（仅 OpenAI 和 Anthropic）
const BAILIAN_AUTH_TYPES = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
];

// 自定义配置支持的认证协议（包含 Gemini 和 Vertex AI）
const CUSTOM_AUTH_TYPES = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
  { value: "vertex-ai", label: "Vertex AI" },
];

// 默认模型名称下拉中“手动输入”选项的特殊 value，仅用于 UI，不写入配置
const CUSTOM_MODEL_VALUE = "__custom__";

// 认证协议到 modelProviders 类型的映射
const AUTH_TO_PROVIDER_TYPE: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  "vertex-ai": "vertex-ai",
};

// Base URL placeholder 映射（根据协议类型显示不同的示例）
const BASE_URL_PLACEHOLDERS: Record<string, string> = {
  openai: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  anthropic: "https://dashscope.aliyuncs.com/apps/anthropic",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  "vertex-ai": "https://us-central1-aiplatform.googleapis.com/v1",
};

// API Key placeholder 映射（根据协议类型显示不同的示例）
const API_KEY_PLACEHOLDERS: Record<string, string> = {
  openai: "DASHSCOPE_API_KEY",
  anthropic: "DASHSCOPE_API_KEY",
  gemini: "GEMINI_API_KEY",
  "vertex-ai": "VERTEX_AI_API_KEY",
};

// API Key 值的 placeholder 映射（根据协议类型显示不同的示例）
const API_KEY_VALUE_PLACEHOLDERS: Record<string, string> = {
  openai: "sk-xxxxxxxxxxxxxxxxxx",
  anthropic: "sk-ant-xxx",
  gemini: "AIzaSyxxxxxxxxxxxxxxxxxx",
  "vertex-ai": "ya29.xxxxxxxxxxxxxxxxxx",
};

// Base URL 预设选项（按协议类型分组）- 用于非百炼预设时的快速选择
const BASE_URL_PRESETS: Record<
  string,
  Array<{ label: string; value: string }>
> = {
  openai: [
    {
      label: "百炼（国内）",
      value: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
      label: "Coding Plan（国内）",
      value: "https://coding.dashscope.aliyuncs.com/v1",
    },
    {
      label: "Coding Plan（国际）",
      value: "https://coding-intl.dashscope.aliyuncs.com/v1",
    },
    {
      label: "百炼（新加坡）",
      value: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    },
    {
      label: "百炼（弗吉尼亚）",
      value: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    },
  ],
  anthropic: [
    {
      label: "Coding Plan（国内）",
      value: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    },
    {
      label: "Coding Plan（国际）",
      value: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    },
    {
      label: "百炼（国内）",
      value: "https://dashscope.aliyuncs.com/apps/anthropic",
    },
    {
      label: "百炼（新加坡）",
      value: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    },
    {
      label: "百炼（弗吉尼亚）",
      value: "https://dashscope-us.aliyuncs.com/apps/anthropic",
    },
  ],
  gemini: [
    {
      label: "Google AI",
      value: "https://generativelanguage.googleapis.com/v1beta",
    },
    { label: "Vertex AI", value: "https://vertex-ai.googleapis.com/v1" },
  ],
  "vertex-ai": [
    { label: "Vertex AI", value: "https://vertex-ai.googleapis.com/v1" },
  ],
};

export function QwenFormFields({
  providerId,
  category: _category,
  qwenPresetType,
  shouldShowApiKeyLink: _shouldShowApiKeyLink,
  websiteUrl: _websiteUrl,
  isPartner: _isPartner,
  partnerPromotionKey: _partnerPromotionKey,
  selectedType,
  onSelectedTypeChange,
  modelName,
  onModelNameChange,
  envVars,
  onEnvVarsChange,
  modelProviders,
  onModelProvidersChange,
  deprecatedApiKey,
  onDeprecatedApiKeyChange,
  deprecatedBaseUrl,
  onDeprecatedBaseUrlChange,
  onConfigSynced,
}: QwenFormFieldsProps) {
  const { t } = useTranslation();

  // 配置不一致状态
  const [isInconsistent, setIsInconsistent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 测试链接状态
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  // 测试结果内联展示：null=未测试，ok=成功，error=失败
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 防抖：记录上次测试时间，防止短时间内重复点击
  const lastTestTimeRef = useRef<number>(0);
  
  // 追踪表单是否被修改过（编辑模式保护）
  const [hasFormChanged, setHasFormChanged] = useState(false);

  // 标记刚刚完成同步，跳过同步后由 props 变化触发的下一次一致性检查
  const justSyncedRef = useRef(false);

  // 兼容旧版字段的折叠状态（有值时自动展开）
  const [isDeprecatedOpen, setIsDeprecatedOpen] = useState(
    Boolean(deprecatedApiKey || deprecatedBaseUrl),
  );

  // 高级配置区块折叠状态（Base URL / JSON 编辑器 / 废弃配置）
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  // Base URL 子区块折叠状态（在高级配置内，默认展开）
  const [isBaseUrlOpen, setIsBaseUrlOpen] = useState(true);

  // 密码可见性状态管理
  const [passwordVisibility, setPasswordVisibility] = useState<
    Record<string, boolean>
  >({});

  // 默认模型名称：是否处于“手动输入”模式（选择“自定义...”或当前值不在列表时为 true）
  const [isCustomModel, setIsCustomModel] = useState(false);

  const togglePasswordVisibility = useCallback((key: string) => {
    setPasswordVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  // 获取 namePrefix 的辅助函数（处理 qwenPresetType 可能为 undefined 的情况）
  // 非百炼预设（自定义或映射预设）时返回空，避免切换为 Anthropic 等协议时仍显示 "Bailian Coding Plan"
  const getNamePrefix = useCallback((type: QwenPresetType | undefined): string => {
    if (!type) return "";
    return getBailianNamePrefix(type);
  }, []);

  // Base URL 状态管理
  const [baseUrl, setBaseUrl] = useState("");

  // 包装所有字段变更函数，标记表单已修改
  const markFormAsChanged = useCallback(() => {
    setHasFormChanged(true);
  }, []);

  const wrappedOnSelectedTypeChange = useCallback(
    (type: string) => {
      markFormAsChanged();
      onSelectedTypeChange(type);
      
      // 如果是自定义配置且切换到 gemini/vertex-ai，清空相关字段
      const providerType = AUTH_TO_PROVIDER_TYPE[type] || type;
      if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
        // 清空 Base URL
        setBaseUrl("");
        
        // 清空模型名称
        onModelNameChange("");
        
        // 清空 modelProviders（只保留当前协议的空数组）
        const emptyProviders = {
          [providerType]: []
        };
        onModelProvidersChange(JSON.stringify(emptyProviders, null, 2));
        
        // 清空 env（但保留一个示例 key）
        const providerEnvKey = providerType === "gemini" ? "GEMINI_API_KEY" : "VERTEX_AI_API_KEY";
        onEnvVarsChange({ [providerEnvKey]: "" });
      }
    },
    [markFormAsChanged, onSelectedTypeChange, qwenPresetType, onModelNameChange, onModelProvidersChange, onEnvVarsChange],
  );

  const wrappedOnModelNameChange = useCallback(
    (name: string) => {
      markFormAsChanged();
      onModelNameChange(name);
    },
    [markFormAsChanged, onModelNameChange],
  );

  const wrappedOnEnvVarsChange = useCallback(
    (vars: Record<string, string>) => {
      markFormAsChanged();
      setTestResult(null); // 内容变化时清除测试结果
      onEnvVarsChange(vars);
    },
    [markFormAsChanged, onEnvVarsChange],
  );

  const wrappedOnModelProvidersChange = useCallback(
    (json: string) => {
      markFormAsChanged();
      onModelProvidersChange(json);
    },
    [markFormAsChanged, onModelProvidersChange],
  );

  const wrappedOnDeprecatedApiKeyChange = useCallback(
    (key: string) => {
      markFormAsChanged();
      onDeprecatedApiKeyChange(key);
    },
    [markFormAsChanged, onDeprecatedApiKeyChange],
  );

  const wrappedOnDeprecatedBaseUrlChange = useCallback(
    (url: string) => {
      markFormAsChanged();
      onDeprecatedBaseUrlChange(url);
    },
    [markFormAsChanged, onDeprecatedBaseUrlChange],
  );

  // 获取协议对应的默认 Base URL（根据百炼预设类型）
  const getDefaultBaseUrlForProtocol = useCallback((authType: string): string => {
    const providerType = AUTH_TO_PROVIDER_TYPE[authType] || authType;
    
    // 根据百炼预设类型返回对应的默认 Base URL
    if (qwenPresetType && BAILIAN_REGION_URLS[qwenPresetType]) {
      // 优先使用国内区域的 URL 作为默认值
      const defaultRegion = qwenPresetType === "coding_plan" ? "国内" : "国内";
      const regionUrls = BAILIAN_REGION_URLS[qwenPresetType][defaultRegion];
      
      if (regionUrls) {
        switch (providerType) {
          case "openai":
            return regionUrls.openai;
          case "anthropic":
            return regionUrls.anthropic;
        }
      }
    }
    
    // 非百炼预设（自定义/映射预设）时使用通用 URL，不再用 Coding Plan 的地址
    if (!qwenPresetType) {
      if (providerType !== "openai" && providerType !== "anthropic" && providerType !== "gemini" && providerType !== "vertex-ai") {
        return "";
      }
      switch (providerType) {
        case "openai":
          return "https://api.openai.com/v1";
        case "anthropic":
          return "https://api.anthropic.com";
        case "gemini":
          return "https://generativelanguage.googleapis.com/v1beta";
        case "vertex-ai":
          return "https://us-central1-aiplatform.googleapis.com/v1";
        default:
          return "https://api.example.com/v1";
      }
    }

    // 百炼预设：回退到 Coding Plan 的默认 URL
    switch (providerType) {
      case "openai":
        return "https://coding.dashscope.aliyuncs.com/v1";
      case "anthropic":
        return "https://coding.dashscope.aliyuncs.com/apps/anthropic";
      case "gemini":
        return "https://generativelanguage.googleapis.com/v1beta";
      case "vertex-ai":
        return "https://us-central1-aiplatform.googleapis.com/v1";
      default:
        return "https://api.example.com/v1";
    }
  }, [qwenPresetType]);

  // 非百炼预设时按协议返回通用 envKey，避免显示 BAILIAN_CODING_PLAN_API_KEY
  const getDefaultEnvKeyForProtocol = useCallback((providerType: string): string => {
    if (qwenPresetType) return "BAILIAN_CODING_PLAN_API_KEY";
    switch (providerType) {
      case "openai":
        return "OPENAI_API_KEY";
      case "anthropic":
        return "ANTHROPIC_API_KEY";
      case "gemini":
        return "GEMINI_API_KEY";
      case "vertex-ai":
        return "VERTEX_AI_API_KEY";
      default:
        return "API_KEY";
    }
  }, [qwenPresetType]);

  // 从 modelProviders JSON 中提取当前认证协议对应的 Base URL
  const extractBaseUrlFromModelProviders = useCallback(
    (jsonStr: string, authType: string, modelName: string): string => {
      try {
        const modelProviders = JSON.parse(jsonStr || "{}");
        const providerType = AUTH_TO_PROVIDER_TYPE[authType] || "openai";
        const providers = modelProviders[providerType];

        // 如果没有配置或配置为空，返回默认 Base URL
        if (!providers || !Array.isArray(providers) || providers.length === 0) {
          return getDefaultBaseUrlForProtocol(authType);
        }

        // 对于 openai 协议，直接返回第一个 provider 的 baseUrl（因为所有 openai provider 的 baseUrl 应该一致）
        if (providerType === "openai") {
          return providers[0]?.baseUrl || getDefaultBaseUrlForProtocol(authType);
        }

        // 其他协议：优先匹配 modelName
        if (modelName) {
          const matchedProvider = providers.find(
            (p: any) => p.id === modelName || p.name === modelName,
          );
          if (matchedProvider?.baseUrl) {
            return matchedProvider.baseUrl;
          }
        }

        // 回退到第一个 provider 的 baseUrl，如果还是空则返回默认值
        return providers[0]?.baseUrl || getDefaultBaseUrlForProtocol(authType);
      } catch {
        // 解析失败时返回默认 Base URL
        return getDefaultBaseUrlForProtocol(authType);
      }
    },
    [getDefaultBaseUrlForProtocol],
  );

  // 将 Base URL 应用到 modelProviders JSON 中
  const applyBaseUrlToModelProviders = useCallback(
    (
      jsonStr: string,
      authType: string,
      newBaseUrl: string,
      modelName: string,
    ): string => {
      try {
        const modelProviders = JSON.parse(jsonStr || "{}");
        const providerType = AUTH_TO_PROVIDER_TYPE[authType] || "openai";

        if (
          !modelProviders[providerType] ||
          !Array.isArray(modelProviders[providerType])
        ) {
          // 如果该协议类型不存在，创建它
          modelProviders[providerType] = [];
        }

        const providers = modelProviders[providerType];

        // 对于 openai 协议，更新该数组下的所有 provider
        if (providerType === "openai" && providers.length > 0) {
          for (const provider of providers) {
            provider.baseUrl = newBaseUrl;
          }
        } else if (modelName && providers.length > 0) {
          // 其他协议：更新匹配 modelName 的 provider
          let found = false;
          for (const provider of providers) {
            if (provider.id === modelName || provider.name === modelName) {
              provider.baseUrl = newBaseUrl;
              found = true;
              break;
            }
          }

          // 如果没找到匹配的，更新第一个
          if (!found && providers[0]) {
            providers[0].baseUrl = newBaseUrl;
          }
        } else if (providers.length > 0) {
          // 没有 modelName，更新第一个
          providers[0].baseUrl = newBaseUrl;
        }

        return JSON.stringify(modelProviders, null, 2);
      } catch {
        return jsonStr;
      }
    },
    [],
  );

  // 按区域批量更新 openai + anthropic 的 Base URL（百炼预设使用）
  const applyRegionToModelProviders = useCallback(
    (jsonStr: string, presetType: QwenPresetType, region: string): string => {
      const urls = BAILIAN_REGION_URLS[presetType]?.[region];
      if (!urls) return jsonStr;
      try {
        const modelProviders = JSON.parse(jsonStr || "{}");
        
        // 确保 openai 数组存在并更新所有 provider 的 baseUrl
        if (Array.isArray(modelProviders.openai)) {
          modelProviders.openai.forEach((p: { baseUrl?: string }) => {
            p.baseUrl = urls.openai;
          });
        } else if (modelProviders.openai) {
          // 如果不是数组但存在，创建数组
          modelProviders.openai = [];
        }
        
        // 确保 anthropic 数组存在并更新所有 provider 的 baseUrl
        if (Array.isArray(modelProviders.anthropic)) {
          modelProviders.anthropic.forEach((p: { baseUrl?: string }) => {
            p.baseUrl = urls.anthropic;
          });
        } else if (modelProviders.anthropic) {
          // 如果不是数组但存在，创建数组
          modelProviders.anthropic = [];
        }
        
        return JSON.stringify(modelProviders, null, 2);
      } catch {
        return jsonStr;
      }
    },
    [],
  );

  // 从当前 modelProviders 推断选中的区域（用于区域按钮高亮）
  // 使用当前认证协议对应的 Base URL 参与匹配，避免选 anthropic 时仍按 openai URL 匹配导致高亮错误
  const currentRegion = useMemo(() => {
    if (!qwenPresetType) return "";
    const urls = BAILIAN_REGION_URLS[qwenPresetType];
    if (!urls) return "";
    const currentUrl = extractBaseUrlFromModelProviders(
      modelProviders,
      selectedType,
      modelName,
    );
    const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
    for (const [region, regionUrls] of Object.entries(urls)) {
      const regionUrl =
        providerType === "anthropic"
          ? regionUrls.anthropic
          : regionUrls.openai;
      if (regionUrl === currentUrl) return region;
    }
    return "";
  }, [
    qwenPresetType,
    modelProviders,
    selectedType,
    modelName,
    extractBaseUrlFromModelProviders,
  ]);

  const handleRegionChange = useCallback(
    (region: string) => {
      if (!qwenPresetType || !region) return;
      const updatedJson = applyRegionToModelProviders(
        modelProviders,
        qwenPresetType,
        region,
      );
      wrappedOnModelProvidersChange(updatedJson);
      
      // 区域切换后，立即同步 Base URL 字段以反映当前认证协议的新 URL
      const newBaseUrl = extractBaseUrlFromModelProviders(
        updatedJson,
        selectedType,
        modelName,
      );
      setBaseUrl(newBaseUrl);
    },
    [
      qwenPresetType,
      modelProviders,
      applyRegionToModelProviders,
      wrappedOnModelProvidersChange,
      extractBaseUrlFromModelProviders,
      selectedType,
      modelName,
    ],
  );

  // 当认证协议或 modelProviders 变化时，更新 Base URL 字段
  useEffect(() => {
    const extracted = extractBaseUrlFromModelProviders(
      modelProviders,
      selectedType,
      modelName,
    );
    setBaseUrl(extracted);
  }, [
    modelProviders,
    selectedType,
    modelName,
    extractBaseUrlFromModelProviders,
  ]);

  // Base URL 字段变化时，应用到 modelProviders
  const handleBaseUrlChange = useCallback(
    (newBaseUrl: string) => {
      setBaseUrl(newBaseUrl);
      const updatedJson = applyBaseUrlToModelProviders(
        modelProviders,
        selectedType,
        newBaseUrl,
        modelName,
      );
      wrappedOnModelProvidersChange(updatedJson);
    },
    [
      modelProviders,
      selectedType,
      modelName,
      applyBaseUrlToModelProviders,
      wrappedOnModelProvidersChange,
    ],
  );

  // 从 JSON 重新读取 Base URL
  const handleSyncFromJson = useCallback(() => {
    const extracted = extractBaseUrlFromModelProviders(
      modelProviders,
      selectedType,
      modelName,
    );
    setBaseUrl(extracted);
    toast.success(
      t("qwen.baseUrl.synced", { defaultValue: "已从 JSON 同步 Base URL" }),
    );
  }, [
    modelProviders,
    selectedType,
    modelName,
    extractBaseUrlFromModelProviders,
    t,
  ]);


  // 环境变量键值对管理
  const envEntries = useMemo(() => {
    return Object.entries(envVars);
  }, [envVars]);

  const handleAddEnvVar = useCallback(() => {
    const newKey = `NEW_KEY_${Date.now()}`;
    wrappedOnEnvVarsChange({ ...envVars, [newKey]: "" });
  }, [envVars, wrappedOnEnvVarsChange]);

  const handleUpdateEnvVar = useCallback(
    (oldKey: string, newKey: string, value: string) => {
      const newVars = { ...envVars };
      if (oldKey !== newKey) {
        delete newVars[oldKey];
      }
      newVars[newKey] = value;
      wrappedOnEnvVarsChange(newVars);
    },
    [envVars, wrappedOnEnvVarsChange],
  );

  const handleRemoveEnvVar = useCallback(
    (key: string) => {
      const newVars = { ...envVars };
      delete newVars[key];
      wrappedOnEnvVarsChange(newVars);
    },
    [envVars, wrappedOnEnvVarsChange],
  );

  // 测试链接：验证 Base URL 与 API Key（仅 openai / anthropic）
  const handleTestConnection = useCallback(async () => {
    // 防止重复点击：如果正在测试中，直接返回
    if (isTestingConnection) {
      return;
    }

    // 防抖：如果距离上次测试不到 2 秒，直接返回
    const now = Date.now();
    if (now - lastTestTimeRef.current < 2000) {
      toast.error("请勿频繁测试，请稍后再试");
      return;
    }
    lastTestTimeRef.current = now;

    const trimmedBase = baseUrl.trim();
    const effectiveApiKey =
      Object.values(envVars).find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      )?.trim() ?? "";

    if (!trimmedBase) {
      toast.error(t("qwen.testConnection.missingUrl", { defaultValue: "请先填写 Base URL" }));
      return;
    }
    if (!effectiveApiKey) {
      toast.error(t("qwen.testConnection.missingKey", { defaultValue: "请先填写 API Key" }));
      return;
    }
    if (selectedType !== "openai" && selectedType !== "anthropic") {
      toast.error(
        t("qwen.testConnection.unsupportedType", {
          defaultValue: "当前仅支持 OpenAI / Anthropic 协议测试",
        }),
      );
      return;
    }

    setIsTestingConnection(true);
    setTestResult(null); // 重置上次结果
    
    try {
      // 添加短暂延迟，确保 UI 状态更新
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = await providersApi.testQwenConnection({
        selectedType: selectedType,
        baseUrl: trimmedBase,
        apiKey: effectiveApiKey,
        modelName: modelName.trim() || undefined,
      });
      
      if (result.ok) {
        const msg = result.latencyMs != null
          ? t("qwen.testConnection.successWithLatency", {
              defaultValue: "连接正常（{{ms}}ms）",
              ms: result.latencyMs,
            })
          : t("qwen.testConnection.success", { defaultValue: "连接正常，API Key 有效" });
        toast.success(msg);
        setTestResult({ ok: true, message: msg });
      } else {
        // 优先用 errorCode 走 i18n，无映射时 fallback 到英文 message
        const msg = result.errorCode
          ? t(`provider.testConnection.error.${result.errorCode}`, {
              defaultValue: result.message,
            })
          : result.message || t("qwen.testConnection.failed", { defaultValue: "连接失败" });
        toast.error(msg);
        setTestResult({ ok: false, message: msg });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMessage = msg || t("qwen.testConnection.failed", { defaultValue: "连接失败" });
      toast.error(errorMessage);
      setTestResult({ ok: false, message: errorMessage });
    } finally {
      // 确保状态重置
      setIsTestingConnection(false);
    }
  }, [
    baseUrl,
    envVars,
    modelName,
    selectedType,
    t,
    isTestingConnection, // 添加依赖，确保重复点击检查生效
  ]);

  // 检测配置一致性
  const checkConsistency = useCallback(async () => {
    // 编辑时不检测，避免干扰用户
    if (!providerId || dismissed || hasFormChanged) {
      return;
    }

    // 同步完成后跳过一次检查（避免 props 变化重新触发检查导致误报）
    if (justSyncedRef.current) {
      justSyncedRef.current = false;
      return;
    }

    try {
      // 构建当前表单配置（仅包含表单字段）
      const formConfig: Record<string, unknown> = {};

      // 解析 modelProviders JSON
      let modelProvidersObj = {};
      try {
        modelProvidersObj = JSON.parse(modelProviders);
      } catch (e) {
        console.warn("Failed to parse modelProviders JSON:", e);
      }

      formConfig.modelProviders = modelProvidersObj;
      formConfig.env = envVars;
      formConfig.security = {
        auth: {
          selectedType,
          // 兼容旧版字段：仅在有值时包含
          ...(deprecatedApiKey && { apiKey: deprecatedApiKey }),
          ...(deprecatedBaseUrl && { baseUrl: deprecatedBaseUrl }),
        },
      };
      formConfig.model = {
        name: modelName,
      };

      const consistent = await providersApi.checkQwenConfigConsistency(
        providerId,
        formConfig,
      );
      setIsInconsistent(!consistent);
    } catch (error) {
      // 检测失败时不显示不一致提示，避免干扰用户
      console.error("检测配置一致性失败:", error);
      setIsInconsistent(false);
    }
  }, [
    providerId,
    dismissed,
    hasFormChanged,  // 添加依赖：表单修改后不检测
    selectedType,
    modelName,
    envVars,
    modelProviders,
    deprecatedApiKey,
    deprecatedBaseUrl,
  ]);

  // 同步配置
  const handleSyncConfig = useCallback(async () => {
    if (!providerId) return;

    try {
      setSyncing(true);
      const updatedProvider =
        await providersApi.refreshQwenLiveConfig(providerId);

      // 更新表单字段（使用原始函数，不触发"already已修改"标记）
      const config = updatedProvider.settingsConfig as any;
      onSelectedTypeChange(config?.security?.auth?.selectedType || "openai");
      onModelNameChange(config?.model?.name ?? "");
      onEnvVarsChange(config?.env || {});
      onModelProvidersChange(
        JSON.stringify(config?.modelProviders || {}, null, 2),
      );
      onDeprecatedApiKeyChange(config?.security?.auth?.apiKey || "");
      onDeprecatedBaseUrlChange(config?.security?.auth?.baseUrl || "");

      // 通知父组件配置已同步
      if (onConfigSynced) {
        onConfigSynced(config);
      }

      setIsInconsistent(false);
      setHasFormChanged(false); // 同步后重置编辑状态
      justSyncedRef.current = true; // 标记刚完成同步，跳过下一次检查
      toast.success(t("qwen.config.synced", { defaultValue: "配置已同步" }));
    } catch (error) {
      console.error("同步配置失败:", error);
      toast.error(
        t("qwen.config.syncFailed", {
          defaultValue: "同步配置失败",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSyncing(false);
    }
  }, [
    providerId,
    onSelectedTypeChange,
    onModelNameChange,
    onEnvVarsChange,
    onModelProvidersChange,
    onDeprecatedApiKeyChange,
    onDeprecatedBaseUrlChange,
    onConfigSynced,
    t,
  ]);

  // 组件挂载时和定期检查
  useEffect(() => {
    if (!providerId) return;

    // 立即检查一次
    checkConsistency();

    // 定期检查（60秒）
    const interval = setInterval(checkConsistency, 60000);

    return () => clearInterval(interval);
  }, [providerId, checkConsistency]);

  // 窗口获得焦点时检查
  useEffect(() => {
    if (!providerId) return;

    const handleFocus = () => {
      checkConsistency();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [providerId, checkConsistency]);

  // 创建默认模型配置的工厂函数（与预设配置保持一致）
  const createDefaultModelConfig = useCallback((
    modelId: string,
    baseUrl: string,
    envKey: string,
    namePrefix: string = "",
    hasThinking: boolean = false
  ) => {
    const config: any = {
      id: modelId,
      name: namePrefix ? `${namePrefix} ${modelId}` : modelId,
      baseUrl,
      envKey,
    };

    if (hasThinking) {
      config.generationConfig = {
        extra_body: {
          enable_thinking: true,
        },
      };
    }

    return config;
  }, []);

  // 获取默认模型列表（与Coding Plan 预设保持一致）
  const getDefaultModelsForProtocol = useCallback((baseUrl: string, envKey: string, namePrefix: string) => [
    createDefaultModelConfig("qwen3.5-plus", baseUrl, envKey, namePrefix, true),
    createDefaultModelConfig("qwen3-coder-plus", baseUrl, envKey, namePrefix, false),
    createDefaultModelConfig("qwen3-coder-next", baseUrl, envKey, namePrefix, false),
    createDefaultModelConfig("qwen3-max-2026-01-23", baseUrl, envKey, namePrefix, true),
    createDefaultModelConfig("glm-4.7", baseUrl, envKey, namePrefix, true),
    createDefaultModelConfig("glm-5", baseUrl, envKey, namePrefix, true),
    createDefaultModelConfig("MiniMax-M2.5", baseUrl, envKey, namePrefix, true),
    createDefaultModelConfig("kimi-k2.5", baseUrl, envKey, namePrefix, true),
  ], [createDefaultModelConfig]);

  // 重置当前协议为默认配置
  const handleResetToDefault = useCallback(() => {
    const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
    let defaultModels: any[] = [];

    // 如果是自定义配置且协议不是 openai/anthropic，不提供默认值
    if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
      toast.error(
        t("qwen.resetToDefault.notAvailable", { 
          defaultValue: `此协议无默认配置，请手动配置` 
        }),
      );
      return;
    }

    switch (providerType) {
      case "openai":
        defaultModels = getDefaultModelsForProtocol(
          getDefaultBaseUrlForProtocol("openai"),
          getDefaultEnvKeyForProtocol("openai"),
          getNamePrefix(qwenPresetType)
        );
        break;
      case "anthropic":
        defaultModels = getDefaultModelsForProtocol(
          getDefaultBaseUrlForProtocol("anthropic"),
          getDefaultEnvKeyForProtocol("anthropic"),
          getNamePrefix(qwenPresetType)
        );
        break;
      case "gemini":
        defaultModels = [
          {
            id: "gemini-2.0-flash-exp",
            name: "Gemini 2.0 Flash (Experimental)",
            baseUrl: getDefaultBaseUrlForProtocol("gemini"),
            envKey: "GEMINI_API_KEY"
          }
        ];
        break;
      case "vertex-ai":
        defaultModels = [
          {
            id: "gemini-2.0-flash-exp",
            name: "Gemini 2.0 Flash (Vertex AI)",
            baseUrl: getDefaultBaseUrlForProtocol("vertex-ai"),
            envKey: "VERTEX_AI_API_KEY"
          }
        ];
        break;
      default:
        defaultModels = [
          {
            id: "model-name",
            name: "Model Name",
            baseUrl: "https://api.example.com/v1",
            envKey: "API_KEY"
          }
        ];
    }

    // 更新完整的 modelProviders
    try {
      const allProviders = JSON.parse(modelProviders || "{}");
      allProviders[providerType] = defaultModels;
      const updatedJson = JSON.stringify(allProviders, null, 2);
      wrappedOnModelProvidersChange(updatedJson);
      
      // 同步 Base URL
      const newBaseUrl = extractBaseUrlFromModelProviders(
        updatedJson,
        selectedType,
        modelName,
      );
      setBaseUrl(newBaseUrl);
      
      toast.success(
        t("qwen.resetToDefault.success", { 
          defaultValue: `已重置 ${providerType} 协议为默认配置` 
        }),
      );
    } catch (error) {
      toast.error(
        t("qwen.resetToDefault.error", { 
          defaultValue: "重置失败" 
        }),
      );
    }
  }, [
    selectedType,
    qwenPresetType,
    getDefaultBaseUrlForProtocol,
    getDefaultEnvKeyForProtocol,
    getDefaultModelsForProtocol,
    getNamePrefix,
    modelProviders,
    wrappedOnModelProvidersChange,
    extractBaseUrlFromModelProviders,
    modelName,
    t,
  ]);

  // 根据当前选中的认证协议过滤 modelProviders
  const getFilteredModelProviders = useCallback(() => {
    try {
      const allProviders = JSON.parse(modelProviders || "{}");
      const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
      
      let currentProviders = allProviders[providerType];
      
      // 如果当前协议的数组为空或不存在，提供默认示例
      if (!currentProviders || !Array.isArray(currentProviders) || currentProviders.length === 0) {
        // 如果是自定义配置且协议不是 openai/anthropic，返回空数组
        if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
          currentProviders = [];
        } else {
          switch (providerType) {
            case "openai":
              currentProviders = getDefaultModelsForProtocol(
                getDefaultBaseUrlForProtocol("openai"),
                getDefaultEnvKeyForProtocol("openai"),
                getNamePrefix(qwenPresetType)
              );
              break;
            case "anthropic":
              currentProviders = getDefaultModelsForProtocol(
                getDefaultBaseUrlForProtocol("anthropic"),
                getDefaultEnvKeyForProtocol("anthropic"),
                getNamePrefix(qwenPresetType)
              );
              break;
            case "gemini":
              currentProviders = [
                {
                  id: "gemini-2.0-flash-exp",
                  name: "Gemini 2.0 Flash (Experimental)",
                  baseUrl: getDefaultBaseUrlForProtocol("gemini"),
                  envKey: "GEMINI_API_KEY"
                }
              ];
              break;
            case "vertex-ai":
              currentProviders = [
                {
                  id: "gemini-2.0-flash-exp",
                  name: "Gemini 2.0 Flash (Vertex AI)",
                  baseUrl: getDefaultBaseUrlForProtocol("vertex-ai"),
                  envKey: "VERTEX_AI_API_KEY"
                }
              ];
              break;
            default:
              currentProviders = [
                {
                  id: "model-name",
                  name: "Model Name",
                  baseUrl: "https://api.example.com/v1",
                  envKey: "API_KEY"
                }
              ];
          }
        }
      }
      
      // 返回包含当前协议的 JSON 对象格式
      const filteredObject = {
        [providerType]: currentProviders
      };
      return JSON.stringify(filteredObject, null, 2);
    } catch {
      const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
      return JSON.stringify({ [providerType]: [] }, null, 2);
    }
  }, [modelProviders, selectedType, qwenPresetType, getDefaultBaseUrlForProtocol, getDefaultEnvKeyForProtocol, getDefaultModelsForProtocol, getNamePrefix]);

  // 处理过滤后的 modelProviders 变更
  const handleFilteredModelProvidersChange = useCallback((filteredJson: string) => {
    try {
      const allProviders = JSON.parse(modelProviders || "{}");
      const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
      const filteredObject = JSON.parse(filteredJson || "{}");
      
      // 从过滤后的对象中提取对应协议的数组
      if (filteredObject[providerType]) {
        allProviders[providerType] = filteredObject[providerType];
      }
      
      // 更新完整的 modelProviders
      wrappedOnModelProvidersChange(JSON.stringify(allProviders, null, 2));
    } catch (error) {
      // 如果解析失败，直接传递原始值（让 JsonEditor 显示错误）
      console.error("解析过滤的 modelProviders 失败:", error);
    }
  }, [modelProviders, selectedType, wrappedOnModelProvidersChange]);

  // 根据当前协议生成对应的占位符（与默认模型保持一致）
  const getModelProvidersPlaceholder = useCallback(() => {
    const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
    
    // 如果是自定义配置且协议不是 openai/anthropic，返回空数组占位符
    if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
      return `{
  "${providerType}": []
}`;
    }
    
    // 生成完整的占位符 JSON，与默认模型配置保持一致
    const generatePlaceholderJson = (protocol: string, baseUrl: string, envKey: string, namePrefix: string) => {
      const defaultModels = getDefaultModelsForProtocol(baseUrl, envKey, namePrefix);
      const placeholderObject = {
        [protocol]: defaultModels
      };
      return JSON.stringify(placeholderObject, null, 2);
    };

    switch (providerType) {
      case "openai":
        return generatePlaceholderJson(
          "openai",
          getDefaultBaseUrlForProtocol("openai"),
          getDefaultEnvKeyForProtocol("openai"),
          getNamePrefix(qwenPresetType)
        );
      case "anthropic":
        return generatePlaceholderJson(
          "anthropic",
          getDefaultBaseUrlForProtocol("anthropic"),
          getDefaultEnvKeyForProtocol("anthropic"),
          getNamePrefix(qwenPresetType)
        );
      case "gemini":
        return JSON.stringify({
          "gemini": [
            {
              "id": "gemini-2.0-flash-exp",
              "name": "Gemini 2.0 Flash (Experimental)",
              "baseUrl": getDefaultBaseUrlForProtocol("gemini"),
              "envKey": "GEMINI_API_KEY"
            }
          ]
        }, null, 2);
      case "vertex-ai":
        return JSON.stringify({
          "vertex-ai": [
            {
              "id": "gemini-2.0-flash-exp",
              "name": "Gemini 2.0 Flash (Vertex AI)",
              "baseUrl": getDefaultBaseUrlForProtocol("vertex-ai"),
              "envKey": "VERTEX_AI_API_KEY"
            }
          ]
        }, null, 2);
      default:
        return `{
  "${providerType}": [
    {
      "id": "model-name",
      "name": "Model Name",
      "baseUrl": "https://api.example.com/v1",
      "envKey": "API_KEY"
    }
  ]
}`;
    }
  }, [selectedType, qwenPresetType, getDefaultBaseUrlForProtocol, getDefaultEnvKeyForProtocol, getDefaultModelsForProtocol, getNamePrefix]);

  // 获取默认模型 ID 列表（与默认模型配置保持一致）
  const getDefaultModelIds = useCallback(
    () => [...BAILIAN_DEFAULT_MODEL_IDS],
    [],
  );

  // 获取当前协议下可用的模型列表（末尾带“自定义”选项，供下拉使用）
  const getAvailableModels = useCallback(() => {
    try {
      const allProviders = JSON.parse(modelProviders || "{}");
      const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
      const providers = allProviders[providerType] || [];
      
      // 提取模型 ID 列表
      const modelIds = providers.map((p: any) => p.id).filter(Boolean);
      
      // 如果是自定义配置且协议不是 openai/anthropic，不返回默认模型
      if (modelIds.length === 0) {
        if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
          return [CUSTOM_MODEL_VALUE];
        }
        return [...getDefaultModelIds(), CUSTOM_MODEL_VALUE];
      }
      
      return [...modelIds, CUSTOM_MODEL_VALUE];
    } catch {
      // 如果是自定义配置且协议不是 openai/anthropic，不返回默认模型
      const providerType = AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType;
      if (!qwenPresetType && providerType !== "openai" && providerType !== "anthropic") {
        return [CUSTOM_MODEL_VALUE];
      }
      return [...getDefaultModelIds(), CUSTOM_MODEL_VALUE];
    }
  }, [modelProviders, selectedType, getDefaultModelIds, qwenPresetType]);

  // 仅模型 ID 列表（不含 __custom__），用于判断当前 modelName 是否在列表中
  const getAvailableModelIdsOnly = useCallback(() => {
    const list = getAvailableModels();
    return list.filter((id) => id !== CUSTOM_MODEL_VALUE);
  }, [getAvailableModels]);

  return (
    <div className="space-y-6">
      {/* 配置不一致提示 */}
      {isInconsistent && !dismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t("qwen.config.inconsistent", { defaultValue: "配置不一致" })}
            </p>
            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
              {t("qwen.config.inconsistentHint", {
                defaultValue: "检测到本地配置文件已更新，是否同步到界面？",
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSyncConfig}
              disabled={syncing}
              className="h-7 px-2.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-400 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20"
            >
              {syncing ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                  {t("qwen.config.syncing", { defaultValue: "同步中..." })}
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  {t("qwen.config.sync", { defaultValue: "同步配置" })}
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-amber-400 transition-colors hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:text-amber-500"
              aria-label={t("common.ignore", { defaultValue: "忽略" })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 结构化字段 */}
      <div className="space-y-4">

        {/* ── 协议配置区块（主流程：认证协议 + 区域） ── */}
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
          <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{t("qwen.protocolConfig")}</p>

          {/* 认证协议选择 */}
          <div className="space-y-2">
            <FormLabel>
              <span className="ml-2">{t("qwen.authProtocol")}</span>
              <span className="text-destructive ml-1">*</span>
            </FormLabel>
            <Select value={selectedType} onValueChange={wrappedOnSelectedTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("qwen.authProtocolPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {(qwenPresetType ? BAILIAN_AUTH_TYPES : CUSTOM_AUTH_TYPES).map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 区域选择（仅 Coding Plan / 百炼 预设时显示） */}
          {qwenPresetType && BAILIAN_REGION_URLS[qwenPresetType] && (
            <div className="space-y-2">
              <FormLabel>
                <span className="ml-2">{t("qwen.region.label")}</span>
              </FormLabel>
              <div className="flex flex-wrap gap-2">
                {Object.keys(BAILIAN_REGION_URLS[qwenPresetType]).map((region) => {
                  const isSelected = currentRegion === region;
                  return (
                    <Button
                      key={region}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleRegionChange(region)}
                      className={[
                        "rounded-full font-medium transition-colors",
                        isSelected
                          ? "border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary"
                          : "",
                      ].join(" ")}
                    >
                      {region}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("qwen.region.hint", {
                  defaultValue:
                    "切换区域将同时更新 OpenAI 与 Anthropic 协议的 Base URL",
                })}
              </p>
            </div>
          )}
        </div>

        {/* ── API Key 存储区块（主流程） ── */}
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          {/* 区块标题行：左侧标题，右侧测试链接按钮 + 内联结果 */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{t("qwen.apiKeyStorage")}</p>
            <div className="flex items-center gap-2">
              {/* 内联测试结果 */}
              {testResult && !isTestingConnection && (
                <span className={`flex items-center gap-1 text-xs font-medium ${testResult.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                  {testResult.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    : <XCircle className="h-3.5 w-3.5 shrink-0" />
                  }
                  {testResult.message}
                </span>
              )}
              {(selectedType !== "openai" && selectedType !== "anthropic") && (
                <span className="text-xs text-muted-foreground">
                  {t("qwen.testConnection.openaiAnthropicOnly", {
                    defaultValue: "仅支持 OpenAI / Anthropic 协议",
                  })}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={
                  isTestingConnection ||
                  !baseUrl.trim() ||
                  !Object.values(envVars).some(
                    (v) => typeof v === "string" && v.trim().length > 0,
                  ) ||
                  (selectedType !== "openai" && selectedType !== "anthropic")
                }
                className="gap-1.5 h-7 text-xs shrink-0"
              >
                {isTestingConnection ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("qwen.testConnection.testing", { defaultValue: "测试中…" })}
                  </>
                ) : (
                  <>
                    <Link2 className="h-3 w-3" />
                    {t("qwen.testConnection.button", { defaultValue: "测试链接" })}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 键值对输入列表 */}
          <div className="space-y-2">
            {envEntries.map(([key, value], index) => (
              <div key={`${key}-${index}`} className="group flex gap-2 items-center">
                <Input
                  value={key}
                  onChange={(e) =>
                    handleUpdateEnvVar(key, e.target.value, value)
                  }
                  placeholder={API_KEY_PLACEHOLDERS[selectedType] || "API_KEY"}
                  className="flex-1"
                />
                <div className="relative flex-1">
                  <Input
                    type={passwordVisibility[key] ? "text" : "password"}
                    value={value}
                    onChange={(e) =>
                      handleUpdateEnvVar(key, key, e.target.value)
                    }
                    placeholder={API_KEY_VALUE_PLACEHOLDERS[selectedType] || "your-api-key"}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => togglePasswordVisibility(key)}
                  >
                    {passwordVisibility[key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveEnvVar(key)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddEnvVar}
              className="w-full mt-1"
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("qwen.addEnvVar")}
            </Button>
          </div>
          {/* helper text */}
          <p className="text-xs text-muted-foreground/60">
            {t("qwen.envKeyHelperText")}
          </p>
          {/* API Key 获取链接引导（仅百炼预设时显示） */}
          {_shouldShowApiKeyLink && _websiteUrl && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                {t("providerForm.apiKeyGuideHint", {
                  defaultValue: "还没有 Key？",
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs text-primary hover:text-primary/80 hover:bg-transparent gap-1"
                asChild
              >
                <a href={_websiteUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {t("providerForm.getApiKey", {
                    defaultValue: "获取 API Key",
                  })}
                </a>
              </Button>
            </div>
          )}
        </div>

        {/* ── 模型设置区块（次级） ── */}
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{t("qwen.modelSettings")}</p>
          <div className="space-y-2">
            <FormLabel>
              <span className="ml-2">{t("qwen.defaultModelName")}</span>
            </FormLabel>
            {(() => {
              const availableIds = getAvailableModelIdsOnly();
              const showModelInput =
                isCustomModel ||
                (modelName.trim() !== "" && !availableIds.includes(modelName));
              if (showModelInput) {
                return (
                  <div className="space-y-2">
                    <Input
                      value={modelName}
                      onChange={(e) => {
                        const v = e.target.value;
                        wrappedOnModelNameChange(v);
                        if (availableIds.includes(v)) setIsCustomModel(false);
                      }}
                      placeholder={t("qwen.modelNamePlaceholder")}
                      className="w-full"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto py-1 px-0 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setIsCustomModel(false);
                        if (!availableIds.includes(modelName) && availableIds.length > 0) {
                          wrappedOnModelNameChange(availableIds[0]);
                        }
                      }}
                    >
                      {t("qwen.selectFromList")}
                    </Button>
                  </div>
                );
              }
              return (
                <Select
                  value={modelName}
                  onValueChange={(v) => {
                    if (v === CUSTOM_MODEL_VALUE) {
                      setIsCustomModel(true);
                      wrappedOnModelNameChange("");
                    } else {
                      wrappedOnModelNameChange(v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("qwen.selectDefaultModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableModels().map((modelId: string) => (
                      <SelectItem key={modelId} value={modelId}>
                        {modelId === CUSTOM_MODEL_VALUE ? t("providerForm.modelCustomOption", { defaultValue: "自定义..." }) : modelId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            })()}
            <p className="text-xs text-muted-foreground">
              {t("qwen.modelNameHint")}
            </p>
          </div>
        </div>

        {/* ── 高级配置（折叠，默认收起） ── */}
        <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors text-sm text-muted-foreground hover:text-foreground"
            >
              <span className="font-medium">{t("qwen.advancedConfig")}</span>
              <ChevronDown
                className={[
                  "h-4 w-4 transition-transform duration-200",
                  isAdvancedOpen ? "rotate-180" : "",
                ].join(" ")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">

            {/* Base URL 子区块 */}
            <Collapsible open={isBaseUrlOpen} onOpenChange={setIsBaseUrlOpen}>
              <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between text-left"
                  >
                    <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Base URL</p>
                    <ChevronDown
                      className={[
                        "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                        isBaseUrlOpen ? "rotate-180" : "",
                      ].join(" ")}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={baseUrl}
                      onChange={(e) => handleBaseUrlChange(e.target.value)}
                      placeholder={BASE_URL_PLACEHOLDERS[selectedType] || "https://api.example.com/v1"}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleSyncFromJson}
                      title={t("qwen.baseUrl.syncFromJson", {
                        defaultValue: "从 JSON 重新读取",
                      })}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                  {/* 预设快速选择（仅自定义配置时显示；百炼预设用上方区域切换） */}
                  {!qwenPresetType &&
                    BASE_URL_PRESETS[selectedType] &&
                    BASE_URL_PRESETS[selectedType].length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {BASE_URL_PRESETS[selectedType].map((preset) => (
                          <Button
                            key={preset.value}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleBaseUrlChange(preset.value)}
                            className="text-xs"
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      {selectedType === "openai"
                        ? t("qwen.baseUrl.hintOpenai", {
                            defaultValue: `修改将影响所有 openai 协议下的模型`,
                            providerType:
                              AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType,
                          })
                        : t("qwen.baseUrl.hint", {
                            defaultValue: `影响模型: ${modelName || "未设置"}`,
                            providerType:
                              AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType,
                            modelName: modelName || "未设置",
                          })}
                    </p>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* 模型提供商 JSON 编辑器 */}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{t("qwen.modelProviderConfig")}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetToDefault}
                  title={t("qwen.resetToDefault")}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  {t("qwen.resetDefaultButton")}
                </Button>
              </div>
              <JsonEditor
                value={getFilteredModelProviders()}
                onChange={handleFilteredModelProvidersChange}
                placeholder={getModelProvidersPlaceholder()}
                rows={12}
                showValidation={true}
                language="json"
              />
              <p className="text-xs text-muted-foreground">
                {t("qwen.modelProviderDesc", { providerType: AUTH_TO_PROVIDER_TYPE[selectedType] || selectedType })}
              </p>
            </div>

            {/* 兼容旧版配置（嵌套折叠） */}
            <Collapsible open={isDeprecatedOpen} onOpenChange={setIsDeprecatedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-amber-200/60 bg-amber-50/30 hover:bg-amber-50/60 transition-colors dark:border-amber-800/40 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-sm text-amber-700 dark:text-amber-400">{t("qwen.legacyConfig")}</span>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-500">
                      {t("qwen.legacyDeprecated")}
                    </Badge>
                  </div>
                  <ChevronDown
                    className={[
                      "h-4 w-4 text-amber-500 transition-transform duration-200",
                      isDeprecatedOpen ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 dark:border-amber-800">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    ⚠ {t("qwen.legacyWarning")}
                  </p>
                </div>

                <div className="space-y-2">
                  <FormLabel>
                    <code className="text-xs bg-muted px-1 rounded">
                      security.auth.apiKey
                    </code>
                    <span className="ml-2">{t("qwen.legacyApiKey")}</span>
                  </FormLabel>
                  <Input
                    type="password"
                    value={deprecatedApiKey}
                    onChange={(e) => wrappedOnDeprecatedApiKeyChange(e.target.value)}
                    placeholder={t("qwen.legacyApiKeyPlaceholder")}
                  />
                </div>

                <div className="space-y-2">
                  <FormLabel>
                    <code className="text-xs bg-muted px-1 rounded">
                      security.auth.baseUrl
                    </code>
                    <span className="ml-2">{t("qwen.legacyBaseUrl")}</span>
                  </FormLabel>
                  <Input
                    value={deprecatedBaseUrl}
                    onChange={(e) => wrappedOnDeprecatedBaseUrlChange(e.target.value)}
                    placeholder={t("qwen.legacyApiKeyPlaceholder")}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

          </CollapsibleContent>
        </Collapsible>

      </div>
    </div>
  );
}
