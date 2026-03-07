import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Save, ChevronsUpDown, X, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  useOpenClawAgentsDefaults,
  useSaveOpenClawAgentsDefaults,
  useOpenClawProviderModels,
} from "@/hooks/useOpenClaw";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { OpenClawAgentsDefaults, OpenClawModelCatalogEntry, OpenClawCompactionConfig, OpenClawContextPruningConfig } from "@/types";

const AgentsDefaultsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { data: agentsData, isLoading } = useOpenClawAgentsDefaults();
  const { data: availableModels = [] } = useOpenClawProviderModels();
  const saveAgentsMutation = useSaveOpenClawAgentsDefaults();
  const [defaults, setDefaults] = useState<OpenClawAgentsDefaults | null>(null);

  // Primary model: single select
  const [primaryModel, setPrimaryModel] = useState("");
  // Fallback models: multi select
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  // Extra known fields from agents.defaults
  const [workspace, setWorkspace] = useState("");
  const [timeout, setTimeout_] = useState("");
  const [contextTokens, setContextTokens] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState("");

  // Compaction config
  const [compactionMode, setCompactionMode] = useState("default");
  const [maxHistoryShare, setMaxHistoryShare] = useState("0.6");
  const [reserveTokensFloor, setReserveTokensFloor] = useState("40000");
  const [memoryFlushEnabled, setMemoryFlushEnabled] = useState(true);
  const [compactionEnabled, setCompactionEnabled] = useState(false);

  // ContextPruning config
  const [contextPruningMode, setContextPruningMode] = useState("cache-ttl");
  const [contextPruningEnabled, setContextPruningEnabled] = useState(false);

  useEffect(() => {
    if (agentsData === undefined) return;
    setDefaults(agentsData);

    if (agentsData) {
      setPrimaryModel(agentsData.model?.primary ?? "");
      setFallbackModels(agentsData.model?.fallbacks ?? []);

      setWorkspace(String(agentsData.workspace ?? ""));
      setTimeout_(String(agentsData.timeout ?? ""));
      setContextTokens(String(agentsData.contextTokens ?? ""));
      setMaxConcurrent(String(agentsData.maxConcurrent ?? ""));

      // Compaction
      if (agentsData.compaction) {
        setCompactionEnabled(true);
        const c = agentsData.compaction as OpenClawCompactionConfig;
        setCompactionMode(String(c.mode ?? "default"));
        setMaxHistoryShare(String(c.maxHistoryShare ?? "0.6"));
        setReserveTokensFloor(String(c.reserveTokensFloor ?? "40000"));
        setMemoryFlushEnabled((c.memoryFlush as { enabled?: boolean } | undefined)?.enabled !== false);
      } else {
        setCompactionEnabled(false);
      }

      // ContextPruning
      if (agentsData.contextPruning) {
        setContextPruningEnabled(true);
        const cp = agentsData.contextPruning as OpenClawContextPruningConfig;
        setContextPruningMode(String(cp.mode ?? "cache-ttl"));
      } else {
        setContextPruningEnabled(false);
      }
    }
  }, [agentsData]);

  // Compute invalid models: models saved in agents.defaults but not in models.providers
  // Must be declared before any early returns to satisfy React Hooks rules
  const invalidDefaultModels = useMemo(() => {
    if (availableModels.length === 0) return [];
    const availableSet = new Set(availableModels);
    const candidates: string[] = [];
    if (primaryModel) candidates.push(primaryModel);
    candidates.push(...fallbackModels);
    return candidates.filter((m) => m && !availableSet.has(m));
  }, [primaryModel, fallbackModels, availableModels]);

  const toggleFallback = (model: string) => {
    setFallbackModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model],
    );
  };

  const removeFallback = (model: string) => {
    setFallbackModels((prev) => prev.filter((m) => m !== model));
  };

  const handleSave = async () => {
    try {
      const updated: OpenClawAgentsDefaults = { ...defaults };

      // When provider models are available, remove agents.defaults.models entries
      // whose keys are not present in models.providers (i.e. invalid/stale catalog entries)
      if (availableModels.length > 0 && updated.models) {
        const availableSet = new Set(availableModels);
        const filteredModels: Record<string, OpenClawModelCatalogEntry> = {};
        for (const [key, val] of Object.entries(updated.models)) {
          if (availableSet.has(key)) {
            filteredModels[key] = val;
          }
        }
        updated.models = filteredModels;
      }

      if (primaryModel) {
        updated.model = {
          primary: primaryModel,
          ...(fallbackModels.length > 0 ? { fallbacks: fallbackModels } : {}),
        };
      } else if (fallbackModels.length > 0) {
        updated.model = { primary: "", fallbacks: fallbackModels };
      }

      if (workspace.trim()) updated.workspace = workspace.trim();
      else delete updated.workspace;

      const parseNum = (v: string) => {
        const n = Number(v);
        return !isNaN(n) && isFinite(n) ? n : undefined;
      };

      const timeoutNum = timeout.trim() ? parseNum(timeout) : undefined;
      if (timeoutNum !== undefined) updated.timeout = timeoutNum;
      else delete updated.timeout;

      const ctxNum = contextTokens.trim() ? parseNum(contextTokens) : undefined;
      if (ctxNum !== undefined) updated.contextTokens = ctxNum;
      else delete updated.contextTokens;

      const concNum = maxConcurrent.trim()
        ? parseNum(maxConcurrent)
        : undefined;
      if (concNum !== undefined) updated.maxConcurrent = concNum;
      else delete updated.maxConcurrent;

      // Compaction
      if (compactionEnabled) {
        const parseFloat_ = (v: string) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
        updated.compaction = {
          mode: compactionMode || "default",
          maxHistoryShare: parseFloat_(maxHistoryShare) ?? 0.6,
          reserveTokensFloor: parseNum(reserveTokensFloor) ?? 40000,
          memoryFlush: { enabled: memoryFlushEnabled },
        };
      } else {
        delete updated.compaction;
      }

      // ContextPruning
      if (contextPruningEnabled) {
        updated.contextPruning = { mode: contextPruningMode || "cache-ttl" };
      } else {
        delete updated.contextPruning;
      }

      await saveAgentsMutation.mutateAsync(updated);
      toast.success(t("openclaw.agents.saveSuccess"));
    } catch (error) {
      const detail = extractErrorMessage(error);
      toast.error(t("openclaw.agents.saveFailed"), {
        description: detail || undefined,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="px-6 pt-4 pb-8 flex items-center justify-center min-h-[200px]">
        <div className="text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  // Remove all invalid models from current selections, then auto-save
  const handleClearInvalidModels = async () => {
    if (availableModels.length === 0) return;
    const availableSet = new Set(availableModels);
    const newPrimary = primaryModel && !availableSet.has(primaryModel) ? "" : primaryModel;
    const newFallbacks = fallbackModels.filter((m) => availableSet.has(m));

    setPrimaryModel(newPrimary);
    setFallbackModels(newFallbacks);

    // Auto-save immediately with the cleaned values
    try {
      const updated: OpenClawAgentsDefaults = { ...defaults };

      if (availableModels.length > 0 && updated.models) {
        const filteredModels: Record<string, OpenClawModelCatalogEntry> = {};
        for (const [key, val] of Object.entries(updated.models)) {
          if (availableSet.has(key)) {
            filteredModels[key] = val;
          }
        }
        updated.models = filteredModels;
      }

      if (newPrimary) {
        updated.model = {
          primary: newPrimary,
          ...(newFallbacks.length > 0 ? { fallbacks: newFallbacks } : {}),
        };
      } else if (newFallbacks.length > 0) {
        updated.model = { primary: "", fallbacks: newFallbacks };
      } else {
        updated.model = { primary: "" };
      }

      if (workspace.trim()) updated.workspace = workspace.trim();
      else delete updated.workspace;

      const parseNum = (v: string) => {
        const n = Number(v);
        return !isNaN(n) && isFinite(n) ? n : undefined;
      };

      const timeoutNum = timeout.trim() ? parseNum(timeout) : undefined;
      if (timeoutNum !== undefined) updated.timeout = timeoutNum;
      else delete updated.timeout;

      const ctxNum = contextTokens.trim() ? parseNum(contextTokens) : undefined;
      if (ctxNum !== undefined) updated.contextTokens = ctxNum;
      else delete updated.contextTokens;

      const concNum = maxConcurrent.trim() ? parseNum(maxConcurrent) : undefined;
      if (concNum !== undefined) updated.maxConcurrent = concNum;
      else delete updated.maxConcurrent;

      await saveAgentsMutation.mutateAsync(updated);
      toast.success(t("openclaw.agents.saveSuccess"));
    } catch (error) {
      const detail = extractErrorMessage(error);
      toast.error(t("openclaw.agents.saveFailed"), {
        description: detail || undefined,
      });
    }
  };

  return (
    <div className="px-6 pt-4 pb-8">
      <p className="text-sm text-muted-foreground mb-6">
        {t("openclaw.agents.description")}
      </p>

      {/* Invalid model warning banner */}
      {invalidDefaultModels.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border-l-4 border-l-amber-500 bg-amber-50/90 px-4 py-3 text-sm mb-4 shadow-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-800">
              {t("openclaw.agents.invalidModelWarning.title", {
                defaultValue: "以下模型不在当前供应商列表中",
              })}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {t("openclaw.agents.invalidModelWarning.desc", {
                defaultValue:
                  "请重新选择有效模型，或先前往\"供应商配置\"添加对应供应商：",
              })}
              <span className="font-mono">
                {" "}{invalidDefaultModels.join("、")}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearInvalidModels}
            className="shrink-0 flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 transition-colors"
          >
            <X className="h-3 w-3" />
            {t("openclaw.agents.invalidModelWarning.clearBtn", {
              defaultValue: "清除无效模型",
            })}
          </button>
        </div>
      )}

      {/* Model Configuration Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <h3 className="text-sm font-medium mb-4">
          {t("openclaw.agents.modelSection")}
        </h3>

        <div className="space-y-4">
          {/* Primary Model - single select dropdown */}
          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.primaryModel")}
            </Label>
            {availableModels.length > 0 ? (
              <Select value={primaryModel} onValueChange={setPrimaryModel}>
                <SelectTrigger className="font-mono text-xs h-9">
                  <SelectValue placeholder={t("openclaw.agents.notSet")} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model} value={model} className="font-mono text-xs">
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="h-9 px-3 flex items-center rounded-md border border-input bg-muted/50 font-mono text-xs text-muted-foreground">
                {primaryModel || t("openclaw.agents.notSet")}
              </div>
            )}
            {availableModels.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("openclaw.agents.primaryModelHint")}
              </p>
            )}
          </div>

          {/* Fallback Models - multi select dropdown */}
          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.fallbackModels")}
            </Label>
            {availableModels.length > 0 ? (
              <>
                <Popover open={fallbackOpen} onOpenChange={setFallbackOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={fallbackOpen}
                      className="w-full justify-between h-auto min-h-9 font-mono text-xs"
                    >
                      <span className="text-muted-foreground">
                        {fallbackModels.length > 0
                          ? t("openclaw.agents.fallbackSelected", {
                              count: fallbackModels.length,
                              defaultValue: `已选 ${fallbackModels.length} 个模型`,
                            })
                          : t("openclaw.agents.fallbackPlaceholder", {
                              defaultValue: "选择回退模型...",
                            })}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder={t("openclaw.agents.fallbackSearch", {
                          defaultValue: "搜索模型...",
                        })}
                        className="h-9 text-xs"
                      />
                      <CommandList>
                        <CommandEmpty>
                          {t("openclaw.agents.noModels", {
                            defaultValue: "无可用模型",
                          })}
                        </CommandEmpty>
                        <CommandGroup>
                          {availableModels
                            .filter((m) => m !== primaryModel)
                            .map((model) => (
                              <CommandItem
                                key={model}
                                value={model}
                                onSelect={() => toggleFallback(model)}
                                className="font-mono text-xs data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                              >
                                <span
                                  className={cn(
                                    "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                                    fallbackModels.includes(model)
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-muted-foreground/40",
                                  )}
                                >
                                  {fallbackModels.includes(model) && (
                                    <Check className="h-3 w-3" />
                                  )}
                                </span>
                                {model}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {/* Selected fallback tags */}
                {fallbackModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {fallbackModels.map((model, idx) => {
                      const isInvalid = availableModels.length > 0 && !availableModels.includes(model);
                      return (
                        <span
                          key={model}
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono border",
                            isInvalid
                              ? "bg-destructive/8 border-destructive/40 text-destructive"
                              : "bg-primary/8 border-primary/20",
                          )}
                          title={isInvalid ? t("openclaw.agents.invalidModelWarning.title", { defaultValue: "以下模型不在当前供应商列表中" }) : undefined}
                        >
                          <span className={cn("text-[11px] font-semibold tabular-nums", isInvalid ? "text-destructive/60" : "text-primary/60")}>
                            {idx + 1}.
                          </span>
                          {model}
                          <button
                            onClick={() => removeFallback(model)}
                            className="ml-0.5 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                            type="button"
                          >
                            <X className="h-3 w-3" />

                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {t("openclaw.agents.fallbackModelsHint")}
                </p>
              </>
            ) : (
              <>
                <Input
                  value={fallbackModels.join(", ")}
                  onChange={(e) =>
                    setFallbackModels(
                      e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                  placeholder="provider/model-a, provider/model-b"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("openclaw.agents.fallbackModelsHint")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Runtime Parameters Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <h3 className="text-sm font-medium mb-4">
          {t("openclaw.agents.runtimeSection")}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.workspace")}
            </Label>
            <Input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="~/projects"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.timeout")}
            </Label>
            <Input
              type="number"
              value={timeout}
              onChange={(e) => setTimeout_(e.target.value)}
              placeholder="300（秒）"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.contextTokens")}
            </Label>
            <Input
              type="number"
              value={contextTokens}
              onChange={(e) => setContextTokens(e.target.value)}
              placeholder="200000（推荐）"
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label className="mb-2 block">
              {t("openclaw.agents.maxConcurrent")}
            </Label>
            <Input
              type="number"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
              placeholder="4（并行任务数）"
              className="font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Compaction & ContextPruning Card */}
      <div className="rounded-xl border border-border bg-card p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">上下文压缩优化</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          配置对话历史压缩策略，可有效降低 Token 消耗、提升长对话质量。
        </p>

        {/* Compaction section */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setCompactionEnabled(!compactionEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                compactionEnabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
              role="switch"
              aria-checked={compactionEnabled}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  compactionEnabled ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
            <Label className="text-sm font-medium cursor-pointer" onClick={() => setCompactionEnabled(!compactionEnabled)}>
              启用 compaction
            </Label>
          </div>

          {compactionEnabled && (
            <div className="pl-11 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs">mode</Label>
                  <Select value={compactionMode} onValueChange={setCompactionMode}>
                    <SelectTrigger className="font-mono text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="font-mono text-xs">default</SelectItem>
                      <SelectItem value="summarize" className="font-mono text-xs">summarize</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">maxHistoryShare</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={maxHistoryShare}
                    onChange={(e) => setMaxHistoryShare(e.target.value)}
                    placeholder="0.6"
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">历史消息占上下文比例上限（0~1）</p>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">reserveTokensFloor</Label>
                  <Input
                    type="number"
                    value={reserveTokensFloor}
                    onChange={(e) => setReserveTokensFloor(e.target.value)}
                    placeholder="40000"
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">为新消息保留的最小 Token 数</p>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">memoryFlush.enabled</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setMemoryFlushEnabled(!memoryFlushEnabled)}
                      className={cn(
                        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        memoryFlushEnabled ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                      role="switch"
                      aria-checked={memoryFlushEnabled}
                    >
                      <span
                        className={cn(
                          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                          memoryFlushEnabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {memoryFlushEnabled ? "已启用（推荐）" : "已禁用"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ContextPruning section */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setContextPruningEnabled(!contextPruningEnabled)}
              className={cn(
                "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                contextPruningEnabled ? "bg-primary" : "bg-muted-foreground/30",
              )}
              role="switch"
              aria-checked={contextPruningEnabled}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  contextPruningEnabled ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
            <Label className="text-sm font-medium cursor-pointer" onClick={() => setContextPruningEnabled(!contextPruningEnabled)}>
              启用 contextPruning
            </Label>
          </div>

          {contextPruningEnabled && (
            <div className="pl-11">
              <div className="max-w-xs">
                <Label className="mb-1.5 block text-xs">mode</Label>
                <Select value={contextPruningMode} onValueChange={setContextPruningMode}>
                  <SelectTrigger className="font-mono text-xs h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cache-ttl" className="font-mono text-xs">cache-ttl（推荐）</SelectItem>
                    <SelectItem value="sliding-window" className="font-mono text-xs">sliding-window</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-0.5">使用 TTL 缓存策略修剪过期上下文</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          size="default"
          onClick={handleSave}
          disabled={saveAgentsMutation.isPending}
          className="min-w-[88px]"
        >
          <Save className="w-4 h-4 mr-1" />
          {saveAgentsMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
};

export default AgentsDefaultsPanel;
