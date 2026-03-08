import { useState, useCallback, useMemo } from "react";
import type { OpenClawModel } from "@/types";
import type { AppId } from "@/lib/api";
import { useProvidersQuery } from "@/lib/query/queries";
import { OPENCLAW_DEFAULT_CONFIG } from "../helpers/opencodeFormUtils";

interface UseOpenclawFormStateParams {
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  /** 新增模式下从预设直接传入的初始配置（优先级高于 initialData） */
  initialPresetConfig?: {
    providerKey?: string;
    baseUrl?: string;
    apiKey?: string;
    api?: string;
    models?: OpenClawModel[];
  };
  appId: AppId;
  providerId?: string;
  onSettingsConfigChange: (config: string) => void;
  getSettingsConfig: () => string;
  /**
   * API 协议 -> 对应 baseUrl 的映射。
   * 当用户切换 API 协议时，若当前 baseUrl 与某协议默认地址匹配，则自动切换。
   */
  apiBaseUrlMap?: Partial<Record<string, string>>;
}

export interface OpenclawFormState {
  openclawProviderKey: string;
  setOpenclawProviderKey: (key: string) => void;
  openclawBaseUrl: string;
  openclawApiKey: string;
  openclawApi: string;
  openclawModels: OpenClawModel[];
  existingOpenclawKeys: string[];
  handleOpenclawBaseUrlChange: (baseUrl: string) => void;
  handleOpenclawApiKeyChange: (apiKey: string) => void;
  handleOpenclawApiChange: (api: string) => void;
  handleOpenclawModelsChange: (models: OpenClawModel[]) => void;
  resetOpenclawState: (config?: {
    baseUrl?: string;
    apiKey?: string;
    api?: string;
    models?: OpenClawModel[];
  }) => void;
}

function parseOpenclawField<T>(
  initialData: UseOpenclawFormStateParams["initialData"],
  field: string,
  fallback: T,
): T {
  try {
    const config = JSON.parse(
      initialData?.settingsConfig
        ? JSON.stringify(initialData.settingsConfig)
        : OPENCLAW_DEFAULT_CONFIG,
    );
    return (config[field] as T) || fallback;
  } catch {
    return fallback;
  }
}

export function useOpenclawFormState({
  initialData,
  initialPresetConfig,
  appId,
  providerId,
  onSettingsConfigChange,
  getSettingsConfig,
  apiBaseUrlMap,
}: UseOpenclawFormStateParams): OpenclawFormState {
  // Query existing providers for duplicate key checking
  const { data: openclawProvidersData } = useProvidersQuery("openclaw");
  const existingOpenclawKeys = useMemo(() => {
    if (!openclawProvidersData?.providers) return [];
    return Object.keys(openclawProvidersData.providers).filter(
      (k) => k !== providerId,
    );
  }, [openclawProvidersData?.providers, providerId]);

  const [openclawProviderKey, setOpenclawProviderKey] = useState<string>(() => {
    if (appId !== "openclaw") return "";
    if (initialPresetConfig?.providerKey !== undefined) return initialPresetConfig.providerKey;
    return providerId || "";
  });

  const [openclawBaseUrl, setOpenclawBaseUrl] = useState<string>(() => {
    if (appId !== "openclaw") return "";
    if (initialPresetConfig?.baseUrl !== undefined) return initialPresetConfig.baseUrl;
    return parseOpenclawField(initialData, "baseUrl", "");
  });

  const [openclawApiKey, setOpenclawApiKey] = useState<string>(() => {
    if (appId !== "openclaw") return "";
    if (initialPresetConfig?.apiKey !== undefined) return initialPresetConfig.apiKey;
    return parseOpenclawField(initialData, "apiKey", "");
  });

  const [openclawApi, setOpenclawApi] = useState<string>(() => {
    if (appId !== "openclaw") return "openai-completions";
    if (initialPresetConfig?.api !== undefined) return initialPresetConfig.api;
    return parseOpenclawField(initialData, "api", "openai-completions");
  });

  const [openclawModels, setOpenclawModels] = useState<OpenClawModel[]>(() => {
    if (appId !== "openclaw") return [];
    if (initialPresetConfig?.models !== undefined) return initialPresetConfig.models;
    return parseOpenclawField<OpenClawModel[]>(initialData, "models", []);
  });

  const updateOpenclawConfig = useCallback(
    (updater: (config: Record<string, any>) => void) => {
      try {
        const config = JSON.parse(
          getSettingsConfig() || OPENCLAW_DEFAULT_CONFIG,
        );
        updater(config);
        onSettingsConfigChange(JSON.stringify(config, null, 2));
      } catch {
        // ignore
      }
    },
    [getSettingsConfig, onSettingsConfigChange],
  );

  const handleOpenclawBaseUrlChange = useCallback(
    (baseUrl: string) => {
      setOpenclawBaseUrl(baseUrl);
      updateOpenclawConfig((config) => {
        config.baseUrl = baseUrl.trim().replace(/\/+$/, "");
      });
    },
    [updateOpenclawConfig],
  );

  const handleOpenclawApiKeyChange = useCallback(
    (apiKey: string) => {
      setOpenclawApiKey(apiKey);
      updateOpenclawConfig((config) => {
        config.apiKey = apiKey;
      });
    },
    [updateOpenclawConfig],
  );

  const handleOpenclawApiChange = useCallback(
    (api: string) => {
      setOpenclawApi(api);
      updateOpenclawConfig((config) => {
        config.api = api;

        // 如果有协议->baseUrl 映射，则尝试自动切换 baseUrl
        if (apiBaseUrlMap) {
          const newBaseUrl = apiBaseUrlMap[api];
          if (newBaseUrl) {
            // 只有当前 baseUrl 处于某个已知协议的默认地址时才自动切换（避免覆盖用户自定义的地址）
            const currentBaseUrl = (config.baseUrl as string) || "";
            const isCurrentBaseUrlFromMap = Object.values(apiBaseUrlMap).includes(currentBaseUrl);
            if (!currentBaseUrl || isCurrentBaseUrlFromMap) {
              config.baseUrl = newBaseUrl.replace(/\/+$/, "");
              setOpenclawBaseUrl(newBaseUrl);
            }
          }
        }
      });
    },
    [updateOpenclawConfig, apiBaseUrlMap],
  );

  const handleOpenclawModelsChange = useCallback(
    (models: OpenClawModel[]) => {
      setOpenclawModels(models);
      updateOpenclawConfig((config) => {
        // 过滤掉 id 为空的条目，避免写入无效数据触发 OpenClaw schema 校验错误
        config.models = models.filter((m) => m.id.trim().length > 0);
      });
    },
    [updateOpenclawConfig],
  );

  const resetOpenclawState = useCallback(
    (config?: {
      baseUrl?: string;
      apiKey?: string;
      api?: string;
      models?: OpenClawModel[];
    }) => {
      setOpenclawProviderKey("");
      setOpenclawBaseUrl(config?.baseUrl || "");
      setOpenclawApiKey(config?.apiKey || "");
      setOpenclawApi(config?.api || "openai-completions");
      setOpenclawModels(config?.models || []);
    },
    [],
  );

  return {
    openclawProviderKey,
    setOpenclawProviderKey,
    openclawBaseUrl,
    openclawApiKey,
    openclawApi,
    openclawModels,
    existingOpenclawKeys,
    handleOpenclawBaseUrlChange,
    handleOpenclawApiKeyChange,
    handleOpenclawApiChange,
    handleOpenclawModelsChange,
    resetOpenclawState,
  };
}
