import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { openclawApi } from "@/lib/api/openclaw";
import { providersApi } from "@/lib/api/providers";
import { serviceLogger, envLogger, toolsLogger, agentsLogger } from "@/lib/logger";
import { extractErrorMessage } from "@/utils/errorUtils";
import type {
  OpenClawEnvConfig,
  OpenClawToolsConfig,
  OpenClawAgentsDefaults,
  OpenClawGatewayConfig,
} from "@/types";
/**
 * Centralized query keys for all OpenClaw-related queries.
 * Import this from any file that needs to invalidate OpenClaw caches.
 */
export const openclawKeys = {
  all: ["openclaw"] as const,
  liveProviderIds: ["openclaw", "liveProviderIds"] as const,
  providerModels: ["openclaw", "providerModels"] as const,
  defaultModel: ["openclaw", "defaultModel"] as const,
  env: ["openclaw", "env"] as const,
  tools: ["openclaw", "tools"] as const,
  agentsDefaults: ["openclaw", "agentsDefaults"] as const,
  agents: ["openclaw", "agents"] as const,
  serviceStatus: ["openclaw", "serviceStatus"] as const,
  channels: ["openclaw", "channels"] as const,
  gateway: ["openclaw", "gateway"] as const,
};

// ============================================================
// Query hooks
// ============================================================

/**
 * Query live provider IDs from openclaw.json config.
 * Used by ProviderList to show "In Config" badge.
 */
export function useOpenClawLiveProviderIds(enabled: boolean) {
  return useQuery({
    queryKey: openclawKeys.liveProviderIds,
    queryFn: () => providersApi.getOpenClawLiveProviderIds(),
    enabled,
  });
}

/**
 * Query all available model IDs from models.providers ("provider/model-id" format).
 * Used by AgentsDefaultsPanel for primary/fallback model dropdowns.
 */
export function useOpenClawProviderModels(enabled = true) {
  return useQuery({
    queryKey: openclawKeys.providerModels,
    queryFn: () => openclawApi.getProviderModels(),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Query the default model from agents.defaults.model.
 * Used by ProviderList to show which provider is the default.
 */
export function useOpenClawDefaultModel(enabled: boolean) {
  return useQuery({
    queryKey: openclawKeys.defaultModel,
    queryFn: () => openclawApi.getDefaultModel(),
    enabled,
  });
}

/**
 * Query env section of openclaw.json.
 */
export function useOpenClawEnv() {
  return useQuery({
    queryKey: openclawKeys.env,
    queryFn: () => openclawApi.getEnv(),
    staleTime: 30_000,
  });
}

/**
 * Query tools section of openclaw.json.
 */
export function useOpenClawTools() {
  return useQuery({
    queryKey: openclawKeys.tools,
    queryFn: () => openclawApi.getTools(),
    staleTime: 30_000,
  });
}

/**
 * Query agents.defaults section of openclaw.json.
 */
export function useOpenClawAgentsDefaults() {
  return useQuery({
    queryKey: openclawKeys.agentsDefaults,
    queryFn: () => openclawApi.getAgentsDefaults(),
    staleTime: 30_000,
  });
}

// Track last known service status to avoid logging on every poll
let _lastServiceStatus: boolean | undefined = undefined;

/**
 * Poll the OpenClaw gateway service status (port 18789).
 * Only active when `enabled` is true (i.e., when OpenClaw tab is visible).
 */
export function useOpenClawServiceStatus(enabled: boolean) {
  return useQuery({
    queryKey: openclawKeys.serviceStatus,
    queryFn: async () => {
      const running = await openclawApi.getServiceStatus();
      // Only log when status actually changes
      if (running !== _lastServiceStatus) {
        serviceLogger.state("服务状态", { running });
        _lastServiceStatus = running;
      }
      return running;
    },
    enabled,
    refetchInterval: enabled ? 3000 : false,
    placeholderData: (previousData: boolean | undefined) => previousData,
  });
}

/**
 * Detailed OpenClaw service status: running, pid, port.
 * Polls every 3 seconds when enabled.
 */
export function useOpenClawServiceDetail(enabled: boolean) {
  return useQuery({
    queryKey: [...openclawKeys.serviceStatus, "detail"],
    queryFn: () => openclawApi.getServiceDetail(),
    enabled,
    refetchInterval: enabled ? 3000 : false,
    placeholderData: (previousData: { running: boolean; pid: number | null; port: number; gateway_installed: boolean | null } | undefined) => previousData,
  });
}

/**
 * 启动 OpenClaw 服务（Gateway）：未安装则先安装，再启动。
 * 横幅与概览共用，保证行为与提示一致。
 */
export function useStartOpenClawService() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: async () => {
      serviceLogger.action("启动服务");

      // 启动前先执行 doctor --repair，修复常见环境问题
      serviceLogger.info("正在执行 openclaw doctor --repair ...");
      toast.info(t("overview.openclaw.doctorRepairing", { defaultValue: "启动前自检中…" }));
      try {
        await openclawApi.runDoctorFix();
        serviceLogger.info("✅ doctor --repair 完成");
      } catch (e) {
        serviceLogger.warn("doctor --repair 执行失败（可忽略，继续启动）", e);
      }

      const detail = await openclawApi.getServiceDetail();
      if (detail.gateway_installed === false) {
        serviceLogger.info("系统服务未安装，正在执行 gateway install...");
        toast.info(t("overview.openclaw.gatewayInstalling", { defaultValue: "正在安装系统服务..." }));
        await openclawApi.installGateway();
        serviceLogger.info("✅ gateway install 完成");
      }
      serviceLogger.info("正在启动服务...");
      await openclawApi.startService();
      serviceLogger.info("✅ 服务启动成功");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openclawKeys.serviceStatus });
      toast.success(t("overview.openclaw.serviceStarted"));
    },
    onError: (e) => {
      serviceLogger.error("❌ 服务启动失败", e);
      toast.error(t("overview.openclaw.serviceStartFailed"), {
        description: extractErrorMessage(e) || undefined,
      });
    },
  });
}

