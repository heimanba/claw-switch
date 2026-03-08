import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Provider, CustomEndpoint, UniversalProvider } from "@/types";
import type { AppId } from "@/lib/api";
import { universalProvidersApi } from "@/lib/api";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import { UniversalProviderFormModal } from "@/components/universal/UniversalProviderFormModal";
import { UniversalProviderPanel } from "@/components/universal";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";
import { opencodeProviderPresets } from "@/config/opencodeProviderPresets";
import { qwenProviderPresets } from "@/config/qwenProviderPresets";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import type { UniversalProviderPreset } from "@/config/universalProviderPresets";
import { ProviderPresetSelector } from "@/components/providers/forms/ProviderPresetSelector";
import type { PresetEntry } from "@/components/providers/forms/ProviderPresetSelector";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onSubmit: (
    provider: Omit<Provider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
    },
  ) => Promise<void> | void;
  /** 打开时预选的预设 ID，用于"一键添加"场景 */
  initialPresetId?: string;
}


export function AddProviderDialog({
  open,
  onOpenChange,
  appId,
  onSubmit,
  initialPresetId,
}: AddProviderDialogProps) {
  const { t } = useTranslation();
  // OpenCode and OpenClaw don't support universal providers
  const showUniversalTab = appId !== "opencode" && appId !== "openclaw";
  const [activeTab, setActiveTab] = useState<"app-specific" | "universal">("app-specific");
  const [universalFormOpen, setUniversalFormOpen] = useState(false);
  const [selectedUniversalPreset, setSelectedUniversalPreset] =
    useState<UniversalProviderPreset | null>(null);

  // 左栏预设选择状态（提升到 AddProviderDialog）
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialPresetId ?? "custom");

  // 当 Dialog 打开时，若有 initialPresetId 则同步（支持多次打开）
  useEffect(() => {
    if (open && initialPresetId) {
      setSelectedPresetId(initialPresetId);
    }
  }, [open, initialPresetId]);

  // 根据 appId 构建预设 entries
  const presetEntries = useMemo((): PresetEntry[] => {
    if (appId === "codex") return codexProviderPresets.map((p, i) => ({ id: `codex-${i}`, preset: p }));
    if (appId === "gemini") return geminiProviderPresets.map((p, i) => ({ id: `gemini-${i}`, preset: p }));
    if (appId === "openclaw") return openclawProviderPresets.map((p, i) => ({ id: `openclaw-${i}`, preset: p }));
    if (appId === "opencode") return opencodeProviderPresets.map((p, i) => ({ id: `opencode-${i}`, preset: p }));
    if (appId === "qwen") return qwenProviderPresets.map((p, i) => ({ id: `qwen-${i}`, preset: p }));
    return providerPresets.map((p, i) => ({ id: `claude-${i}`, preset: p }));
  }, [appId]);

  const groupedPresets = useMemo(() => {
    return presetEntries.reduce<Record<string, PresetEntry[]>>((acc, entry) => {
      const cat = entry.preset.category ?? "others";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(entry);
      return acc;
    }, {});
  }, [presetEntries]);

  const categoryKeys = useMemo(() => {
    const keys = Object.keys(groupedPresets).filter(
      (key) => key !== "custom" && groupedPresets[key]?.length,
    );
    // opencode 不展示 cn_official
    if (appId === "opencode") {
      const idx = keys.indexOf("cn_official");
      if (idx > -1) keys.splice(idx, 1);
    }
    return keys;
  }, [appId, groupedPresets]);

  // 切换 tab 时重置预设
  const handleTabChange = useCallback((tab: "app-specific" | "universal") => {
    setActiveTab(tab);
    setSelectedPresetId("custom");
  }, []);

  const handleUniversalProviderSave = useCallback(
    async (provider: UniversalProvider) => {
      try {
        await universalProvidersApi.upsert(provider);
        toast.success(
          t("universalProvider.addSuccess", {
            defaultValue: "统一供应商添加成功",
          }),
        );
        setUniversalFormOpen(false);
        setSelectedUniversalPreset(null);
        onOpenChange(false);
      } catch (error) {
        console.error(
          "[AddProviderDialog] Failed to save universal provider",
          error,
        );
        toast.error(
          t("universalProvider.addFailed", {
            defaultValue: "统一供应商添加失败",
          }),
        );
      }
    },
    [t, onOpenChange],
  );

  const handleUniversalFormClose = useCallback(() => {
    setUniversalFormOpen(false);
    setSelectedUniversalPreset(null);
  }, []);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      const parsedConfig = JSON.parse(values.settingsConfig) as Record<
        string,
        unknown
      >;

      // 构造基础提交数据
      const providerData: Omit<Provider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
      } = {
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        ...(values.presetCategory ? { category: values.presetCategory } : {}),
        ...(values.meta ? { meta: values.meta } : {}),
      };

      // OpenCode/OpenClaw: pass providerKey for ID generation
      if (
        (appId === "opencode" || appId === "openclaw") &&
        values.providerKey
      ) {
        providerData.providerKey = values.providerKey;
      }

      const hasCustomEndpoints =
        providerData.meta?.custom_endpoints &&
        Object.keys(providerData.meta.custom_endpoints).length > 0;

      if (!hasCustomEndpoints && values.presetCategory !== "omo") {
        const urlSet = new Set<string>();

        const addUrl = (rawUrl?: string) => {
          const url = (rawUrl || "").trim().replace(/\/+$/, "");
          if (url && url.startsWith("http")) {
            urlSet.add(url);
          }
        };

        if (values.presetId) {
          if (appId === "claude") {
            const presets = providerPresets;
            const presetIndex = parseInt(
              values.presetId.replace("claude-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (preset?.endpointCandidates) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "codex") {
            const presets = codexProviderPresets;
            const presetIndex = parseInt(values.presetId.replace("codex-", ""));
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "gemini") {
            const presets = geminiProviderPresets;
            const presetIndex = parseInt(
              values.presetId.replace("gemini-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          }
        }

        if (appId === "claude") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.ANTHROPIC_BASE_URL) {
            addUrl(env.ANTHROPIC_BASE_URL);
          }
        } else if (appId === "codex") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            const baseUrlMatch = config.match(
              /base_url\s*=\s*["']([^"']+)["']/,
            );
            if (baseUrlMatch?.[1]) {
              addUrl(baseUrlMatch[1]);
            }
          }
        } else if (appId === "gemini") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.GOOGLE_GEMINI_BASE_URL) {
            addUrl(env.GOOGLE_GEMINI_BASE_URL);
          }
        } else if (appId === "opencode") {
          const options = parsedConfig.options as
            | Record<string, any>
            | undefined;
          if (options?.baseURL) {
            addUrl(options.baseURL);
          }
        } else if (appId === "openclaw") {
          // OpenClaw uses baseUrl directly
          if (parsedConfig.baseUrl) {
            addUrl(parsedConfig.baseUrl as string);
          }
        }

        const urls = Array.from(urlSet);
        if (urls.length > 0) {
          const now = Date.now();
          const customEndpoints: Record<string, CustomEndpoint> = {};
          urls.forEach((url) => {
            customEndpoints[url] = {
              url,
              addedAt: now,
              lastUsed: undefined,
            };
          });

          providerData.meta = {
            ...(providerData.meta ?? {}),
            custom_endpoints: customEndpoints,
          };
        }
      }

      // OpenClaw: pass suggestedDefaults for model registration
      if (appId === "openclaw" && values.suggestedDefaults) {
        providerData.suggestedDefaults = values.suggestedDefaults;
      }

      await onSubmit(providerData);
      onOpenChange(false);
    },
    [appId, onSubmit, onOpenChange],
  );

  // footer 根据 tab 和布局变化
  const footer = activeTab === "universal" ? (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="border-border/20 hover:bg-accent hover:text-accent-foreground"
      >
        {t("common.cancel")}
      </Button>
      <Button
        onClick={() => setUniversalFormOpen(true)}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("universalProvider.add")}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="border-border/20 hover:bg-accent hover:text-accent-foreground"
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="provider-form"
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("common.add")}
      </Button>
    </>
  );

  // 左栏：预设选择器
  const leftPanel = (
    <div className="space-y-3">
      {showUniversalTab && (
        <div className="flex rounded-lg border border-border overflow-hidden mb-3">
          <button
            type="button"
            onClick={() => handleTabChange("app-specific")}
            className={`flex-1 px-2 py-2 text-xs font-medium transition-colors text-center leading-tight ${
              activeTab === "app-specific"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-text-muted hover:bg-muted/50"
            }`}
          >
            {t(`apps.${appId}`)}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("universal")}
            className={`flex-1 px-2 py-2 text-xs font-medium transition-colors text-center leading-tight ${
              activeTab === "universal"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-text-muted hover:bg-muted/50"
            }`}
          >
            {t("provider.tabUniversal")}
          </button>
        </div>
      )}

      {activeTab === "app-specific" && (
        <ProviderPresetSelector
          selectedPresetId={selectedPresetId}
          groupedPresets={groupedPresets}
          categoryKeys={categoryKeys}
          onPresetChange={setSelectedPresetId}
          category={undefined}
        />
      )}

      {activeTab === "universal" && (
        <p className="text-xs text-text-muted">
          {t("universalProvider.description", {
            defaultValue: "统一供应商可同时管理 Claude、Codex 和 Gemini 的配置。",
          })}
        </p>
      )}
    </div>
  );

  // 右栏：表单内容
  const rightPanel = activeTab === "universal" ? (
    <UniversalProviderPanel />
  ) : (
    <ProviderForm
      key={selectedPresetId}
      appId={appId}
      submitLabel={t("common.add")}
      onSubmit={handleSubmit}
      onCancel={() => onOpenChange(false)}
      showButtons={false}
      hidePresetSelector={true}
      initialPresetId={selectedPresetId}
    />
  );

  return (
    <>
      <FullScreenPanel
        isOpen={open}
        title={t("provider.addNewProvider")}
        onClose={() => onOpenChange(false)}
        footer={footer}
        splitLayout={true}
        splitLeftWidth={360}
      >
        {[leftPanel, rightPanel]}
      </FullScreenPanel>

      {showUniversalTab && (
        <UniversalProviderFormModal
          isOpen={universalFormOpen}
          onClose={handleUniversalFormClose}
          onSave={handleUniversalProviderSave}
          initialPreset={selectedUniversalPreset}
        />
      )}
    </>
  );
}
