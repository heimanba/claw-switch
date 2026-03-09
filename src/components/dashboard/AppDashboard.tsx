import { useMemo, useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  AlertTriangle,
  Apple,
  Bell,
  CheckCircle,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Download,
  FolderOpen,
  FlaskConical,
  Hash,
  History,
  KeyRound,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Shield,
  Slack,
  Users,
  XCircle,
  Loader2,
  Terminal,
  RefreshCw,
  Wrench,
  Plus,
  Lock,
  Play,
  Square,
  RotateCcw,
  Stethoscope,
  Trash2,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToolVersionQuery } from "@/lib/query/queries";
import {
  install,
  openTerminalInstall,
  cancel as cancelInstall,
  uninstall,
  openTerminalUninstall,
  cancelUninstall,
  canUninstall,
} from "@/lib/cliInstaller";
import { settingsApi } from "@/lib/api";
import { openclawApi } from "@/lib/api/openclaw";
import {
  useInstallState,
  setInstalling,
  setInstallError,
  resetInstallState,
  useUninstallState,
  setUninstalling,
  setUninstallError,
  resetUninstallState,
} from "@/stores/installStore";
import { useOpenClawServiceDetail, useOpenClawChannels, useStartOpenClawService } from "@/hooks/useOpenClaw";
import { serviceLogger } from "@/lib/logger";

export type DashboardQuickAction =
  | "skills"
  | "prompts"
  | "mcp"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawGateway"
  | "agents"
  | "openclawTesting"
  | "openclawChannels"
  | "openclawSkills"
  | "providers";

export interface AppOverviewProps {
  activeApp: AppId;
  providers: Record<string, Provider>;
  isLoading?: boolean;
  isProxyRunning?: boolean;
  isProxyTakeover?: boolean;
  onOpenAction?: (action: DashboardQuickAction) => void;
}


interface CapabilityCardDef {
  id: DashboardQuickAction;
  icon: React.ElementType;
}

function getCapabilityCards(appId: AppId): CapabilityCardDef[] {
  if (appId === "openclaw") {
    return [
      { id: "providers", icon: Users },
      { id: "workspace", icon: FolderOpen },
      { id: "openclawEnv", icon: KeyRound },
      { id: "openclawTools", icon: Shield },
      { id: "agents", icon: Cpu },
      { id: "openclawTesting", icon: FlaskConical },
      { id: "openclawChannels", icon: MessageCircle },
      { id: "sessions", icon: History },
    ];
  }

  const cards: CapabilityCardDef[] = [
    { id: "providers", icon: Users },
    // { id: "prompts", icon: FileText },
    { id: "skills", icon: Wrench },
    // { id: "mcp", icon: Server },  // MCP 管理已隐藏
  ];

  const sessionsApps: AppId[] = ["claude", "codex", "opencode", "gemini"];
  if (sessionsApps.includes(appId)) {
    cards.push({ id: "sessions", icon: History });
  }

  return cards;
}

