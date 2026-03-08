import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  useOpenClawAgentsDefaults,
  useSaveOpenClawAgentsDefaults,
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
import { cn } from "@/lib/utils";
import type { OpenClawAgentsDefaults, OpenClawCompactionConfig, OpenClawContextPruningConfig } from "@/types";

const AgentsDefaultsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { data: agentsData, isLoading } = useOpenClawAgentsDefaults();
  const saveAgentsMutation = useSaveOpenClawAgentsDefaults();
  const [defaults, setDefaults] = useState<OpenClawAgentsDefaults | null>(null);

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

  const handleSave = async () => {
    try {
      const updated: OpenClawAgentsDefaults = { ...defaults };

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

  return (
    <div className="px-6 pt-4 pb-8">
      <p className="text-sm text-muted-foreground mb-6">
        {t("openclaw.agents.description")}
      </p>

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
