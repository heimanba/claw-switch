import { useMemo, useState, useEffect, useRef } from "react";
import { GripVertical, ChevronDown, ChevronUp, Layers, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import type { Provider, OpenClawProviderConfig } from "@/types";
import type { AppId } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ProviderActions } from "@/components/providers/ProviderActions";
import { ProviderIcon } from "@/components/ProviderIcon";
import UsageFooter from "@/components/UsageFooter";
import { ProviderHealthBadge } from "@/components/providers/ProviderHealthBadge";
import { FailoverPriorityBadge } from "@/components/providers/FailoverPriorityBadge";
import { useProviderHealth } from "@/lib/query/failover";
import { useUsageQuery } from "@/lib/query/queries";

interface DragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  isDragging: boolean;
}

interface ProviderCardProps {
  provider: Provider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig?: boolean; // OpenCode: 是否已添加到 opencode.json
  isOmo?: boolean;
  isOmoSlim?: boolean;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onConfigureUsage: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onDuplicate: (provider: Provider) => void;
  onTest?: (provider: Provider) => void;
  onOpenTerminal?: (provider: Provider) => void;
  isTesting?: boolean;
  isProxyRunning: boolean;
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管，切换为热切换）
  dragHandleProps?: DragHandleProps;
  isAutoFailoverEnabled?: boolean; // 是否开启自动故障转移
  failoverPriority?: number; // 故障转移优先级（1 = P1, 2 = P2, ...）
  isInFailoverQueue?: boolean; // 是否在故障转移队列中
  onToggleFailover?: (enabled: boolean) => void; // 切换故障转移队列
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  // OpenClaw: default model
  isDefaultModel?: boolean;
  onSetAsDefault?: () => void;
  // 本地配置文件是否存在（文件不存在时允许删除"使用中"的供应商）
  liveConfigExists?: boolean;
  // CLI 是否已安装（未安装时允许删除"使用中"的供应商）
  isCliInstalled?: boolean;
  // OpenClaw: open model management side panel
  onManageModels?: (provider: Provider) => void;
}

const extractApiUrl = (provider: Provider, fallbackText: string) => {
  if (provider.notes?.trim()) {
    return provider.notes.trim();
  }

  if (provider.websiteUrl) {
    return provider.websiteUrl;
  }

  const config = provider.settingsConfig;

  if (config && typeof config === "object") {
    const envBase =
      (config as Record<string, any>)?.env?.ANTHROPIC_BASE_URL ||
      (config as Record<string, any>)?.env?.GOOGLE_GEMINI_BASE_URL;
    if (typeof envBase === "string" && envBase.trim()) {
      return envBase;
    }

    const baseUrl = (config as Record<string, any>)?.config;

    if (typeof baseUrl === "string" && baseUrl.includes("base_url")) {
      const match = baseUrl.match(/base_url\s*=\s*['"]([^'"]+)['"]/);
      if (match?.[1]) {
        return match[1];
      }
    }
  }

  return fallbackText;
};