export function AppDashboard({
  activeApp,
  providers,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  onOpenAction,
}: AppOverviewProps) {
  const { t } = useTranslation();

  // 从全局 store 读取安装/卸载状态（切换 Tab 后状态保留）
  const installState = useInstallState(activeApp);
  const uninstallState = useUninstallState(activeApp);

  const [cliInstalledLocally, setCliInstalledLocally] = useState(false);
  const [cliUninstalledLocally, setCliUninstalledLocally] = useState(false);
  const [cliCheckLoading, setCliCheckLoading] = useState(true);
  const [cliEnv, setCliEnv] = useState<{
    has_node: boolean;
    node_version: string | null;
    node_version_ok: boolean;
    has_cli: boolean;
    cli_version: string | null;
  } | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [uninstallConfirming, setUninstallConfirming] = useState(false);
  const [cliManageOpen, setCliManageOpen] = useState(false);

  // OpenClaw service control state
  const [serviceActionLoading, setServiceActionLoading] = useState(false);
  

  const isOpenClaw = activeApp === "openclaw";

  // Poll openclaw service detail (only when openclaw tab is active)
  const { data: openclawServiceDetail, refetch: refetchServiceDetail } = useOpenClawServiceDetail(isOpenClaw);

  // Query channel configs for overview card (only when openclaw tab is active)
  const { data: openclawChannels } = useOpenClawChannels(isOpenClaw);

  const startOpenClawService = useStartOpenClawService();

  const { data: toolVersion, refetch: refetchToolVersion, isLoading: isToolVersionLoading } = useToolVersionQuery(
    activeApp === "claude" ? "claude" :
    activeApp === "codex" ? "codex" :
    activeApp === "gemini" ? "gemini" :
    activeApp === "opencode" ? "opencode" :
    activeApp === "qwen" ? "qwen" :
    activeApp === "openclaw" ? "openclaw" :
    activeApp === "cline" ? "cline" : ""
  );

  const isCliInstalled = cliUninstalledLocally ? false : !!toolVersion?.version || cliInstalledLocally;
  const effectiveCliInstalled =
    cliUninstalledLocally
      ? false
      : activeApp === "qwen" && cliEnv
      ? cliEnv.has_cli || isCliInstalled
      : isCliInstalled;
  // 只有当 toolVersion 还在加载中（且 cliEnv 也没有结果）时才显示骨架屏
  // toolVersion 查询完成后（返回 null 或有值），可以立即渲染，不必等 cliEnv
  const isCheckingCli = isToolVersionLoading && !cliEnv;
  const providerReady = Object.keys(providers).length > 0;

  const handleInstall = useCallback(async () => {
    if (installState.isInstalling) return;
    await install({
      appId: activeApp,
      onComplete: (payload) => {
        setInstalling(activeApp, false);
        toast.success(t("overview.cli.installSuccess"));
        if (payload?.globalBinPath) {
          toast.info(
            t("overview.cli.pathHint", {
              defaultValue: "若终端中无法运行命令，请将以下目录加入 PATH（或重新打开终端）：",
            }) + ` ${payload.globalBinPath}`,
            { duration: 8000 }
          );
        }
        setCliUninstalledLocally(false);
        setCliInstalledLocally(true);
        refetchToolVersion();
      },
      onError: (error) => {
        setInstallError(activeApp, error);
      },
    });
  }, [activeApp, installState.isInstalling, refetchToolVersion, t]);

  const handleCancelInstall = useCallback(() => {
    cancelInstall();
    resetInstallState(activeApp);
  }, [activeApp]);

  const handleManualInstall = useCallback(async () => {
    try {
      await openTerminalInstall(activeApp);
      setInstallError(activeApp, null);
    } catch (error) {
      console.error("[AppDashboard] 打开终端失败:", error);
    }
  }, [activeApp]);

  const handleRetry = useCallback(() => {
    setInstallError(activeApp, null);
    handleInstall();
  }, [activeApp, handleInstall]);

  const handleUninstall = useCallback(async () => {
    if (uninstallState.isUninstalling || !canUninstall(activeApp)) return;
    setUninstallConfirming(false);
    await uninstall({
      appId: activeApp,
      onComplete: () => {
        setUninstalling(activeApp, false);
        toast.success(t("overview.cli.uninstallSuccess"));
        setCliUninstalledLocally(true);
        setCliInstalledLocally(false);
        refetchToolVersion();
        setCliManageOpen(false);
      },
      onError: (err) => {
        setUninstallError(activeApp, err);
      },
    });
  }, [activeApp, uninstallState.isUninstalling, refetchToolVersion, t]);

  const handleCancelUninstall = useCallback(() => {
    cancelUninstall();
    resetUninstallState(activeApp);
  }, [activeApp]);

  const handleManualUninstall = useCallback(async () => {
    try {
      await openTerminalUninstall(activeApp);
      setUninstallError(activeApp, null);
    } catch (error) {
      console.error("[AppDashboard] 打开终端失败:", error);
    }
  }, [activeApp]);

  const handleUninstallRetry = useCallback(() => {
    setUninstallError(activeApp, null);
    handleUninstall();
  }, [activeApp, handleUninstall]);

  // OpenClaw service action handlers（启动已抽到 useStartOpenClawService，与横幅共用）
  const handleServiceStop = useCallback(async () => {
    if (serviceActionLoading) return;
    serviceLogger.action("停止服务");
    serviceLogger.info("正在停止服务...");
    setServiceActionLoading(true);
    try {
      await openclawApi.stopService();
      await refetchServiceDetail();
      serviceLogger.info("✅ 服务已停止");
      toast.success(t("overview.openclaw.serviceStopped"));
    } catch (e) {
      serviceLogger.error("❌ 服务停止失败", e);
      toast.error(typeof e === "string" ? e : t("overview.openclaw.serviceStopFailed"));
    } finally {
      setServiceActionLoading(false);
    }
  }, [serviceActionLoading, refetchServiceDetail]);

  const handleServiceRestart = useCallback(async () => {
    if (serviceActionLoading) return;
    serviceLogger.action("重启服务");
    serviceLogger.info("正在重启服务...");
    setServiceActionLoading(true);
    try {
      await openclawApi.restartService();
      await refetchServiceDetail();
      serviceLogger.info("✅ 服务已重启");
      toast.success(t("overview.openclaw.serviceRestarted"));
    } catch (e) {
      serviceLogger.error("❌ 服务重启失败", e);
      toast.error(typeof e === "string" ? e : t("overview.openclaw.serviceRestartFailed"));
    } finally {
      setServiceActionLoading(false);
    }
  }, [serviceActionLoading, refetchServiceDetail]);

  const handleOpenOnboard = useCallback(async () => {
    try {
      await openclawApi.openOnboard();
    } catch (e) {
      toast.error(typeof e === "string" ? e : t("overview.openclaw.openFailed"));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsSpinning(true);
    setCliInstalledLocally(false);
    setCliUninstalledLocally(false);
    // 最短持续 800ms，确保旋转动画可见
    const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 800));
    try {
      if (activeApp === "claude" || activeApp === "codex" || activeApp === "gemini" || activeApp === "opencode" || activeApp === "qwen" || activeApp === "openclaw") {
        try {
          const minNodeMajor = activeApp === "openclaw" ? 22 : undefined;
          const status = await settingsApi.checkCliEnv(activeApp, minNodeMajor);
          setCliEnv(status);
          if (status.has_cli) setCliInstalledLocally(true);
        } catch (error) {
          console.error("[AppDashboard] Failed to refresh CLI env", error);
        }
      }
      await Promise.all([refetchToolVersion(), minDelay]);
    } finally {
      setIsSpinning(false);
    }
  }, [activeApp, refetchToolVersion]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ tool: string; installed: boolean }>("cli-status-changed", (event) => {
      if (event.payload.tool !== activeApp) return;
      if (event.payload.installed) {
        setCliUninstalledLocally(false);
        refetchToolVersion();
      } else {
        setCliUninstalledLocally(true);
        setCliInstalledLocally(false);
        refetchToolVersion();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, [activeApp, refetchToolVersion]);

  useEffect(() => {
    // 切换 app 时立即重置所有本地状态，避免残留旧数据导致闪屏
    setCliCheckLoading(true);
    setCliEnv(null);
    setCliInstalledLocally(false);
    setCliUninstalledLocally(false);
    // Only check for Node.js-based CLI tools
    if (!["claude", "codex", "gemini", "opencode", "qwen", "openclaw"].includes(activeApp)) {
      setCliCheckLoading(false);
      return;
    }
    let active = true;
    const loadEnv = async () => {
      try {
        // openclaw 最低要求 Node.js 22，其他工具默认 18
        const minNodeMajor = activeApp === "openclaw" ? 22 : 18;
        const status = await settingsApi.checkCliEnv(activeApp, minNodeMajor);
        if (!active) return;
        setCliEnv(status);
        if (status.has_cli) setCliInstalledLocally(true);
      } catch (error) {
        console.error("[AppDashboard] Failed to check CLI env", error);
      } finally {
        if (active) setCliCheckLoading(false);
      }
    };
    void loadEnv();
    return () => { active = false; };
  }, [activeApp]);

  const capabilityCards = useMemo(() => getCapabilityCards(activeApp), [activeApp]);
  
  const cliVersion = toolVersion?.version || cliEnv?.cli_version;

  // 仅在检测中且尚未确认 CLI 已安装时才显示骨架屏，避免已安装情况下闪屏
  if (isCheckingCli && !effectiveCliInstalled) {
    return (
      <div className="px-6 py-6 min-h-full space-y-5">
        <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5 animate-pulse">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-bg-tertiary" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-bg-tertiary rounded w-32" />
              <div className="h-3 bg-bg-tertiary rounded w-48" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-20 bg-bg-tertiary rounded-xl" />
            <div className="h-20 bg-bg-tertiary rounded-xl" />
          </div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-bg-secondary p-5 animate-pulse">
          <div className="space-y-3">
            <div className="h-4 bg-bg-tertiary rounded w-40" />
            <div className="h-10 bg-bg-tertiary rounded-lg" />
            <div className="h-10 bg-bg-tertiary rounded-lg w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6 min-h-full space-y-5">

      {/* ===== Node.js 环境警告（无论 CLI 是否安装均显示）===== */}
      {["claude", "codex", "gemini", "opencode", "qwen", "openclaw"].includes(activeApp) && cliEnv && (!cliEnv.has_node || (cliEnv.has_node && !cliEnv.node_version_ok)) && (
        <div className="text-xs text-text-muted space-y-1 mb-4">
          {!cliEnv.has_node && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span>{t("overview.cli.nodeMissing")}</span>
              </div>
              <button
                onClick={() => settingsApi.openExternal("https://nodejs.org/zh-cn/download")}
                className="flex-shrink-0 text-xs font-medium text-yellow-700 underline hover:text-yellow-900"
              >
                {t("overview.cli.nodeInstallLink")}
              </button>
            </div>
          )}
          {cliEnv.has_node && !cliEnv.node_version_ok && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span>{t("overview.cli.nodeTooOld", {
                  version: cliEnv.node_version ?? "unknown",
                  minVersion: activeApp === "openclaw" ? 22 : 18,
                })}</span>
              </div>
              <button
                onClick={() => settingsApi.openExternal("https://nodejs.org/zh-cn/download")}
                className="flex-shrink-0 text-xs font-medium text-yellow-700 underline hover:text-yellow-900"
              >
                {t("overview.cli.nodeInstallLink")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===== CLI 安装引导（toolVersion 确认未安装时即可显示，无需等待 cliEnv）===== */}
      {!isToolVersionLoading && !effectiveCliInstalled && (
        <>
          <div className="rounded-xl border-2 border-dashed border-accent/30 bg-accent/5 p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                <Download className="w-6 h-6 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-text-primary">
                  {t("overview.cli.installTitle", { defaultValue: "安装 CLI 工具" })}
                </h3>
                <p className="text-sm text-text-muted mt-1">
                  {t("overview.cli.installDescription", { defaultValue: "开始使用前需要安装命令行工具" })}
                </p>
              </div>
            </div>
            
            {!installState.isInstalling && !installState.error && (
              <div className="flex gap-3">
                <Button
                  size="default"
                  onClick={handleInstall}
                  className="flex-1 bg-accent hover:bg-accent-hover text-white"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {t("overview.cli.installButton", { defaultValue: "自动安装" })}
                </Button>
                <Button size="default" variant="outline" onClick={handleManualInstall} className="flex-1">
                  <Terminal className="mr-2 h-4 w-4" />
                  {t("overview.cli.manualButton", { defaultValue: "手动安装" })}
                </Button>
              </div>
            )}
            
            {installState.isInstalling && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{t("overview.installProgress")}</span>
                  <Button variant="outline" size="sm" onClick={handleCancelInstall}>
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    {t("overview.cli.cancelButton", { defaultValue: "取消" })}
                  </Button>
                </div>
                <Progress value={installState.progress} className="h-2" />
                <div className="rounded-lg bg-bg-secondary p-3 text-xs font-mono max-h-16 overflow-y-auto">
                  {installState.logs.slice(-2).map((log, i) => (
                    <div key={i} className="text-text-muted">{log}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Error block */}
            {installState.error && (
              <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-yellow-900">
                      {installState.error.message}
                    </div>
                    {installState.error.fallbackAction === "manual" && (
                      <div className="mt-1 text-xs text-yellow-700">
                        {t("overview.cli.manualInstallHint")}
                      </div>
                    )}
                    {installState.error.code === "NODE_NPM_NOT_FOUND" && (
                      <button
                        type="button"
                        onClick={() => settingsApi.openExternal("https://nodejs.org/zh-cn/download")}
                        className="mt-1.5 text-xs font-medium text-yellow-700 underline hover:text-yellow-900"
                      >
                        {t("overview.cli.nodeInstallLink")}
                      </button>
                    )}
                    {installState.error.code === "GIT_NOT_FOUND" && (
                      <button
                        type="button"
                        onClick={() => settingsApi.openExternal("https://git-scm.com/downloads")}
                        className="mt-1.5 text-xs font-medium text-yellow-700 underline hover:text-yellow-900"
                      >
                        {t("overview.cli.gitInstallLink", { defaultValue: "前往安装 Git" })}
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {installState.error.fallbackAction === "retry" && (
                    <Button size="sm" onClick={handleRetry}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {t("overview.cli.retryButton")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={installState.error.fallbackAction === "manual" ? "default" : "outline"}
                    onClick={handleManualInstall}
                  >
                    <Terminal className="mr-1.5 h-3.5 w-3.5" />
                    {t("overview.cli.manualButton")}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Locked capability cards preview */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              {capabilityCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-2xl border border-border-subtle bg-bg-card p-4 opacity-50 select-none"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center flex-shrink-0">
                      <Lock className="w-4 h-4 text-text-tertiary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="h-3.5 bg-bg-tertiary rounded w-24 mb-1.5" />
                      <div className="h-2.5 bg-bg-tertiary rounded w-full" />
                      <div className="h-2.5 bg-bg-tertiary rounded w-3/4 mt-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-text-tertiary">
              {t("overview.capabilityCard.lockedHint")}
            </p>
          </div>
        </>
      )}

      {/* ===== 非 OpenClaw 应用的状态概览 ===== */}
      {effectiveCliInstalled && activeApp !== "openclaw" && (
        <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">{t("overview.appStatus.title")}</h3>
                <p className="text-sm text-text-muted">{t("overview.appStatus.subtitle")}</p>
              </div>
            </div>
          <div className="flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-full bg-green-100 border border-green-200">
                <span className="text-sm font-semibold text-green-700">{t("overview.appStatus.ready")}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isSpinning}
                title={t("overview.cli.refreshButton")}
                className={`h-8 w-8 p-0 flex-shrink-0 ${isSpinning ? "bg-transparent border-none hover:bg-transparent disabled:opacity-100" : ""}`}
              >
                <RefreshCw className={`h-4 w-4 ${isSpinning ? "animate-spin text-text-muted" : ""}`} />
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-secondary rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Terminal className="w-4 h-4 text-text-muted" />
                <span className="text-xs font-medium text-text-muted">{t("overview.appStatus.cliVersion")}</span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-lg font-bold text-text-primary">
                  {cliVersion || t("overview.appStatus.cliInstalled")}
                </p>
                {canUninstall(activeApp) && (
                  <button
                    className="text-xs text-text-tertiary hover:text-text-muted hover:underline leading-none mb-0.5 transition-colors"
                    onClick={() => setCliManageOpen(true)}
                  >
                    {t("overview.appStatus.manage")}
                  </button>
                )}
              </div>
            </div>
            <button
              className="bg-bg-secondary rounded-lg p-3 text-left hover:bg-bg-tertiary transition-colors cursor-pointer w-full"
              onClick={() => onOpenAction?.("providers")}
            >
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-text-muted" />
                <span className="text-xs font-medium text-text-muted">{t("overview.appStatus.providerCount")}</span>
              </div>
              <p className="text-lg font-bold text-text-primary">
                {isLoading ? "..." : Object.keys(providers).length}
              </p>
            </button>
          </div>


          
          {!providerReady && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  {t("overview.appStatus.noProviderWarning")}
                </span>
                <Button
                  size="sm"
                  onClick={() => onOpenAction?.("providers")}
                  className="ml-auto bg-amber-600 hover:bg-amber-700 text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t("overview.appStatus.addProvider")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== OpenClaw: 命令面板风格 ===== */}
      {effectiveCliInstalled && isOpenClaw && (() => {
        const svcRunning = openclawServiceDetail?.running ?? false;
        const svcPid = openclawServiceDetail?.pid ?? null;
        const svcPort = openclawServiceDetail?.port ?? 18789;
        const providerCount = Object.keys(providers).length;
        return (
          <>
            {/* 统一服务面板：命令栏 + 指标行 */}
            <div className="rounded-xl border border-border-subtle overflow-hidden bg-bg-card">
              {/* 命令栏：状态 + 操作同行 */}
              <div className={`flex items-center justify-between px-4 py-3 border-b border-border-subtle ${
                svcRunning ? 'bg-green-50/60' : ''
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    svcRunning ? 'bg-green-500 animate-pulse' : 'bg-text-tertiary'
                  }`} />
                  <span className={`text-sm font-semibold ${
                    svcRunning ? 'text-green-700' : 'text-text-secondary'
                  }`}>
                    {svcRunning ? t("overview.openclaw.running") : t("overview.openclaw.stopped")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {svcRunning ? (
                    <>
                      <Button
                        onClick={handleOpenOnboard}
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        {t("overview.openclaw.open")}
                      </Button>
                      <Button
                        onClick={handleServiceRestart}
                        disabled={serviceActionLoading}
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300"
                      >
                        {serviceActionLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        {t("overview.openclaw.restart")}
                      </Button>
                      <Button
                        onClick={handleServiceStop}
                        disabled={serviceActionLoading}
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                      >
                        <Square className="w-3.5 h-3.5 mr-1.5" />
                        {t("overview.openclaw.stop")}
                      </Button>
                      <Button
                        onClick={() => onOpenAction?.("openclawTesting")}
                        size="sm"
                        variant="outline"
                        className="h-8 px-3 border-border-subtle text-text-muted hover:bg-bg-secondary hover:text-text-primary"
                      >
                        <Stethoscope className="w-3.5 h-3.5 mr-1.5" />
                        {t("overview.openclaw.runDiagnostic", { defaultValue: "诊断" })}
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => void startOpenClawService.mutateAsync()}
                      disabled={serviceActionLoading || startOpenClawService.isPending}
                      size="sm"
                      className="h-8 px-4 bg-green-600 hover:bg-green-700 text-white font-medium"
                    >
                      {startOpenClawService.isPending ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5 mr-1.5" />
                      )}
                        {t("overview.openclaw.start")}
                      </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={isSpinning}
                    title={t("overview.cli.refreshButton")}
                    className={`h-8 w-8 p-0 flex-shrink-0 ${isSpinning ? "bg-transparent border-none hover:bg-transparent disabled:opacity-100" : ""}`}
                  >
                    <RefreshCw className={`h-4 w-4 ${isSpinning ? "animate-spin text-text-muted" : ""}`} />
                  </Button>
                </div>
              </div>

              {/* 指标行 */}
              <div className="grid grid-cols-3 divide-x divide-border-subtle">
                <div className="px-5 py-4">
                  <p className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5">
                    <Terminal className="w-3 h-3" />
                    {t("overview.openclaw.port")}
                  </p>
                  <p className="text-2xl font-bold text-text-primary tabular-nums tracking-tight">
                    {svcPort}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5">
                    <Cpu className="w-3 h-3" />
                    {t("overview.openclaw.pid")}
                  </p>
                  <p className={`text-2xl font-bold tabular-nums tracking-tight ${
                    svcPid ? 'text-text-primary' : 'text-text-tertiary'
                  }`}>
                    {svcPid ?? '—'}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5">
                    <Users className="w-3 h-3" />
                    {t("overview.openclaw.providers")}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-2xl font-bold tabular-nums tracking-tight ${
                      providerCount === 0 && !isLoading ? 'text-amber-600' : 'text-text-primary'
                    }`}>
                      {isLoading ? '...' : providerCount}
                    </p>
                    {providerCount === 0 && !isLoading && (
                      <button
                        onClick={() => onOpenAction?.('providers')}
                        className="text-xs text-accent hover:text-accent-hover hover:underline leading-none"
                      >
                        {t("overview.openclaw.goAdd")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* 供应商为空时的引导 Banner */}
            {providerCount === 0 && !isLoading && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-sm font-medium text-amber-800">
                    {t("overview.appStatus.noProviderWarning")}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => onOpenAction?.('providers')}
                    className="ml-auto bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {t("overview.appStatus.addProvider")}
                  </Button>
                </div>
              </div>
            )}

            {/* 渠道状态卡片 */}
            {(() => {
              const channelList = openclawChannels ?? [];

              // 找到第一个已启用且有有效配置的渠道
              const activeChannel = channelList.find(
                c => c.enabled && Object.values(c.config ?? {}).some(v => v !== undefined && v !== null && v !== '')
              ) ?? null;

              // 渠道元信息映射
              const CHANNEL_META: Record<string, { name: string; colorClass: string; bgClass: string; Icon: LucideIcon }> = {
                dingtalk:  { name: '钉钉',     colorClass: 'text-blue-700',   bgClass: 'bg-blue-700/10',   Icon: Bell },
                feishu:    { name: '飞书',     colorClass: 'text-blue-600',   bgClass: 'bg-blue-600/10',   Icon: MessagesSquare },
                wechat:    { name: '微信',     colorClass: 'text-green-700',  bgClass: 'bg-green-700/10',  Icon: MessageSquare },
                telegram:  { name: 'Telegram', colorClass: 'text-blue-500',   bgClass: 'bg-blue-500/10',   Icon: MessageCircle },
                discord:   { name: 'Discord',  colorClass: 'text-indigo-500', bgClass: 'bg-indigo-500/10', Icon: Hash },
                slack:     { name: 'Slack',    colorClass: 'text-purple-500', bgClass: 'bg-purple-500/10', Icon: Slack },
                whatsapp:  { name: 'WhatsApp', colorClass: 'text-green-600',  bgClass: 'bg-green-600/10',  Icon: MessageCircle },
                imessage:  { name: 'iMessage', colorClass: 'text-green-500',  bgClass: 'bg-green-500/10',  Icon: Apple },
              };

              const meta = activeChannel ? (CHANNEL_META[activeChannel.channel_type] ?? null) : null;
              const ChannelIcon = meta?.Icon ?? MessageCircle;

              return (
                <div className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-border-subtle bg-bg-secondary/30 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-primary">{t("overview.openclaw.channelCard.title")}</h3>
                    <button
                      onClick={() => onOpenAction?.('openclawChannels')}
                      className="text-xs text-accent hover:text-accent-hover hover:underline flex items-center gap-1"
                    >
                      {t("overview.openclaw.channelCard.manage")}
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="p-3">
                    {activeChannel && meta ? (
                      /* 已配置：展示当前激活渠道 */
                      <button
                        onClick={() => onOpenAction?.('openclawChannels')}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                          svcRunning
                            ? 'border-green-500/20 bg-green-500/5 hover:bg-green-500/10'
                            : 'border-border-subtle hover:bg-bg-secondary/50'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bgClass}`}>
                          <ChannelIcon className={`w-4 h-4 ${meta.colorClass}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-text-primary">{meta.name}</span>
                            {svcRunning && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">
                            {svcRunning ? t("overview.openclaw.channelCard.running") : t("overview.openclaw.channelCard.serviceNotRunning")}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                      </button>
                    ) : (
                      /* 未配置：引导 CTA */
                      <button
                        onClick={() => onOpenAction?.('openclawChannels')}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border hover:border-border-hover hover:bg-bg-secondary/50 transition-colors text-left group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[#F0F0F2] group-hover:bg-[#E8E8EA] flex items-center justify-center flex-shrink-0 transition-colors">
                          <Plus className="w-4 h-4 text-[#888888] group-hover:text-[#555555] transition-colors" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{t("overview.openclaw.channelCard.configure")}</p>
                          <p className="text-xs text-text-tertiary mt-0.5">{t("overview.openclaw.channelCard.configureHint")}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 管理工具 */}
            <div className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border-subtle bg-bg-secondary/30">
                <h3 className="text-sm font-semibold text-text-primary">{t("overview.openclaw.managementTools.title")}</h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => onOpenAction?.("openclawTesting")}
                    className="group flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border hover:bg-bg-secondary/50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                      <Stethoscope className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("overview.openclaw.managementTools.diagnostics")}</div>
                      <div className="text-xs text-text-muted">{t("overview.openclaw.managementTools.diagnosticsDesc")}</div>
                    </div>
                  </button>

                  <button
                    onClick={() => onOpenAction?.("providers")}
                    className="group flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border hover:bg-bg-secondary/50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200 transition-colors">
                      <Users className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("overview.openclaw.managementTools.providers")}</div>
                      <div className="text-xs text-text-muted">{t("overview.openclaw.managementTools.providersDesc")}</div>
                    </div>
                  </button>

                  <button
                    onClick={() => onOpenAction?.("openclawChannels")}
                    className="group flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border hover:bg-bg-secondary/50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                      <MessageCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("overview.openclaw.managementTools.channels")}</div>
                      <div className="text-xs text-text-muted">{t("overview.openclaw.managementTools.channelsDesc")}</div>
                    </div>
                  </button>

                  <button
                    onClick={() => onOpenAction?.("sessions")}
                    className="group flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border hover:bg-bg-secondary/50 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-200 transition-colors">
                      <History className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary">{t("overview.openclaw.managementTools.sessions")}</div>
                      <div className="text-xs text-text-muted">{t("overview.openclaw.managementTools.sessionsDesc")}</div>
                    </div>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
                  <span className="text-xs text-text-muted">{t("overview.openclaw.managementTools.quickAccess")}</span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => onOpenAction?.("openclawEnv")}
                      className="text-xs text-accent hover:text-accent-hover hover:underline"
                    >
                      {t("overview.openclaw.managementTools.envConfig")}
                    </button>
                    <span className="text-xs text-text-tertiary">·</span>
                    <button
                      onClick={() => onOpenAction?.("openclawTools")}
                      className="text-xs text-accent hover:text-accent-hover hover:underline"
                    >
                      {t("overview.openclaw.managementTools.toolManagement")}
                    </button>
                    <span className="text-xs text-text-tertiary">·</span>
                    <button
                      onClick={() => onOpenAction?.("openclawGateway")}
                      className="text-xs text-accent hover:text-accent-hover hover:underline"
                    >
                      {t("overview.openclaw.managementTools.gatewayConfig", { defaultValue: "Gateway 配置" })}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}


      {/* CLI 管理弹窗 */}
      {canUninstall(activeApp) && (
        <Dialog
          open={cliManageOpen}
          onOpenChange={(open) => {
            if (!open && !uninstallState.isUninstalling) {
              setCliManageOpen(false);
              setUninstallConfirming(false);
              if (uninstallState.uninstallError) setUninstallError(activeApp, null);
            }
          }}
        >
          <DialogContent className="max-w-sm" zIndex="nested">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Terminal className="w-4 h-4 text-text-muted" />
                {t("overview.cliManage.title")}
              </DialogTitle>
            </DialogHeader>

            <div className="px-6 py-4 space-y-4">
              {/* 版本信息行 */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-text-muted">{t("overview.cliManage.currentVersion")}</span>
                <span className="text-sm font-semibold text-text-primary tabular-nums">
                  {cliVersion || t("overview.appStatus.cliInstalled")}
                </span>
              </div>

              <div className="border-t border-border-subtle" />

              {/* 默认状态：卸载入口 */}
              {!uninstallState.isUninstalling && !uninstallState.uninstallError && !uninstallConfirming && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t("overview.cli.uninstallButton")}</p>
                    <p className="text-xs text-text-muted mt-0.5">{t("overview.cli.uninstallDesc", { defaultValue: "从系统中移除命令行工具" })}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 flex-shrink-0"
                    onClick={() => setUninstallConfirming(true)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    {t("overview.cli.uninstallButton", { defaultValue: "卸载" })}
                  </Button>
                </div>
              )}

              {/* 二次确认 */}
              {uninstallConfirming && !uninstallState.isUninstalling && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-800">
                      {t("overview.cli.uninstallConfirm", { defaultValue: "确定要卸载该 CLI 吗？此操作不可恢复。" })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setUninstallConfirming(false)}
                    >
                      {t("common.cancel", { defaultValue: "取消" })}
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => handleUninstall()}
                    >
                      {t("overview.cli.uninstallConfirmButton", { defaultValue: "确定卸载" })}
                    </Button>
                  </div>
                </div>
              )}

              {/* 卸载进度 */}
              {uninstallState.isUninstalling && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">
                      {t("overview.cli.uninstalling", { defaultValue: "卸载进度" })}
                    </span>
                    <Button variant="outline" size="sm" onClick={handleCancelUninstall}>
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      {t("overview.cli.cancelUninstallButton", { defaultValue: "取消" })}
                    </Button>
                  </div>
                  <Progress value={uninstallState.uninstallProgress} className="h-2" />
                  <div className="rounded-lg bg-bg-secondary p-3 text-xs font-mono max-h-16 overflow-y-auto">
                    {uninstallState.uninstallLogs.slice(-2).map((log, i) => (
                      <div key={i} className="text-text-muted">{log}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* 错误状态 */}
              {uninstallState.uninstallError && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-yellow-900">
                        {uninstallState.uninstallError.message}
                      </div>
                      {uninstallState.uninstallError.fallbackAction === "manual" && (
                        <div className="mt-1 text-xs text-yellow-700">
                          {t("overview.cli.manualUninstallHint", { defaultValue: "请使用下方「手动卸载」在终端中执行命令。" })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {uninstallState.uninstallError.fallbackAction === "retry" && (
                      <Button size="sm" onClick={handleUninstallRetry}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        {t("overview.cli.retryButton")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={uninstallState.uninstallError.fallbackAction === "manual" ? "default" : "outline"}
                      onClick={handleManualUninstall}
                    >
                      <Terminal className="mr-1.5 h-3.5 w-3.5" />
                      {t("overview.cli.manualUninstallButton", { defaultValue: "手动卸载" })}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {!uninstallState.isUninstalling && (
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCliManageOpen(false);
                    setUninstallConfirming(false);
                    if (uninstallState.uninstallError) setUninstallError(activeApp, null);
                  }}
                >
                  {t("common.cancel", { defaultValue: "关闭" })}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Proxy status indicator */}
      {isProxyRunning && (
        <div className="flex items-center gap-2 text-xs text-text-muted px-1">
          <Activity className="w-3.5 h-3.5" />
          {isProxyTakeover
            ? t("overview.proxyTakeover")
            : t("overview.proxyRunning")}
        </div>
      )}
    </div>
  );
}
