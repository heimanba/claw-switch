import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings,
  BarChart2,
  Download,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Provider } from "@/types";
import type { EnvConflict } from "@/types/env";
import { useProvidersQuery, useSettingsQuery } from "@/lib/query";
import { useToolVersionQuery } from "@/lib/query/queries";
import {
  providersApi,
  settingsApi,
  type AppId,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { getDefaultVisibleApps } from "@/config/appConfig";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { useProviderActions } from "@/hooks/useProviderActions";
import { openclawKeys, useOpenClawServiceStatus, useStartOpenClawService } from "@/hooks/useOpenClaw";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { isWindows, isLinux } from "@/lib/platform";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { Sidebar, Header } from "@/components/layout";
import {
  AppDashboard,
  type DashboardQuickAction,
} from "@/components/dashboard/AppDashboard";
import { ProviderList } from "@/components/providers/ProviderList";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import UsageScriptModal from "@/components/UsageScriptModal";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import { SkillsView } from "@/components/skills/SkillsView";
import type { SkillsViewHandle } from "@/components/skills/SkillsView";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { UniversalProviderPanel } from "@/components/universal";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import GatewayPanel from "@/components/openclaw/GatewayPanel";
import TestingPanel from "@/components/openclaw/TestingPanel";
import ChannelsPanel from "@/components/openclaw/ChannelsPanel";
import LogsPanel from "@/components/openclaw/LogsPanel";
import OpenClawSkillsPanel from "@/components/openclaw/OpenClawSkillsPanel";
import { ChatPage } from "@/components/chat/ChatPage";
import { appLogger } from "@/lib/logger";

type View =
  | "dashboard"
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawGateway"
  | "openclawTesting"
  | "openclawChannels"
  | "openclawLogs"
  | "openclawSkills"
  | "chat";

interface WebDavSyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

const DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px

const STORAGE_KEY = "claw-switch-last-app";
const VALID_APPS: AppId[] = [
  "openclaw",
  "claude",
  "qwen",
  "opencode",
  "cline",
  "codex",
  "gemini",
];

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "qwen";
};

const VIEW_STORAGE_KEY = "claw-switch-last-view";
const VALID_VIEWS: View[] = [
  "dashboard",
  "providers",
  "settings",
  "prompts",
  "skills",
  "mcp",
  "agents",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawGateway",
  "openclawTesting",
  "openclawChannels",
  "openclawSkills",
  "chat",
];

const OPENCLAW_ONLY_VIEWS = new Set<View>([
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawGateway",
  "agents",
  "openclawTesting",
  "openclawChannels",
  "openclawSkills",
  "chat",
]);

const SESSION_SUPPORTED_APPS = new Set<AppId>([
  "qwen",
  "claude",
  "codex",
  "opencode",
  "openclaw",
  "gemini",
]);

const isViewAvailableForApp = (view: View, app: AppId): boolean => {
  if (OPENCLAW_ONLY_VIEWS.has(view)) {
    return app === "openclaw";
  }
  if (view === "sessions") {
    return SESSION_SUPPORTED_APPS.has(app);
  }
  return true;
};

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "dashboard";
};

