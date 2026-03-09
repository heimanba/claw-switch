import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import ModelConfigCard from "@/components/openclaw/ModelConfigCard";
import { OpenClawModelPanel } from "@/components/openclaw/OpenClawModelPanel";
import { useQuery } from "@tanstack/react-query";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { useDragSort } from "@/hooks/useDragSort";
import {
  useOpenClawLiveProviderIds,
  useOpenClawDefaultModel,
  useOpenClawAgentsDefaults,
  useOpenClawProviderModels,
} from "@/hooks/useOpenClaw";
// import { useStreamCheck } from "@/hooks/useStreamCheck"; // 测试功能已隐藏
import { ProviderCard } from "@/components/providers/ProviderCard";
import {
  useAutoFailoverEnabled,
  useFailoverQueue,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
} from "@/lib/query/failover";
import {
  useCurrentOmoProviderId,
  useCurrentOmoSlimProviderId,
} from "@/lib/query/omo";
import { useLiveConfigExistsQuery, useToolVersionQuery } from "@/lib/query/queries";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OnboardingChecklist } from "@/components/providers/OnboardingChecklist";

interface ProviderListProps {
  providers: Record<string, Provider>;
  currentProviderId: string;
  appId: AppId;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onCreate?: () => void;
  isLoading?: boolean;
  isProxyRunning?: boolean; // 代理服务运行状态
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管）
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  onSetAsDefault?: (provider: Provider) => void; // OpenClaw: set as default model
  /** OpenClaw: navigate to agents defaults panel */
  onNavigateToAgents?: () => void;
  /** OpenClaw: 一键添加百炼 Coding Plan 预设（传入用户填写的 API Key） */
  onQuickAddCodingPlan?: (apiKey: string) => void;
  /** When false and no providers, show minimal empty state instead of OnboardingChecklist (use when onboarding is rendered above by parent) */
  embedOnboardingWhenEmpty?: boolean;
  /** 控制 OnboardingChecklist 是否显示（纯实时检测模式） */
  onboardingVisible?: boolean;
  onOnboardingClose?: () => void;
}

