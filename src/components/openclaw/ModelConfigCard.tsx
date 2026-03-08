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
import type { OpenClawAgentsDefaults, OpenClawModelCatalogEntry } from "@/types";

interface ModelConfigCardProps {
  className?: string;
}

const ModelConfigCard: React.FC<ModelConfigCardProps> = ({ className }) => {
  const { t } = useTranslation();
  const { data: agentsData } = useOpenClawAgentsDefaults();
  const { data: availableModels = [] } = useOpenClawProviderModels();
  const saveAgentsMutation = useSaveOpenClawAgentsDefaults();
  const [defaults, setDefaults] = useState<OpenClawAgentsDefaults | null>(null);

  // Primary model: single select
  const [primaryModel, setPrimaryModel] = useState("");
  // Fallback models: multi select
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  useEffect(() => {
    if (agentsData === undefined) return;
    setDefaults(agentsData);

    if (agentsData) {
      setPrimaryModel(agentsData.model?.primary ?? "");
      setFallbackModels(agentsData.model?.fallbacks ?? []);
    }
  }, [agentsData]);

  // Compute invalid models: models saved in agents.defaults but not in models.providers
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

  const buildUpdatedDefaults = (
    currentDefaults: OpenClawAgentsDefaults | null,
    primary: string,
    fallbacks: string[],
  ): OpenClawAgentsDefaults => {
    const updated: OpenClawAgentsDefaults = { ...currentDefaults };

    // Remove stale catalog entries
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

    if (primary) {
      updated.model = {
        primary,
        ...(fallbacks.length > 0 ? { fallbacks } : {}),
      };
    } else if (fallbacks.length > 0) {
      updated.model = { primary: "", fallbacks };
    }

    return updated;
  };

  const handleSave = async () => {
    try {
      const updated = buildUpdatedDefaults(defaults, primaryModel, fallbackModels);
      await saveAgentsMutation.mutateAsync(updated);
      toast.success(t("openclaw.agents.saveSuccess"));
    } catch (error) {
      const detail = extractErrorMessage(error);
      toast.error(t("openclaw.agents.saveFailed"), {
        description: detail || undefined,
      });
    }
  };

  const handleClearInvalidModels = async () => {
    if (availableModels.length === 0) return;
    const availableSet = new Set(availableModels);
    const newPrimary = primaryModel && !availableSet.has(primaryModel) ? "" : primaryModel;
    const newFallbacks = fallbackModels.filter((m) => availableSet.has(m));

    setPrimaryModel(newPrimary);
    setFallbackModels(newFallbacks);

    try {
      const updated = buildUpdatedDefaults(defaults, newPrimary, newFallbacks);
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
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <h3 className="text-sm font-medium mb-1">
        {t("openclaw.agents.modelSection", { defaultValue: "模型配置" })}
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        {t("openclaw.modelConfig.description", {
          defaultValue: "选择主模型及回退模型，主模型不可用时自动切换到回退模型。",
        })}
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
                  '请重新选择有效模型，或先添加对应供应商：',
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

      <div className="space-y-4">
        {/* Primary Model - single select dropdown */}
        <div>
          <Label className="mb-2 block">
            {t("openclaw.agents.primaryModel", { defaultValue: "主模型" })}
          </Label>
          {availableModels.length > 0 ? (
            <Select value={primaryModel} onValueChange={setPrimaryModel}>
              <SelectTrigger className="font-mono text-xs h-9">
                <SelectValue placeholder={t("openclaw.agents.notSet", { defaultValue: "未设置" })} />
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
              {primaryModel || t("openclaw.agents.notSet", { defaultValue: "未设置" })}
            </div>
          )}
          {availableModels.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {t("openclaw.agents.primaryModelHint", {
                defaultValue: "请先添加供应商并配置模型",
              })}
            </p>
          )}
        </div>

        {/* Fallback Models - multi select dropdown */}
        <div>
          <Label className="mb-2 block">
            {t("openclaw.agents.fallbackModels", { defaultValue: "回退模型" })}
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
                        <span className={cn(
                          "text-[10px] tabular-nums opacity-40 select-none",
                          isInvalid ? "text-destructive" : "text-primary",
                        )}>
                          {idx + 1}
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
                {t("openclaw.agents.fallbackModelsHint", {
                  defaultValue: "主模型不可用时依序尝试回退模型",
                })}
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
                {t("openclaw.agents.fallbackModelsHint", {
                  defaultValue: "主模型不可用时依序尝试回退模型",
                })}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end mt-4">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saveAgentsMutation.isPending}
          className="min-w-[72px]"
        >
          <Save className="w-3.5 h-3.5 mr-1" />
          {saveAgentsMutation.isPending ? t("common.saving", { defaultValue: "保存中..." }) : t("common.save", { defaultValue: "保存" })}
        </Button>
      </div>
    </div>
  );
};

export default ModelConfigCard;