function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState("general");
  const [agentsAddOpen, setAgentsAddOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addProviderInitialPresetId, setAddProviderInitialPresetId] = useState<string | undefined>(undefined);
  // 来自诊断页跳转到环境变量页的标记
  const [envFromDiagnostics, setEnvFromDiagnostics] = useState(false);
  // 诊断结果持久化状态（跨视图切换保留）
  const [testingPanelState, setTestingPanelState] = useState<import("@/components/openclaw/TestingPanel").TestingPanelState>({
    results: null,
    lastCheckTime: null,
    isPassedExpanded: false,
  });
  // Onboarding 显示控制（参考 openclaw-manager 纯实时检测模式）
  const [showOnboarding, setShowOnboarding] = useState(true);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  const { data: settingsData } = useSettingsQuery();
  const visibleApps = settingsData?.visibleApps ?? getDefaultVisibleApps();

  const getFirstVisibleApp = (): AppId => {
    if (visibleApps.openclaw) return "openclaw";
    if (visibleApps.claude) return "claude";
    if (visibleApps.qwen) return "qwen";
    if (visibleApps.opencode) return "opencode";
    if (visibleApps.cline) return "cline";
    if (visibleApps.codex) return "codex";
    if (visibleApps.gemini) return "gemini";
    return "openclaw"; // fallback
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  // Ensure current view is always valid for the active app
  useEffect(() => {
    if (!isViewAvailableForApp(currentView, activeApp)) {
      if (currentView === "sessions") {
        setCurrentView("providers");
      } else {
        setCurrentView("dashboard");
      }
    }
    // Log when switching to openclaw
    if (activeApp === "openclaw") {
      appLogger.info("🦞 OpenClaw 面板已加载");
    }
  }, [activeApp, currentView]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);


  const promptPanelRef = useRef<any>(null);
  const mcpPanelRef = useRef<any>(null);
  const skillsViewRef = useRef<SkillsViewHandle>(null);

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus();
  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;

    // OpenClaw Gateway 状态检测（仅当活动 app 为 openclaw 时轮询）
  const isOpenclaw = activeApp === "openclaw";
  const { data: isGatewayRunning } = useOpenClawServiceStatus(isOpenclaw);
  // 检测 openclaw CLI 是否已安装，未安装时不显示"服务未启动"横幅
  const { data: openclawToolVersion, isLoading: isOpenclawVersionLoading } = useToolVersionQuery(isOpenclaw ? "openclaw" : "");
  const isOpenclawCliInstalled = !isOpenclawVersionLoading && !!openclawToolVersion?.version;
  const startOpenClawService = useStartOpenClawService();
  const handleStartGateway = () => void startOpenClawService.mutateAsync();
  const activeProviderId = useMemo(() => {
    const target = proxyStatus?.active_targets?.find(
      (t) => t.app_type === activeApp,
    );
    return target?.provider_id;
  }, [proxyStatus?.active_targets, activeApp]);

  const { data, isLoading, refetch } = useProvidersQuery(activeApp, {
    isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(activeApp, {
    onNavigateToAgents:
      activeApp === "openclaw"
        ? () => { setCurrentView("agents"); }
        : undefined,
  });

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unsubscribe = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            if (event.appType === activeApp) {
              await refetch();
            }
          },
        );
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    setupListener();
    return () => {
      unsubscribe?.();
    };
  }, [activeApp, refetch]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unsubscribe = await listen("universal-provider-synced", async () => {
          await queryClient.invalidateQueries({ queryKey: ["providers"] });
          try {
            await providersApi.updateTrayMenu();
          } catch (error) {
            console.error("[App] Failed to update tray menu", error);
          }
        });
      } catch (error) {
        console.error(
          "[App] Failed to subscribe universal-provider-synced event",
          error,
        );
      }
    };

    setupListener();
    return () => {
      unsubscribe?.();
    };
  }, [queryClient]);

  // 启动 CLI 工具文件系统监听器（应用级全局，只运行一次）
  useEffect(() => {
    const ALL_CLI_TOOLS = [
      "claude",
      "codex",
      "gemini",
      "opencode",
      "qwen",
      "openclaw",
      "cline",
    ];
    invoke("start_cli_watcher", { tools: ALL_CLI_TOOLS }).catch((err) => {
      console.warn("[App] CLI watcher 启动失败:", err);
    });
    return () => {
      invoke("stop_cli_watcher").catch(() => {});
    };
  }, []);


  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await listen(
          "webdav-sync-status-updated",
          async (event) => {
            const payload = (event.payload ??
              {}) as WebDavSyncStatusUpdatedPayload;
            await queryClient.invalidateQueries({ queryKey: ["settings"] });

            if (payload.source !== "auto" || payload.status !== "error") {
              return;
            }

            toast.error(
              t("settings.webdavSync.autoSyncFailedToast", {
                error: payload.error || t("common.unknown"),
              }),
            );
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error(
          "[App] Failed to subscribe webdav-sync-status-updated event",
          error,
        );
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [queryClient, t]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCurrentView("settings");
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "dashboard") return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      if (view === "providers") {
        setCurrentView("dashboard");
      } else {
        setCurrentView("providers");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async (provider: Provider) => {
    await updateProvider(provider);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      await providersApi.removeFromLiveConfig(provider.id, activeApp);
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        });
      }
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueOpencodeKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    const newSortIndex =
      provider.sortIndex !== undefined ? provider.sortIndex + 1 : undefined;

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: JSON.parse(JSON.stringify(provider.settingsConfig)), // 深拷贝
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      sortIndex: newSortIndex, // 复制原 sortIndex + 1
      meta: provider.meta
        ? JSON.parse(JSON.stringify(provider.meta))
        : undefined, // 深拷贝
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (activeApp === "opencode") {
      const existingKeys = Object.keys(providers);
      duplicatedProvider.providerKey = generateUniqueOpencodeKey(
        provider.id,
        existingKeys,
      );
    }

    if (provider.sortIndex !== undefined) {
      const updates = Object.values(providers)
        .filter(
          (p) =>
            p.sortIndex !== undefined &&
            p.sortIndex >= newSortIndex! &&
            p.id !== provider.id,
        )
        .map((p) => ({
          id: p.id,
          sortIndex: p.sortIndex! + 1,
        }));

      if (updates.length > 0) {
        try {
          await providersApi.updateSortOrder(updates, activeApp);
        } catch (error) {
          console.error("[App] Failed to update sort order", error);
          toast.error(
            t("provider.sortUpdateFailed", {
              defaultValue: "排序更新失败",
            }),
          );
          return; // 如果排序更新失败，不继续添加
        }
      }
    }

    await addProvider(duplicatedProvider);
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      await providersApi.openTerminal(provider.id, activeApp);
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to refresh tray menu", error);
    }
  };

  const goToAppAction = (action: DashboardQuickAction) => {
    switch (action) {
      case "providers":
        setCurrentView("providers");
        break;
      case "skills":
        setCurrentView("skills");
        break;
      case "prompts":
        setCurrentView("prompts");
        break;
      case "mcp":
        setCurrentView("mcp");
        break;
      case "sessions":
        setCurrentView("sessions");
        break;
      case "workspace":
        setCurrentView("workspace");
        break;
      case "openclawEnv":
        setCurrentView("openclawEnv");
        break;
      case "openclawTools":
        setCurrentView("openclawTools");
        break;
      case "openclawGateway":
        setCurrentView("openclawGateway");
        break;
      case "agents":
        setCurrentView("agents");
        break;
      case "openclawTesting":
        setCurrentView("openclawTesting");
        break;
      case "openclawChannels":
        setCurrentView("openclawChannels");
        break;
      case "openclawSkills":
        setCurrentView("openclawSkills");
        break;
      default:
        setCurrentView("providers");
        break;
    }
  };

  const handleAppChange = (nextApp: AppId) => {
    setActiveApp(nextApp);
    setCurrentView("dashboard");
  };

  const renderContent = () => {
    const content = (() => {
      switch (currentView) {
        case "dashboard":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AppDashboard
                activeApp={activeApp}
                providers={providers}
                isLoading={isLoading}
                isProxyRunning={isProxyRunning}
                isProxyTakeover={isProxyRunning && isCurrentAppTakeoverActive}
                onOpenAction={goToAppAction}
              />
            </div>
          );
        case "settings":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SettingsPage
                open={true}
                onOpenChange={() => setCurrentView("dashboard")}
                onImportSuccess={handleImportSuccess}
                defaultTab={settingsDefaultTab}
              />
            </div>
          );
        case "prompts":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <PromptPanel
                ref={promptPanelRef}
                open={true}
                onOpenChange={() => setCurrentView("providers")}
                appId={activeApp}
              />
            </div>
          );
        case "skills":
          return (
            <div className="flex-1 overflow-hidden flex flex-col">
              <SkillsView
                ref={skillsViewRef}
                currentApp={activeApp}
              />
            </div>
          );
        case "mcp":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <UnifiedMcpPanel
                ref={mcpPanelRef}
                onOpenChange={() => setCurrentView("providers")}
              />
            </div>
          );
        case "agents":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AgentsPanel
                onOpenChange={() => setCurrentView("providers")}
                addOpen={agentsAddOpen}
                onAddOpenChange={setAgentsAddOpen}
              />
            </div>
          );
        case "universal":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4">
              <UniversalProviderPanel />
            </div>
          );

        case "sessions":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SessionManagerPage key={activeApp} appId={activeApp} />
            </div>
          );
        case "workspace":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <WorkspaceFilesPanel />
            </div>
          );
        case "openclawEnv":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <EnvPanel
                fromDiagnostics={envFromDiagnostics}
                onBackToDiagnostics={() => {
                  setEnvFromDiagnostics(false);
                  setCurrentView("openclawTesting");
                }}
              />
            </div>
          );
        case "openclawTools":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ToolsPanel />
            </div>
          );
        case "openclawGateway":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <GatewayPanel />
            </div>
          );
        case "openclawTesting":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <TestingPanel
                persistedState={testingPanelState}
                onStateChange={setTestingPanelState}
                onNavigate={(view) => {
                  if (view === "openclawEnv") {
                    setEnvFromDiagnostics(true);
                    setCurrentView("openclawEnv");
                  } else {
                    setEnvFromDiagnostics(false);
                    setCurrentView(view === "providers" ? "providers" : "sessions");
                  }
                }}
              />
            </div>
          );
        case "openclawChannels":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ChannelsPanel />
            </div>
          );
        case "openclawSkills":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <OpenClawSkillsPanel />
            </div>
          );
        case "openclawLogs":
          return (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-4">
              <LogsPanel />
            </div>
          );
        case "chat":
          return (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ChatPage />
            </div>
          );
        default:
          return (
            <div className="flex-1 min-h-0 overflow-y-auto px-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeApp}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4 py-6"
                >
                  <ProviderList
                    providers={providers}
                    currentProviderId={currentProviderId}
                    appId={activeApp}
                    isLoading={isLoading}
                    isProxyRunning={isProxyRunning}
                    isProxyTakeover={
                      isProxyRunning && isCurrentAppTakeoverActive
                    }
                    activeProviderId={activeProviderId}
                    onSwitch={switchProvider}
                    onEdit={(provider) => {
                      setEditingProvider(provider);
                    }}
                    onDelete={(provider) =>
                      setConfirmAction({ provider, action: "delete" })
                    }
                    onRemoveFromConfig={
                      activeApp === "opencode" || activeApp === "openclaw"
                        ? (provider) =>
                            setConfirmAction({ provider, action: "remove" })
                        : undefined
                    }
                    onDisableOmo={
                      activeApp === "opencode" ? handleDisableOmo : undefined
                    }
                    onDisableOmoSlim={
                      activeApp === "opencode"
                        ? handleDisableOmoSlim
                        : undefined
                    }
                    onDuplicate={handleDuplicateProvider}
                    onConfigureUsage={setUsageProvider}
                    onOpenWebsite={handleOpenWebsite}
                    onOpenTerminal={
                      activeApp === "claude" ? handleOpenTerminal : undefined
                    }
                    onCreate={() => setIsAddOpen(true)}
                    onSetAsDefault={
                      activeApp === "openclaw" ? setAsDefaultModel : undefined
                    }
                    onNavigateToAgents={
                      activeApp === "openclaw"
                        ? () => { setCurrentView("agents"); }
                        : undefined
                    }
                    onQuickAddCodingPlan={
                      activeApp === "openclaw"
                        ? async (apiKey: string) => {
                            const preset = openclawProviderPresets[0]; // Coding Plan
                            const providerKey = preset.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
                            const settingsConfig = { ...preset.settingsConfig, apiKey };
                            const baseUrl = preset.settingsConfig.baseUrl;
                            await addProvider({
                              name: preset.name,
                              websiteUrl: preset.websiteUrl,
                              settingsConfig,
                              icon: preset.icon,
                              iconColor: preset.iconColor,
                              providerKey,
                              ...(preset.suggestedDefaults ? { suggestedDefaults: preset.suggestedDefaults } : {}),
                              ...(baseUrl ? { meta: { custom_endpoints: { [baseUrl]: { url: baseUrl, addedAt: Date.now(), lastUsed: undefined } } } } : {}),
                            });
                          }
                        : undefined
                    }
                    embedOnboardingWhenEmpty={true}
                    onboardingVisible={showOnboarding}
                    onOnboardingClose={() => setShowOnboarding(false)}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`${currentView}-${activeApp}`}
          className="flex-1 min-h-0 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    );
  };

  const renderHeaderActions = () => {
    const iconBtnClass = "w-9 h-9 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors";

    switch (currentView) {
      case "prompts":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => promptPanelRef.current?.openAdd()}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("prompts.add")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "mcp":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => mcpPanelRef.current?.openImport()}
                >
                  <Download className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("mcp.importExisting")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => mcpPanelRef.current?.openAdd()}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("mcp.addMcp")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "skills":
        return null;
      case "agents":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => setAgentsAddOpen(true)}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("agentsPanel.addAgent", { defaultValue: "新建 Agent" })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "providers":
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => setIsAddOpen(true)}
                >
                  <Plus className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("providers.add", { defaultValue: "添加供应商" })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case "dashboard":
        return (
          <TooltipProvider>
            {isCurrentAppTakeoverActive && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={iconBtnClass}
                    onClick={() => {
                      setSettingsDefaultTab("usage");
                      setCurrentView("settings");
                    }}
                  >
                    <BarChart2 className="w-5 h-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("usage.title", { defaultValue: "使用统计" })}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={iconBtnClass}
                  onClick={() => {
                    setSettingsDefaultTab("general");
                    setCurrentView("settings");
                  }}
                >
                  <Settings className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("common.settings")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      default:
        return null;
    }
  };

  return (
    <ThemeProvider>
    <div className="flex h-screen overflow-hidden bg-bg-primary text-text-primary selection:bg-accent/20">
      {/* macOS 拖拽区域 */}
      <div
        className="fixed top-0 left-0 right-0 z-[60]"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag", height: DRAG_BAR_HEIGHT } as any}
      />
      
      {/* 环境冲突横幅 */}
      {showEnvBanner && envConflicts.length > 0 && (
        <EnvWarningBanner
          conflicts={envConflicts}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      {/* 左侧边栏 */}
      <Sidebar
        currentView={currentView}
        activeApp={activeApp}
        visibleApps={visibleApps}
        onViewChange={setCurrentView}
        onAppChange={handleAppChange}
        enableLocalProxy={settingsData?.enableLocalProxy}
        dragBarHeight={DRAG_BAR_HEIGHT}
      />

      {/* 右侧主内容区 */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0" style={{ paddingTop: DRAG_BAR_HEIGHT }}>
        {/* 顶部标题栏 */}
        <Header currentView={currentView} activeApp={activeApp}>
          {renderHeaderActions()}
        </Header>

        {/* Gateway 未启动全局警告横幅（仅在 CLI 已安装时显示）*/}
        {isOpenclaw && isOpenclawCliInstalled && isGatewayRunning === false && (
          <div className="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-amber-600 dark:bg-amber-700 text-white text-xs">
            <span className="font-medium">
              {t("openclaw.gateway.notRunningBanner", { defaultValue: "Gateway 未启动，部分功能不可用" })}
            </span>
            <button
              onClick={handleStartGateway}
              disabled={startOpenClawService.isPending}
              className="ml-3 px-2.5 py-0.5 rounded text-xs bg-white/20 hover:bg-white/30 font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
            >
              {startOpenClawService.isPending
                ? t("overview.openclaw.serviceStarting", { defaultValue: "启动中…" })
                : t("overview.openclaw.start")}
            </button>
          </div>
        )}

        {/* 主内容区 */}
        <main className="flex-1 min-h-0 flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentView}-${activeApp}`}
              className="flex-1 min-h-0 flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AddProviderDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        appId={activeApp}
        onSubmit={addProvider}
        initialPresetId={addProviderInitialPresetId}
      />

      <EditProviderDialog
        open={Boolean(editingProvider)}
        provider={effectiveEditingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null);
          }
        }}
        onSubmit={handleEditProvider}
        appId={activeApp}
        isProxyTakeover={isProxyRunning && isCurrentAppTakeoverActive}
      />

      {effectiveUsageProvider && (
        <UsageScriptModal
          key={effectiveUsageProvider.id}
          provider={effectiveUsageProvider}
          appId={activeApp}
          isOpen={Boolean(usageProvider)}
          onClose={() => setUsageProvider(null)}
          onSave={(script) => {
            if (usageProvider) {
              void saveUsageScript(usageProvider, script);
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <DeepLinkImportDialog />
    </div>
    </ThemeProvider>
  );
}

export default App;
