import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Provider,
  UniversalProvider,
  UniversalProvidersMap,
} from "@/types";
import type { AppId } from "./types";

export interface ProviderSortUpdate {
  id: string;
  sortIndex: number;
}

export interface ProviderSwitchEvent {
  appType: AppId;
  providerId: string;
}

export interface SwitchResult {
  warnings: string[];
}

/** Qwen 测试连接结果（仅验证 URL 可达与 API Key 鉴权） */
export interface QwenTestConnectionResult {
  ok: boolean;
  httpStatus?: number;
  /** English fallback message; prefer errorCode for i18n display */
  message: string;
  /** Semantic error code for i18n translation on the frontend */
  errorCode?: string;
  latencyMs?: number;
}

/** 通用测试连接结果（适用于所有支持 OpenAI / Anthropic 协议的 Provider） */
export type ProviderTestConnectionResult = QwenTestConnectionResult;

export const providersApi = {
  async getAll(appId: AppId): Promise<Record<string, Provider>> {
    return await invoke("get_providers", { app: appId });
  },

  async getCurrent(appId: AppId): Promise<string> {
    return await invoke("get_current_provider", { app: appId });
  },

  async add(provider: Provider, appId: AppId): Promise<boolean> {
    return await invoke("add_provider", { provider, app: appId });
  },

  async update(provider: Provider, appId: AppId): Promise<boolean> {
    return await invoke("update_provider", { provider, app: appId });
  },

  async delete(id: string, appId: AppId): Promise<boolean> {
    return await invoke("delete_provider", { id, app: appId });
  },

  async checkLiveConfigExists(appId: AppId): Promise<boolean> {
    return await invoke("check_app_live_config_exists", { app: appId });
  },

  /**
   * Remove provider from live config only (for additive mode apps like OpenCode)
   * Does NOT delete from database - provider remains in the list
   */
  async removeFromLiveConfig(id: string, appId: AppId): Promise<boolean> {
    return await invoke("remove_provider_from_live_config", { id, app: appId });
  },

  /**
   * 检测 Qwen 配置一致性
   * 比较表单字段与本地文件配置是否一致
   */
  async checkQwenConfigConsistency(
    providerId: string,
    formConfig: Record<string, unknown>
  ): Promise<boolean> {
    return await invoke("check_qwen_config_consistency", {
      providerId,
      formConfig,
    });
  },

  /**
   * 刷新 Qwen 配置：从本地文件读取并更新数据库
   */
  async refreshQwenLiveConfig(providerId: string): Promise<Provider> {
    return await invoke("refresh_qwen_live_config", { providerId });
  },

  /**
   * 测试 Qwen 连接：验证 Base URL 与 API Key（不验证模型是否可调用）
   */
  async testQwenConnection(payload: {
    selectedType: string;
    baseUrl: string;
    apiKey: string;
    modelName?: string;
  }): Promise<QwenTestConnectionResult> {
    return await invoke("test_qwen_connection", {
      selectedType: payload.selectedType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      modelName: payload.modelName ?? "",
    });
  },

  /**
   * 检测 Cline 配置一致性
   * 比较表单字段与本地文件配置是否一致
   */
  async checkClineConfigConsistency(
    providerId: string,
    formConfig: Record<string, unknown>
  ): Promise<boolean> {
    return await invoke("check_cline_config_consistency", {
      providerId,
      formConfig,
    });
  },

  /**
   * 刷新 Cline 配置：从本地文件读取并更新数据库
   */
  async refreshClineLiveConfig(providerId: string): Promise<Provider> {
    return await invoke("refresh_cline_live_config", { providerId });
  },

  async switch(id: string, appId: AppId): Promise<SwitchResult> {
    return await invoke("switch_provider", { id, app: appId });
  },

  async importDefault(appId: AppId): Promise<boolean> {
    return await invoke("import_default_config", { app: appId });
  },

  async updateTrayMenu(): Promise<boolean> {
    return await invoke("update_tray_menu");
  },

  async updateSortOrder(
    updates: ProviderSortUpdate[],
    appId: AppId,
  ): Promise<boolean> {
    return await invoke("update_providers_sort_order", { updates, app: appId });
  },

  async onSwitched(
    handler: (event: ProviderSwitchEvent) => void,
  ): Promise<UnlistenFn> {
    return await listen("provider-switched", (event) => {
      const payload = event.payload as ProviderSwitchEvent;
      handler(payload);
    });
  },

  /**
   * 测试 Provider 连接：适用于所有支持 OpenAI / Anthropic 协议的 Provider
   */
  async testProviderConnection(payload: {
    selectedType: "openai" | "anthropic";
    baseUrl: string;
    apiKey: string;
    modelName?: string;
  }): Promise<ProviderTestConnectionResult> {
    return await invoke("test_provider_connection", {
      selectedType: payload.selectedType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      modelName: payload.modelName ?? "",
    });
  },

  /**
   * 打开指定提供商的终端
   * 任何提供商都可以打开终端，不受是否为当前激活提供商的限制
   * 终端会使用该提供商特定的 API 配置，不影响全局设置
   */
  async openTerminal(providerId: string, appId: AppId): Promise<boolean> {
    return await invoke("open_provider_terminal", { providerId, app: appId });
  },

  /**
   * 从 OpenCode live 配置导入供应商到数据库
   * OpenCode 特有功能：由于累加模式，用户可能已在 opencode.json 中配置供应商
   */
  async importOpenCodeFromLive(): Promise<number> {
    return await invoke("import_opencode_providers_from_live");
  },

  /**
   * 获取 OpenCode live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 opencode.json
   */
  async getOpenCodeLiveProviderIds(): Promise<string[]> {
    return await invoke("get_opencode_live_provider_ids");
  },

  /**
   * 获取 OpenClaw live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 openclaw.json
   */
  async getOpenClawLiveProviderIds(): Promise<string[]> {
    return await invoke("get_openclaw_live_provider_ids");
  },

  /**
   * 从 OpenClaw live 配置导入供应商到数据库
   * OpenClaw 特有功能：由于累加模式，用户可能已在 openclaw.json 中配置供应商
   */
  async importOpenClawFromLive(): Promise<number> {
    return await invoke("import_openclaw_providers_from_live");
  },
};

// ============================================================================
// 统一供应商（Universal Provider）API
// ============================================================================

export const universalProvidersApi = {
  /**
   * 获取所有统一供应商
   */
  async getAll(): Promise<UniversalProvidersMap> {
    return await invoke("get_universal_providers");
  },

  /**
   * 获取单个统一供应商
   */
  async get(id: string): Promise<UniversalProvider | null> {
    return await invoke("get_universal_provider", { id });
  },

  /**
   * 添加或更新统一供应商
   */
  async upsert(provider: UniversalProvider): Promise<boolean> {
    return await invoke("upsert_universal_provider", { provider });
  },

  /**
   * 删除统一供应商
   */
  async delete(id: string): Promise<boolean> {
    return await invoke("delete_universal_provider", { id });
  },

  /**
   * 手动同步统一供应商到各应用
   */
  async sync(id: string): Promise<boolean> {
    return await invoke("sync_universal_provider", { id });
  },
};