export function ProviderCard({
  provider,
  isCurrent,
  appId,
  isInConfig = true,
  isOmo = false,
  isOmoSlim = false,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onConfigureUsage,
  onOpenWebsite,
  onDuplicate,
  onTest,
  onOpenTerminal,
  isTesting,
  isProxyRunning,
  isProxyTakeover = false,
  dragHandleProps,
  isAutoFailoverEnabled = false,
  failoverPriority,
  isInFailoverQueue = false,
  onToggleFailover,
  activeProviderId,
  // OpenClaw: default model
  isDefaultModel,
  onSetAsDefault,
  liveConfigExists = true,
  isCliInstalled = true,
  onManageModels,
}: ProviderCardProps) {
  const { t } = useTranslation();

  // OMO and OMO Slim share the same card behavior
  const isAnyOmo = isOmo || isOmoSlim;
  const handleDisableAnyOmo = isOmoSlim ? onDisableOmoSlim : onDisableOmo;

  const { data: health } = useProviderHealth(provider.id, appId);

  const fallbackUrlText = t("provider.notConfigured", {
    defaultValue: "未配置接口地址",
  });

  const displayUrl = useMemo(() => {
    return extractApiUrl(provider, fallbackUrlText);
  }, [provider, fallbackUrlText]);

  const isClickableUrl = useMemo(() => {
    if (provider.notes?.trim()) {
      return false;
    }
    if (displayUrl === fallbackUrlText) {
      return false;
    }
    return true;
  }, [provider.notes, displayUrl, fallbackUrlText]);

  const usageEnabled = provider.meta?.usage_script?.enabled ?? false;

  // 获取用量数据以判断是否有多套餐
  // 累加模式应用（OpenCode/OpenClaw）：使用 isInConfig 代替 isCurrent
  const shouldAutoQuery =
    appId === "opencode" || appId === "openclaw" ? isInConfig : isCurrent;
  const autoQueryInterval = shouldAutoQuery
    ? provider.meta?.usage_script?.autoQueryInterval || 0
    : 0;

  const { data: usage } = useUsageQuery(provider.id, appId, {
    enabled: usageEnabled,
    autoQueryInterval,
  });

  const hasMultiplePlans =
    usage?.success && usage.data && usage.data.length > 1;

  const [isExpanded, setIsExpanded] = useState(false);

  const actionsRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (hasMultiplePlans) {
      setIsExpanded(true);
    }
  }, [hasMultiplePlans]);

  const handleOpenWebsite = () => {
    if (!isClickableUrl) {
      return;
    }
    onOpenWebsite(displayUrl);
  };

  // 判断是否是"当前使用中"的供应商
  // - OMO/OMO Slim 供应商：使用 isCurrent
  // - 累加模式应用（OpenCode 非 OMO / OpenClaw）：不存在"当前"概念，始终返回 false
  // - 故障转移模式：代理实际使用的供应商（activeProviderId）
  // - 普通模式：isCurrent
  const isActiveProvider = isAnyOmo
    ? isCurrent
    : appId === "opencode" || appId === "openclaw"
      ? false
      : isAutoFailoverEnabled
        ? activeProviderId === provider.id
        : isCurrent;

  const shouldUseGreen = !isAnyOmo && isProxyTakeover && isActiveProvider;
  const shouldUseBlue =
    (isAnyOmo && isActiveProvider) ||
    (!isAnyOmo && !isProxyTakeover && isActiveProvider);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border-subtle p-4 transition-smooth",
        "bg-bg-card text-text-primary group",
        isAutoFailoverEnabled || isProxyTakeover
          ? "hover:border-emerald-500/50"
          : "hover:border-border-focus",
        shouldUseGreen &&
          "border-emerald-500/60 shadow-sm shadow-emerald-500/10",
        shouldUseBlue && "border-accent/50 shadow-sm",
        !isActiveProvider && "hover:shadow-sm",
        dragHandleProps?.isDragging &&
          "cursor-grabbing border-accent shadow-lg scale-105 z-10",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r to-transparent transition-smooth pointer-events-none",
          shouldUseGreen && "from-emerald-500/8",
          shouldUseBlue && "from-accent/8",
          isActiveProvider ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <button
            type="button"
            className={cn(
              "-ml-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing p-1.5",
              "text-text-tertiary/60 hover:text-text-muted transition-smooth",
              dragHandleProps?.isDragging && "cursor-grabbing",
            )}
            aria-label={t("provider.dragHandle")}
            {...(dragHandleProps?.attributes ?? {})}
            {...(dragHandleProps?.listeners ?? {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="h-8 w-8 rounded-lg bg-bg-secondary flex items-center justify-center border border-border-subtle group-hover:scale-105 transition-smooth">
            <ProviderIcon
              icon={provider.icon}
              name={provider.name}
              color={provider.iconColor}
              size={20}
            />
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 min-h-7">
              <h3 className="text-base font-semibold leading-none text-text-primary">
                {provider.name}
              </h3>

              {isOmo && (
                <span className="inline-flex items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  OMO
                </span>
              )}

              {isOmoSlim && (
                <span className="inline-flex items-center rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  Slim
                </span>
              )}

              {isProxyRunning && isInFailoverQueue && health && (
                <ProviderHealthBadge
                  consecutiveFailures={health.consecutive_failures}
                />
              )}

              {isAutoFailoverEnabled &&
                isInFailoverQueue &&
                failoverPriority && (
                  <FailoverPriorityBadge priority={failoverPriority} />
                )}

              {provider.category === "third_party" &&
                provider.meta?.isPartner && (
                  <span
                    className="text-yellow-500 dark:text-yellow-400"
                    title={t("provider.officialPartner", {
                      defaultValue: "官方合作伙伴",
                    })}
                  >
                    ⭐
                  </span>
                )}
            </div>

            {displayUrl && (
              <button
                type="button"
                onClick={handleOpenWebsite}
                className={cn(
                  "inline-flex items-center text-sm max-w-[280px]",
                  isClickableUrl
                    ? "text-accent transition-smooth hover:underline cursor-pointer"
                    : "text-text-muted cursor-default",
                )}
                title={displayUrl}
                disabled={!isClickableUrl}
              >
                <span className="truncate">{displayUrl}</span>
              </button>
            )}
          </div>
        </div>

        <div
          className="flex items-center ml-auto min-w-0 gap-3"
        >
          {/* Usage info - hidden on hover to give room to actions on small screens */}
          <div className="hidden sm:block transition-opacity duration-200 group-hover:opacity-0 group-focus-within:opacity-0 pointer-events-none group-hover:pointer-events-none">
            {hasMultiplePlans ? (
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span className="font-medium">
                  {t("usage.multiplePlans", {
                    count: usage?.data?.length || 0,
                    defaultValue: `${usage?.data?.length || 0} 个套餐`,
                  })}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400 flex-shrink-0"
                  title={
                    isExpanded
                      ? t("usage.collapse", { defaultValue: "收起" })
                      : t("usage.expand", { defaultValue: "展开" })
                  }
                >
                  {isExpanded ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
              </div>
            ) : (
              <UsageFooter
                provider={provider}
                providerId={provider.id}
                appId={appId}
                usageEnabled={usageEnabled}
                isCurrent={isCurrent}
                isInConfig={isInConfig}
                inline={true}
              />
            )}
          </div>

          {/* Actions - always present, low-opacity at rest, full opacity on hover */}
          <div
            ref={actionsRef}
            className="flex items-center gap-1.5 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
          >
            <ProviderActions
              appId={appId}
              isCurrent={isCurrent}
              isInConfig={isInConfig}
              isTesting={isTesting}
              isProxyTakeover={isProxyTakeover}
              isOmo={isAnyOmo}
              onSwitch={() => onSwitch(provider)}
              onEdit={() => onEdit(provider)}
              onDuplicate={() => onDuplicate(provider)}
              onTest={onTest ? () => onTest(provider) : undefined}
              onConfigureUsage={() => onConfigureUsage(provider)}
              onDelete={() => onDelete(provider)}
              onRemoveFromConfig={
                onRemoveFromConfig
                  ? () => onRemoveFromConfig(provider)
                  : undefined
              }
              onDisableOmo={handleDisableAnyOmo}
              onOpenTerminal={
                onOpenTerminal ? () => onOpenTerminal(provider) : undefined
              }
              isAutoFailoverEnabled={isAutoFailoverEnabled}
              isInFailoverQueue={isInFailoverQueue}
              onToggleFailover={onToggleFailover}
              // OpenClaw: default model
              isDefaultModel={isDefaultModel}
              onSetAsDefault={onSetAsDefault}
              liveConfigExists={liveConfigExists}
              isCliInstalled={isCliInstalled}
            />
          </div>
        </div>
      </div>

      {isExpanded && hasMultiplePlans && (
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <UsageFooter
            provider={provider}
            providerId={provider.id}
            appId={appId}
            usageEnabled={usageEnabled}
            isCurrent={isCurrent}
            isInConfig={isInConfig}
            inline={false}
          />
        </div>
      )}

      {/* OpenClaw: model summary row */}
      {appId === "openclaw" && (() => {
        const cfg = provider.settingsConfig as OpenClawProviderConfig | undefined;
        const modelList = Array.isArray(cfg?.models) ? cfg.models : [];
        const MAX_SHOW = 3;
        const shown = modelList.slice(0, MAX_SHOW);
        const extra = modelList.length - MAX_SHOW;
        // 只显示模型 ID 中最后一段（去掉 provider/ 前缀），完整路径保留在 tooltip
        const shortName = (id: string) => id.includes("/") ? id.split("/").pop()! : id;
        return (
          <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <Layers className="w-3 h-3 text-text-muted flex-shrink-0" />
              {modelList.length === 0 ? (
                <span className="text-xs text-text-muted">
                  {t("openclaw.panel.noModels", { defaultValue: "暂无模型" })}
                </span>
              ) : (
                <>
                  {shown.map((m, i) => (
                    <span
                      key={m.id || i}
                      className={cn(
                        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono border",
                        isDefaultModel && i === 0
                          ? "bg-amber-50 border-amber-300/60 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                          : "bg-bg-secondary border-border-subtle text-text-muted",
                      )}
                      title={m.id}
                    >
                      {isDefaultModel && i === 0 && (
                        <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500 flex-shrink-0" />
                      )}
                      {shortName(m.id || m.name)}
                    </span>
                  ))}
                  {extra > 0 && (
                    <span className="text-[10px] text-text-muted">
                      +{extra}
                    </span>
                  )}
                </>
              )}
            </div>
            {onManageModels && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManageModels(provider);
                }}
                className="flex-shrink-0 text-[10px] text-accent hover:underline cursor-pointer whitespace-nowrap"
              >
                {t("openclaw.panel.manageModels", { defaultValue: "管理模型" })}
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