// ============================================================
// Mutation hooks
// ============================================================

/**
 * Save env config. Invalidates env query on success.
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawEnv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (env: OpenClawEnvConfig) => {
      envLogger.action("保存环境变量配置");
      return openclawApi.setEnv(env);
    },
    onSuccess: () => {
      envLogger.info("✅ 环境变量配置已保存");
      queryClient.invalidateQueries({ queryKey: openclawKeys.env });
    },
    onError: (error) => {
      envLogger.error("❌ 保存环境变量配置失败", error);
    },
  });
}

/**
 * Save tools config. Invalidates tools query on success.
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawTools() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tools: OpenClawToolsConfig) => {
      toolsLogger.action("保存工具权限配置");
      return openclawApi.setTools(tools);
    },
    onSuccess: () => {
      toolsLogger.info("✅ 工具权限配置已保存");
      queryClient.invalidateQueries({ queryKey: openclawKeys.tools });
    },
    onError: (error) => {
      toolsLogger.error("❌ 保存工具权限配置失败", error);
    },
  });
}

/**
 * Save agents.defaults config. Invalidates both agentsDefaults and defaultModel
 * queries on success (since changing agents.defaults may affect the default model).
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawAgentsDefaults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (defaults: OpenClawAgentsDefaults) => {
      agentsLogger.action("保存 Agents 默认配置");
      return openclawApi.setAgentsDefaults(defaults);
    },
    onSuccess: () => {
      agentsLogger.info("✅ Agents 默认配置已保存");
      queryClient.invalidateQueries({ queryKey: openclawKeys.agentsDefaults });
      queryClient.invalidateQueries({ queryKey: openclawKeys.defaultModel });
    },
    onError: (error) => {
      agentsLogger.error("❌ 保存 Agents 默认配置失败", error);
    },
  });
}

/**
 * Query all channel configs from openclaw.json.
 * Used by the OpenClaw overview to display channel configuration status.
 */
