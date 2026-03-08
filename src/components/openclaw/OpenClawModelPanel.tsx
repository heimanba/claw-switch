/**
 * OpenClawModelPanel
 *
 * A right-side slide-in panel for managing models of a single OpenClaw provider.
 * Includes: model list CRUD + "set as primary model" shortcut.
 *
 * Design: framer-motion slide-in from right, backdrop overlay, ESC to close.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  X,
  Cpu,
  Star,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { providersApi } from "@/lib/api/providers";
import {
  useOpenClawProviderModels,
  useOpenClawDefaultModel,
  useSaveOpenClawAgentsDefaults,
  useOpenClawAgentsDefaults,
} from "@/hooks/useOpenClaw";
import { useQueryClient } from "@tanstack/react-query";
import { openclawKeys } from "@/hooks/useOpenClaw";
import type { Provider, OpenClawModel, OpenClawProviderConfig } from "@/types";

interface OpenClawModelPanelProps {
  provider: Provider | null;
  onClose: () => void;
}

/**
 * Derive the "provider/model-id" full ID string for the current primary model.
 */
function getFullModelId(providerId: string, modelId: string) {
  return `${providerId}/${modelId}`;
}

export function OpenClawModelPanel({
  provider,
  onClose,
}: OpenClawModelPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const isOpen = provider !== null;

  // ---- Model list local state ----
  const [models, setModels] = useState<OpenClawModel[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Stable key refs for model rows (avoids key collisions on add/remove)
  const modelKeysRef = useRef<string[]>([]);
  const getModelKeys = useCallback(() => {
    while (modelKeysRef.current.length < models.length) {
      modelKeysRef.current.push(crypto.randomUUID());
    }
    if (modelKeysRef.current.length > models.length) {
      modelKeysRef.current.length = models.length;
    }
    return modelKeysRef.current;
  }, [models.length]);

  // ---- Queries ----
  const { data: availableModels = [] } = useOpenClawProviderModels(isOpen);
  const { data: defaultModelData } = useOpenClawDefaultModel(isOpen);
  const { data: agentsDefaults } = useOpenClawAgentsDefaults();
  const saveAgentsMutation = useSaveOpenClawAgentsDefaults();

  // Sync models from provider.settingsConfig when panel opens or provider changes
  useEffect(() => {
    if (!provider) return;
    const config = provider.settingsConfig as OpenClawProviderConfig;
    const rawModels: OpenClawModel[] = Array.isArray(config?.models)
      ? config.models
      : [];
    setModels(rawModels.map((m) => ({ ...m })));
    setExpandedRows({});
    modelKeysRef.current = rawModels.map(() => crypto.randomUUID());
  }, [provider?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- ESC to close ----
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, false);
    return () => window.removeEventListener("keydown", handler, false);
  }, [isOpen, onClose]);

  // ---- Helpers ----
  const primaryModel = defaultModelData?.primary ?? "";
  const providerId = provider?.id ?? "";

  const isModelPrimary = (modelId: string) =>
    primaryModel === getFullModelId(providerId, modelId);

  // ---- Model CRUD ----
  const handleAddModel = () => {
    modelKeysRef.current.push(crypto.randomUUID());
    setModels((prev) => [
      ...prev,
      { id: "", name: "", contextWindow: undefined, maxTokens: undefined },
    ]);
  };

  const handleRemoveModel = (index: number) => {
    modelKeysRef.current.splice(index, 1);
    setModels((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setExpandedRows((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleModelChange = (
    index: number,
    field: keyof OpenClawModel,
    value: unknown,
  ) => {
    setModels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleCostChange = (
    index: number,
    costField: "input" | "output" | "cacheRead" | "cacheWrite",
    raw: string,
  ) => {
    const num = parseFloat(raw);
    setModels((prev) => {
      const next = [...prev];
      const cur = next[index].cost || { input: 0, output: 0 };
      next[index] = {
        ...next[index],
        cost: { ...cur, [costField]: isNaN(num) ? undefined : num },
      };
      return next;
    });
  };

  // ---- Save models back to provider ----
  const handleSaveModels = async () => {
    if (!provider) return;
    setIsSaving(true);
    try {
      const config = { ...(provider.settingsConfig as OpenClawProviderConfig) };
      config.models = models.filter((m) => m.id.trim() !== "");
      await providersApi.update({ ...provider, settingsConfig: config }, "openclaw");
      // Invalidate provider models cache so dropdowns reflect new models
      queryClient.invalidateQueries({ queryKey: openclawKeys.providerModels });
      queryClient.invalidateQueries({ queryKey: openclawKeys.liveProviderIds });
      toast.success(
        t("openclaw.panel.saveSuccess", { defaultValue: "模型列表已保存" }),
      );
      onClose();
    } catch (err) {
      console.error("[OpenClawModelPanel] save failed", err);
      toast.error(
        t("openclaw.panel.saveFailed", { defaultValue: "保存失败，请重试" }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Set as primary model ----
  const handleSetPrimary = async (modelId: string) => {
    const full = getFullModelId(providerId, modelId);
    if (!agentsDefaults) return;
    try {
      const allModels = availableModels;
      const fallbacks = allModels.filter((m) => m !== full);
      const updated = {
        ...agentsDefaults,
        model: { primary: full, fallbacks },
      };
      await saveAgentsMutation.mutateAsync(updated);
      toast.success(
        t("openclaw.panel.setPrimarySuccess", {
          defaultValue: `已将 ${modelId} 设为主模型`,
        }),
      );
    } catch {
      toast.error(
        t("openclaw.panel.setPrimaryFailed", {
          defaultValue: "设置主模型失败",
        }),
      );
    }
  };

  const modelKeys = getModelKeys();

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="openclaw-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Slide-in panel */}
          <motion.div
            key="openclaw-panel-content"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-[71] flex flex-col w-[480px] max-w-[92vw] bg-bg-card border-l border-border-subtle shadow-2xl"
          >
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border-subtle">
              <div className="flex items-center gap-2.5 min-w-0">
                <Cpu className="w-4 h-4 text-text-muted flex-shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-text-primary truncate">
                    {provider?.name}
                  </h2>
                  <p className="text-xs text-text-muted">
                    {t("openclaw.panel.title", { defaultValue: "模型管理" })}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 h-7 w-7"
                onClick={onClose}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Primary model indicator */}
            {primaryModel && (
              <div className="flex-shrink-0 px-5 py-2.5 border-b border-border-subtle bg-bg-secondary/40">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  <span>
                    {t("openclaw.panel.currentPrimary", {
                      defaultValue: "当前主模型：",
                    })}
                  </span>
                  <span className="font-mono text-text-primary">
                    {primaryModel}
                  </span>
                </div>
              </div>
            )}

            {/* Model list */}
            <div className="flex-1 overflow-y-auto scroll-overlay px-5 py-4 space-y-3">
              {/* Add model button */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-text-muted">
                  {t("openclaw.panel.modelList", {
                    defaultValue: `模型列表（${models.length} 个）`,
                    count: models.length,
                  })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddModel}
                  className="h-7 gap-1 text-xs"
                >
                  <Plus className="h-3 w-3" />
                  {t("openclaw.addModel", { defaultValue: "添加模型" })}
                </Button>
              </div>

              {models.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <Cpu className="w-8 h-8 text-text-muted/40" />
                  <p className="text-sm text-text-muted">
                    {t("openclaw.panel.noModels", {
                      defaultValue: "暂无模型，点击「添加模型」开始配置",
                    })}
                  </p>
                </div>
              ) : (
                models.map((model, index) => (
                  <ModelRow
                    key={modelKeys[index]}
                    model={model}
                    index={index}
                    isExpanded={expandedRows[index] ?? false}
                    isPrimary={isModelPrimary(model.id)}
                    onToggleExpand={() =>
                      setExpandedRows((prev) => ({
                        ...prev,
                        [index]: !prev[index],
                      }))
                    }
                    onChange={handleModelChange}
                    onCostChange={handleCostChange}
                    onRemove={handleRemoveModel}
                    onSetPrimary={handleSetPrimary}
                    t={t}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 py-4 border-t border-border-subtle flex items-center justify-end gap-3">
              <Button variant="outline" size="sm" onClick={onClose}>
                {t("common.cancel", { defaultValue: "取消" })}
              </Button>
              <Button size="sm" onClick={handleSaveModels} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {t("common.saving", { defaultValue: "保存中..." })}
                  </>
                ) : (
                  t("common.save", { defaultValue: "保存" })
                )}
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ============================================================================
// ModelRow sub-component
// ============================================================================

interface ModelRowProps {
  model: OpenClawModel;
  index: number;
  isExpanded: boolean;
  isPrimary: boolean;
  onToggleExpand: () => void;
  onChange: (index: number, field: keyof OpenClawModel, value: unknown) => void;
  onCostChange: (
    index: number,
    field: "input" | "output" | "cacheRead" | "cacheWrite",
    raw: string,
  ) => void;
  onRemove: (index: number) => void;
  onSetPrimary: (modelId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ModelRow({
  model,
  index,
  isExpanded,
  isPrimary,
  onToggleExpand,
  onChange,
  onCostChange,
  onRemove,
  onSetPrimary,
  t,
}: ModelRowProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3 space-y-3 transition-smooth",
        isPrimary
          ? "border-amber-400/60 bg-amber-50/30 dark:bg-amber-900/10"
          : "border-border-subtle bg-bg-secondary/30",
      )}
    >
      {/* Top row: id, name, actions */}
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1 min-w-0">
          <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
            {t("openclaw.modelId", { defaultValue: "模型 ID" })}
          </label>
          <Input
            value={model.id}
            onChange={(e) => onChange(index, "id", e.target.value)}
            placeholder={t("openclaw.modelIdPlaceholder", {
              defaultValue: "claude-3-sonnet",
            })}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="flex-1 space-y-1 min-w-0">
          <label className="text-[10px] uppercase tracking-wide text-text-muted font-medium">
            {t("openclaw.modelName", { defaultValue: "显示名称" })}
          </label>
          <Input
            value={model.name ?? ""}
            onChange={(e) => onChange(index, "name", e.target.value)}
            placeholder={t("openclaw.modelNamePlaceholder", {
              defaultValue: "Claude 3 Sonnet",
            })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1 mt-5 flex-shrink-0">
          {/* Set as primary */}
          {model.id && !isPrimary && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={t("openclaw.panel.setAsPrimary", {
                defaultValue: "设为主模型",
              })}
              className="h-8 w-8 text-text-muted hover:text-amber-500"
              onClick={() => onSetPrimary(model.id)}
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
          )}
          {isPrimary && (
            <span className="flex items-center justify-center h-8 w-8">
              <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
            </span>
          )}
          {/* Remove */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-text-muted hover:text-destructive"
            onClick={() => onRemove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Status tags */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isPrimary && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <Star className="w-2.5 h-2.5 fill-amber-500" />
            {t("openclaw.panel.primaryBadge", { defaultValue: "主模型" })}
          </span>
        )}
        {model.reasoning && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
            {t("openclaw.panel.reasoningBadge", { defaultValue: "推理" })}
          </span>
        )}
        {model.contextWindow && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] text-text-muted bg-bg-secondary border border-border-subtle">
            {model.contextWindow >= 1000
              ? `${(model.contextWindow / 1000).toFixed(0)}K ctx`
              : `${model.contextWindow} ctx`}
          </span>
        )}
      </div>

      {/* Advanced options collapsible */}
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[11px] text-text-muted hover:text-text-primary px-1"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {t("openclaw.advancedOptions", { defaultValue: "高级选项" })}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {/* Context window / Max tokens / Reasoning */}
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-text-muted">
                {t("openclaw.contextWindow", { defaultValue: "上下文窗口" })}
              </label>
              <Input
                type="number"
                value={model.contextWindow ?? ""}
                onChange={(e) =>
                  onChange(
                    index,
                    "contextWindow",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="200000"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-text-muted">
                {t("openclaw.maxTokens", { defaultValue: "最大输出 Tokens" })}
              </label>
              <Input
                type="number"
                value={model.maxTokens ?? ""}
                onChange={(e) =>
                  onChange(
                    index,
                    "maxTokens",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
                placeholder="32000"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-text-muted">
                {t("openclaw.reasoning", { defaultValue: "推理模式" })}
              </label>
              <div className="flex items-center h-8 gap-2">
                <Switch
                  checked={model.reasoning ?? false}
                  onCheckedChange={(v) => onChange(index, "reasoning", v)}
                />
              </div>
            </div>
          </div>
          {/* Cost */}
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-text-muted">
                {t("openclaw.inputCost", {
                  defaultValue: "输入价格 ($/M)",
                })}
              </label>
              <Input
                type="number"
                step="0.001"
                value={model.cost?.input ?? ""}
                onChange={(e) => onCostChange(index, "input", e.target.value)}
                placeholder="3"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] text-text-muted">
                {t("openclaw.outputCost", {
                  defaultValue: "输出价格 ($/M)",
                })}
              </label>
              <Input
                type="number"
                step="0.001"
                value={model.cost?.output ?? ""}
                onChange={(e) => onCostChange(index, "output", e.target.value)}
                placeholder="15"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