export function ProviderList({
  providers,
  currentProviderId,
  appId,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onCreate,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  activeProviderId,
  onSetAsDefault,
  onNavigateToAgents,
  onQuickAddCodingPlan,
  embedOnboardingWhenEmpty = true,
  onboardingVisible = true,
  onOnboardingClose,
}: ProviderListProps) {
  const { t } = useTranslation();
  const { sortedProviders, sensors, handleDragEnd } = useDragSort(
    providers,
    appId,
  );

  const { data: opencodeLiveIds } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode",
  });

  // OpenClaw: 查询 live 配置中的供应商 ID 列表，用于判断 isInConfig
  const { data: openclawLiveIds } = useOpenClawLiveProviderIds(
    appId === "openclaw",
  );

  // 判断供应商是否已添加到配置（累加模式应用：OpenCode/OpenClaw）
  const isProviderInConfig = useCallback(
    (providerId: string): boolean => {
      if (appId === "opencode") {
        return opencodeLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "openclaw") {
        return openclawLiveIds?.includes(providerId) ?? false;
      }
      return true; // 其他应用始终返回 true
    },
    [appId, opencodeLiveIds, openclawLiveIds],
  );

  // 查询本地配置文件是否存在，用于判断"使用中"的供应商是否允许删除
  const { data: liveConfigExists = true } = useLiveConfigExistsQuery(appId);

  // 查询 CLI 安装状态，用于判断"使用中"的供应商是否允许删除
  // opencode/openclaw 为累加模式，不需要此检查；opencode 的 omo 模式也不需要
  const isAdditiveApp = appId === "opencode" || appId === "openclaw";
  const { data: toolVersionData } = useToolVersionQuery(
    isAdditiveApp ? "" : appId,
  );
  // CLI 已安装：版本信息不为 null
  const isCliInstalled = isAdditiveApp ? true : toolVersionData !== undefined
    ? toolVersionData !== null && toolVersionData.version !== null
    : true; // 查询中时默认 true，避免误判

  // OpenClaw: query default model to determine which provider is default
  const { data: openclawDefaultModel } = useOpenClawDefaultModel(
    appId === "openclaw",
  );

  // OpenClaw: query agents.defaults and provider models to validate model config
  // Always refetch on mount so manual edits to openclaw.json are reflected immediately
  const { refetch: refetchAgentsDefaults } =
    useOpenClawAgentsDefaults();
  const {
    refetch: refetchProviderModels,
  } = useOpenClawProviderModels(appId === "openclaw");

  useEffect(() => {
    if (appId !== "openclaw") return;
    refetchAgentsDefaults();
    refetchProviderModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  // OpenClaw: 仅有一个供应商且未配置默认模型时，自动将该供应商设为默认
  // 注意：只在 primary 为空时才自动设置，避免覆盖用户手动配置的主模型
  const openclawAutoSetDefaultAttemptedRef = useRef(false);
  useEffect(() => {
    if (appId !== "openclaw" || !onSetAsDefault) return;
    const list = Object.values(providers);
    if (list.length !== 1) return;
    const provider = list[0];
    const config = provider.settingsConfig as { models?: { id: string }[] } | undefined;
    if (!config?.models?.length) return;
    if (openclawAutoSetDefaultAttemptedRef.current) return;
    // 已有 primary 模型时不自动覆盖
    if (openclawDefaultModel?.primary) return;
    openclawAutoSetDefaultAttemptedRef.current = true;
    onSetAsDefault(provider);
  }, [
    appId,
    onSetAsDefault,
    providers,
    openclawDefaultModel,
  ]);


  const isProviderDefaultModel = useCallback(
    (providerId: string): boolean => {
      if (appId !== "openclaw" || !openclawDefaultModel?.primary) return false;
      return openclawDefaultModel.primary.startsWith(providerId + "/");
    },
    [appId, openclawDefaultModel],
  );

  // 故障转移相关
  const { data: isAutoFailoverEnabled } = useAutoFailoverEnabled(appId);
  const { data: failoverQueue } = useFailoverQueue(appId);
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();

  const isFailoverModeActive =
    isProxyTakeover === true && isAutoFailoverEnabled === true;

  const isOpenCode = appId === "opencode";
  const { data: currentOmoId } = useCurrentOmoProviderId(isOpenCode);
  const { data: currentOmoSlimId } = useCurrentOmoSlimProviderId(isOpenCode);

  const getFailoverPriority = useCallback(
    (providerId: string): number | undefined => {
      if (!isFailoverModeActive || !failoverQueue) return undefined;
      const index = failoverQueue.findIndex(
        (item) => item.providerId === providerId,
      );
      return index >= 0 ? index + 1 : undefined;
    },
    [isFailoverModeActive, failoverQueue],
  );

  const isInFailoverQueue = useCallback(
    (providerId: string): boolean => {
      if (!isFailoverModeActive || !failoverQueue) return false;
      return failoverQueue.some((item) => item.providerId === providerId);
    },
    [isFailoverModeActive, failoverQueue],
  );

  const handleToggleFailover = useCallback(
    (providerId: string, enabled: boolean) => {
      if (enabled) {
        addToQueue.mutate({ appType: appId, providerId });
      } else {
        removeFromQueue.mutate({ appType: appId, providerId });
      }
    },
    [appId, addToQueue, removeFromQueue],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // OpenClaw: side panel for model management
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  const filteredProviders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return sortedProviders;
    return sortedProviders.filter((provider) => {
      const fields = [provider.name, provider.notes, provider.websiteUrl];
      return fields.some((field) =>
        field?.toString().toLowerCase().includes(keyword),
      );
    });
  }, [searchTerm, sortedProviders]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="w-full border border-dashed rounded-lg h-28 border-border-subtle bg-bg-secondary/40"
          />
        ))}
      </div>
    );
  }

  if (sortedProviders.length === 0) {
    if (embedOnboardingWhenEmpty) {
      return (
        <div className="mt-4">
          <OnboardingChecklist
            appId={appId}
            hasProviders={false}
            providers={providers}
            onCreate={onCreate}
            visible={onboardingVisible}
            onClose={onOnboardingClose}
            onQuickAddCodingPlan={appId === "openclaw" ? onQuickAddCodingPlan : undefined}
          />
        </div>
      );
    }
    return (
      <div className="mt-4 rounded-lg border border-dashed border-border-subtle bg-bg-secondary/30 px-6 py-8 text-center">
        <p className="text-sm text-text-muted mb-3">
          {t("provider.noProvidersInList", {
            defaultValue: "暂无供应商，完成上方引导或点击新建",
          })}
        </p>
        <div className="flex items-center justify-center gap-2">
          {onCreate && (
            <Button size="sm" onClick={onCreate}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              {t("onboarding.steps.addProvider.createButton", {
                defaultValue: "新建",
              })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const renderProviderList = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={filteredProviders.map((provider) => provider.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {filteredProviders.map((provider) => {
            const isOmo = provider.category === "omo";
            const isOmoSlim = provider.category === "omo-slim";
            const isOmoCurrent = isOmo && provider.id === (currentOmoId || "");
            const isOmoSlimCurrent =
              isOmoSlim && provider.id === (currentOmoSlimId || "");
            return (
              <SortableProviderCard
                key={provider.id}
                provider={provider}
                isCurrent={
                  isOmo
                    ? isOmoCurrent
                    : isOmoSlim
                      ? isOmoSlimCurrent
                      : provider.id === currentProviderId
                }
                appId={appId}
                isInConfig={isProviderInConfig(provider.id)}
                isOmo={isOmo}
                isOmoSlim={isOmoSlim}
                liveConfigExists={liveConfigExists}
                isCliInstalled={isCliInstalled}
                onSwitch={onSwitch}
                onEdit={onEdit}
                onDelete={onDelete}
                onRemoveFromConfig={onRemoveFromConfig}
                onDisableOmo={onDisableOmo}
                onDisableOmoSlim={onDisableOmoSlim}
                onDuplicate={onDuplicate}
                onConfigureUsage={onConfigureUsage}
                onOpenWebsite={onOpenWebsite}
                onOpenTerminal={onOpenTerminal}
                isTesting={false} // isChecking(provider.id) - 测试功能已隐藏
                isProxyRunning={isProxyRunning}
                isProxyTakeover={isProxyTakeover}
                isAutoFailoverEnabled={isFailoverModeActive}
                failoverPriority={getFailoverPriority(provider.id)}
                isInFailoverQueue={isInFailoverQueue(provider.id)}
                onToggleFailover={(enabled) =>
                  handleToggleFailover(provider.id, enabled)
                }
                activeProviderId={activeProviderId}
                // OpenClaw: default model
                isDefaultModel={isProviderDefaultModel(provider.id)}
                onSetAsDefault={
                  onSetAsDefault ? () => onSetAsDefault(provider) : undefined
                }
                // OpenClaw: model management panel
                onManageModels={appId === "openclaw" ? setManagingProvider : undefined}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );

  // OpenClaw: check if primary model is not configured — now handled by ModelConfigCard
  // (kept as dead variable guard to avoid removing isOpenClawModelNotConfigured usage)

  return (
    <div className="mt-4 space-y-4">
      {/* OpenClaw: ModelConfigCard — 主模型 / 回退模型配置 + Coding Plan Banner */}
      {appId === "openclaw" && (
        <ModelConfigCard
          isCodingPlanAdded={Object.values(providers).some((p) => p.name === "Coding Plan")}
          onQuickAddCodingPlan={onQuickAddCodingPlan}
        />
      )}

      {/* OpenClaw: model management side panel */}
      {appId === "openclaw" && (
        <OpenClawModelPanel
          provider={managingProvider}
          onClose={() => setManagingProvider(null)}
        />
      )}

      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            key="provider-search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-[6.5rem] z-40 w-[min(90vw,26rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0"
          >
            <div className="p-4 space-y-3 border shadow-lg rounded-2xl border-border-subtle bg-bg-card shadow-black/8">
              <div className="relative flex items-center gap-2">
                <Search className="absolute w-4 h-4 -translate-y-1/2 pointer-events-none left-3 top-1/2 text-text-muted" />
                <Input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t("provider.searchPlaceholder", {
                    defaultValue: "Search name, notes, or URL...",
                  })}
                  aria-label={t("provider.searchAriaLabel", {
                    defaultValue: "Search providers",
                  })}
                  className="pr-16 pl-9"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute text-xs -translate-y-1/2 right-11 top-1/2"
                    onClick={() => setSearchTerm("")}
                  >
                    {t("common.clear", { defaultValue: "Clear" })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => setIsSearchOpen(false)}
                  aria-label={t("provider.searchCloseAriaLabel", {
                    defaultValue: "Close provider search",
                  })}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
                <span>
                  {t("provider.searchScopeHint", {
                    defaultValue: "Matches provider name, notes, and URL.",
                  })}
                </span>
                <span>
                  {t("provider.searchCloseHint", {
                    defaultValue: "Press Esc to close",
                  })}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filteredProviders.length === 0 ? (
        <div className="px-6 py-8 text-sm text-center border border-dashed rounded-lg border-border-subtle text-text-muted">
          {t("provider.noSearchResults", {
            defaultValue: "No providers match your search.",
          })}
        </div>
      ) : (
        renderProviderList()
      )}
    </div>
  );
}

interface SortableProviderCardProps {
  provider: Provider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig: boolean;
  isOmo: boolean;
  isOmoSlim: boolean;
  liveConfigExists: boolean;
  isCliInstalled?: boolean;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onTest?: (provider: Provider) => void;
  isTesting: boolean;
  isProxyRunning: boolean;
  isProxyTakeover: boolean;
  isAutoFailoverEnabled: boolean;
  failoverPriority?: number;
  isInFailoverQueue: boolean;
  onToggleFailover: (enabled: boolean) => void;
  activeProviderId?: string;
  // OpenClaw: default model
  isDefaultModel?: boolean;
  onSetAsDefault?: () => void;
  // OpenClaw: model management panel
  onManageModels?: (provider: Provider) => void;
}

function SortableProviderCard({
  provider,
  isCurrent,
  appId,
  isInConfig,
  isOmo,
  isOmoSlim,
  liveConfigExists,
  isCliInstalled,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onTest,
  isTesting,
  isProxyRunning,
  isProxyTakeover,
  isAutoFailoverEnabled,
  failoverPriority,
  isInFailoverQueue,
  onToggleFailover,
  activeProviderId,
  isDefaultModel,
  onSetAsDefault,
  onManageModels,
}: SortableProviderCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProviderCard
        provider={provider}
        isCurrent={isCurrent}
        appId={appId}
        isInConfig={isInConfig}
        isOmo={isOmo}
        isOmoSlim={isOmoSlim}
        liveConfigExists={liveConfigExists}
        isCliInstalled={isCliInstalled}
        onSwitch={onSwitch}
        onEdit={onEdit}
        onDelete={onDelete}
        onRemoveFromConfig={onRemoveFromConfig}
        onDisableOmo={onDisableOmo}
        onDisableOmoSlim={onDisableOmoSlim}
        onDuplicate={onDuplicate}
        onConfigureUsage={
          onConfigureUsage ? (item) => onConfigureUsage(item) : () => undefined
        }
        onOpenWebsite={onOpenWebsite}
        onOpenTerminal={onOpenTerminal}
        onTest={onTest}
        isTesting={isTesting}
        isProxyRunning={isProxyRunning}
        isProxyTakeover={isProxyTakeover}
        dragHandleProps={{
          attributes,
          listeners,
          isDragging,
        }}
        isAutoFailoverEnabled={isAutoFailoverEnabled}
        failoverPriority={failoverPriority}
        isInFailoverQueue={isInFailoverQueue}
        onToggleFailover={onToggleFailover}
        activeProviderId={activeProviderId}
        // OpenClaw: default model
        isDefaultModel={isDefaultModel}
        onSetAsDefault={onSetAsDefault}
        // OpenClaw: model management panel
        onManageModels={onManageModels}
      />
    </div>
  );
}