export function useOpenClawChannels(enabled: boolean) {
  return useQuery({
    queryKey: openclawKeys.channels,
    queryFn: () => openclawApi.getChannelsConfig(),
    enabled,
    staleTime: 10_000,
  });
}

// ============================================================
// Agent Instance Hooks
// ============================================================

/**
 * Query all Agent instances from ~/.openclaw/agents/.
 */
export function useOpenClawAgents() {
  return useQuery({
    queryKey: openclawKeys.agents,
    queryFn: () => openclawApi.listAgents(),
    staleTime: 10_000,
  });
}

/**
 * Add a new Agent instance.
 */
export function useAddAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      model,
      workspace,
    }: {
      name: string;
      model?: string;
      workspace?: string;
    }) => {
      agentsLogger.action("创建 Agent", { name, model });
      return openclawApi.addAgent(name, model, workspace);
    },
    onSuccess: () => {
      agentsLogger.info("✅ Agent 已创建");
      queryClient.invalidateQueries({ queryKey: openclawKeys.agents });
    },
    onError: (error) => {
      agentsLogger.error("❌ 创建 Agent 失败", error);
    },
  });
}

/**
 * Delete an Agent instance.
 */
export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      agentsLogger.action("删除 Agent", { id });
      return openclawApi.deleteAgent(id);
    },
    onSuccess: () => {
      agentsLogger.info("✅ Agent 已删除");
      queryClient.invalidateQueries({ queryKey: openclawKeys.agents });
    },
    onError: (error) => {
      agentsLogger.error("❌ 删除 Agent 失败", error);
    },
  });
}

/**
 * Update Agent identity (name and emoji).
 */
export function useUpdateAgentIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      name,
      emoji,
    }: {
      id: string;
      name: string | null;
      emoji: string | null;
    }) => {
      agentsLogger.action("更新 Agent 身份", { id, name, emoji });
      return openclawApi.updateAgentIdentity(id, name, emoji);
    },
    onSuccess: () => {
      agentsLogger.info("✅ Agent 身份已更新");
      queryClient.invalidateQueries({ queryKey: openclawKeys.agents });
    },
    onError: (error) => {
      agentsLogger.error("❌ 更新 Agent 身份失败", error);
    },
  });
}

/**
 * Update Agent default model.
 */
export function useUpdateAgentModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, model }: { id: string; model: string }) => {
      agentsLogger.action("更新 Agent 模型", { id, model });
      return openclawApi.updateAgentModel(id, model);
    },
    onSuccess: () => {
      agentsLogger.info("✅ Agent 模型已更新");
      queryClient.invalidateQueries({ queryKey: openclawKeys.agents });
      queryClient.invalidateQueries({ queryKey: openclawKeys.agentsDefaults });
    },
    onError: (error) => {
      agentsLogger.error("❌ 更新 Agent 模型失败", error);
    },
  });
}

/**
 * Backup an Agent instance.
 */
export function useBackupAgent() {
  return useMutation({
    mutationFn: (id: string) => {
      agentsLogger.action("备份 Agent", { id });
      return openclawApi.backupAgent(id);
    },
    onSuccess: (zipPath) => {
      agentsLogger.info("✅ Agent 备份完成", { zipPath });
    },
    onError: (error) => {
      agentsLogger.error("❌ 备份 Agent 失败", error);
    },
  });
}

// ============================================================
// Gateway Configuration Hooks
// ============================================================

/**
 * Query gateway config section of openclaw.json.
 */
export function useOpenClawGateway() {
  return useQuery({
    queryKey: openclawKeys.gateway,
    queryFn: () => openclawApi.getGatewayConfig(),
    staleTime: 30_000,
  });
}

/**
 * Save gateway config. Invalidates gateway query on success.
 * After saving, automatically attempts to reload the gateway service.
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawGateway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (gateway: OpenClawGatewayConfig) => {
      await openclawApi.setGatewayConfig(gateway);
      // Best-effort reload — ignore errors (caller shows toast)
      try {
        await openclawApi.reloadGateway();
      } catch (_) {
        // reload not supported or failed — caller handles fallback
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: openclawKeys.gateway });
    },
  });
}
