import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Plus, Pencil, Trash2, HardDriveDownload, BadgeCheck, Save, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  useOpenClawAgents,
  useAddAgent,
  useDeleteAgent,
  useUpdateAgentIdentity,
  useUpdateAgentModel,
  useBackupAgent,
  useOpenClawAgentsDefaults,
  useSaveOpenClawAgentsDefaults,
} from "@/hooks/useOpenClaw";
import { useOpenClawProviderModels } from "@/hooks/useOpenClaw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { extractErrorMessage } from "@/utils/errorUtils";
import { cn } from "@/lib/utils";
import type { OpenClawAgentInfo, OpenClawAgentsDefaults, OpenClawCompactionConfig, OpenClawContextPruningConfig } from "@/types";

// Simple skeleton shimmer element
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-muted ${className ?? ""}`}
    />
  );
}

interface AgentsPanelProps {
  onOpenChange: (open: boolean) => void;
  onAddOpen?: () => void;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
}

// ============================================================
// Add Agent Dialog
// ============================================================

interface AddAgentDialogProps {
  open: boolean;
  models: string[];
  onClose: () => void;
  onConfirm: (data: {
    id: string;
    name: string;
    emoji: string;
    model: string;
    workspace: string;
  }) => void;
  isLoading: boolean;
}

function EmojiButton({
  value,
  onChange,
  placeholder = "🤖",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const display = value.trim() || placeholder;

  return editing ? (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") setEditing(false);
      }}
      className="w-10 h-10 rounded-full border border-primary text-center text-lg bg-primary/5 outline-none flex-shrink-0"
      maxLength={4}
    />
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="点击修改 Emoji（可选）"
      className="w-10 h-10 rounded-full border border-border bg-muted/40 hover:bg-muted/80 flex items-center justify-center text-lg flex-shrink-0 transition-colors"
    >
      {display}
    </button>
  );
}

function AddAgentDialog({
  open,
  models,
  onClose,
  onConfirm,
  isLoading,
}: AddAgentDialogProps) {
  const { t } = useTranslation();
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [model, setModel] = useState(models[0] || "");
  const [workspace, setWorkspace] = useState("");

  const handleConfirm = () => {
    const id = agentId.trim();
    if (!id) {
      toast.warning(t("agentsPanel.idRequired"));
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(id)) {
      toast.warning(t("agentsPanel.idInvalid"));
      return;
    }
    onConfirm({ id, name: name.trim(), emoji: emoji.trim(), model, workspace: workspace.trim() });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setAgentId("");
      setName("");
      setEmoji("");
      setModel(models[0] || "");
      setWorkspace("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("agentsPanel.addTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div>
            <Label className="mb-1.5 block text-sm">{t("agentsPanel.agentId")}</Label>
            <Input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder={t("agentsPanel.agentIdPlaceholder")}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("agentsPanel.agentIdHint")}
            </p>
          </div>

          <div>
            <Label className="mb-1.5 block text-sm">
              {t("agentsPanel.name")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">（可选）</span>
            </Label>
            <div className="flex items-center gap-2">
              <EmojiButton value={emoji} onChange={setEmoji} />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agentsPanel.namePlaceholder")}
                className="flex-1"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">点击左侧图标可设置 Emoji（可选）</p>
          </div>

          {models.length > 0 && (
            <div>
              <Label className="mb-1.5 block text-sm">{t("agentsPanel.model")}</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder={t("agentsPanel.selectModel")} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="mb-1.5 block text-sm">{t("agentsPanel.workspace")}</Label>
            <Input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder={t("agentsPanel.workspacePlaceholder")}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? t("common.saving") : t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Edit Agent Dialog (Identity only: name + emoji)
// ============================================================

interface EditAgentDialogProps {
  open: boolean;
  agent: OpenClawAgentInfo | null;
  onClose: () => void;
  onConfirm: (data: { name: string; emoji: string }) => void;
  isLoading: boolean;
}

function EditAgentDialog({
  open,
  agent,
  onClose,
  onConfirm,
  isLoading,
}: EditAgentDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(agent?.identityName || "");
  const [emoji, setEmoji] = useState(agent?.identityEmoji || "");

  React.useEffect(() => {
    if (agent) {
      setName(agent.identityName || "");
      setEmoji(agent.identityEmoji || "");
    }
  }, [agent]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("agentsPanel.editTitle")}: {agent?.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div>
            <Label className="mb-1.5 block text-sm">
              {t("agentsPanel.name")}
              <span className="ml-1 text-xs font-normal text-muted-foreground">（可选）</span>
            </Label>
            <div className="flex items-center gap-2">
              <EmojiButton value={emoji} onChange={setEmoji} />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agentsPanel.namePlaceholder")}
                className="flex-1"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">点击左侧图标可设置 Emoji（可选）</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm({ name: name.trim(), emoji: emoji.trim() })}
            disabled={isLoading}
          >
            {isLoading ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Agent Card (expandable with inline model config)
// ============================================================

interface AgentCardProps {
  agent: OpenClawAgentInfo;
  models: string[];
  onEdit: (agent: OpenClawAgentInfo) => void;
  onDelete: (agent: OpenClawAgentInfo) => void;
  onBackup: (agent: OpenClawAgentInfo) => void;
  onModelChange: (agent: OpenClawAgentInfo, model: string) => void;
  isBackingUp: boolean;
  isSavingModel: boolean;
}

function AgentCard({ agent, models, onEdit, onDelete, onBackup, onModelChange, isBackingUp, isSavingModel }: AgentCardProps) {
  const { t } = useTranslation();
  const NONE_VALUE = "__none__";
  const [expanded, setExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(agent.model || NONE_VALUE);
  const displayName = agent.identityName || agent.id;
  const displayEmoji = agent.identityEmoji;

  // Sync model when agent prop changes
  useEffect(() => {
    setSelectedModel(agent.model || NONE_VALUE);
  }, [agent.model]);

  const hasModelChange = selectedModel !== (agent.model || NONE_VALUE);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Card header row */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: avatar + info */}
          <button
            className="flex items-start gap-3 min-w-0 flex-1 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
              {displayEmoji ? (
                <span>{displayEmoji}</span>
              ) : (
                <Bot className="w-5 h-5 text-primary" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className="font-semibold text-sm truncate">{displayName}</span>
                {agent.isDefault && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0 flex items-center gap-1">
                    <BadgeCheck className="w-3 h-3" />
                    {t("agentsPanel.default")}
                  </Badge>
                )}
                {displayName !== agent.id && (
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    [{agent.id}]
                  </span>
                )}
              </div>

              <div className="space-y-0.5 mt-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{t("agentsPanel.modelLabel")}: </span>
                  <span className="font-mono">
                    {agent.model || <span className="italic">{t("agentsPanel.notSet")}</span>}
                  </span>
                </p>
                {agent.workspace && (
                  <p className="text-xs text-muted-foreground truncate max-w-xs">
                    <span className="font-medium">{t("agentsPanel.workspaceLabel")}: </span>
                    <span className="font-mono">{agent.workspace}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex-shrink-0 text-muted-foreground mt-1">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {/* Right: actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onBackup(agent)}
              disabled={isBackingUp}
              title={t("agentsPanel.backup")}
            >
              <HardDriveDownload className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onEdit(agent)}
              title={t("agentsPanel.edit")}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            {!agent.isDefault && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:border-destructive"
                onClick={() => onDelete(agent)}
                title={t("agentsPanel.delete")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expandable model config section */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">
            {t("agentsPanel.modelLabel")}
          </p>
          {models.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="font-mono text-xs flex-1">
                  <SelectValue placeholder={t("agentsPanel.selectModel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE} className="font-mono text-xs italic text-muted-foreground">
                    {t("agentsPanel.notSet")}（使用全局默认）
                  </SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!hasModelChange || isSavingModel}
                onClick={() => onModelChange(agent, selectedModel === NONE_VALUE ? "" : selectedModel)}
                className="h-9 px-3 flex-shrink-0"
              >
                {isSavingModel ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("agentsPanel.noModelsHint")}
            </p>
          )}
          {agent.workspace && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <p className="text-xs font-medium text-muted-foreground mb-1">{t("agentsPanel.workspaceLabel")}</p>
              <p className="font-mono text-xs text-muted-foreground">{agent.workspace}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Skeleton loader
// ============================================================

function AgentCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AgentsDefaultsContent (inlined defaults panel)
// ============================================================

function AgentsDefaultsContent() {
  const { t } = useTranslation();
  const { data: agentsData, isLoading } = useOpenClawAgentsDefaults();
  const saveAgentsMutation = useSaveOpenClawAgentsDefaults();
  const [defaults, setDefaults] = useState<OpenClawAgentsDefaults | null>(null);

  const [workspace, setWorkspace] = useState("");
  const [timeout, setTimeout_] = useState("");
  const [contextTokens, setContextTokens] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState("");

  const [compactionMode, setCompactionMode] = useState("default");
  const [maxHistoryShare, setMaxHistoryShare] = useState("0.6");
  const [reserveTokensFloor, setReserveTokensFloor] = useState("40000");
  const [memoryFlushEnabled, setMemoryFlushEnabled] = useState(true);
  const [compactionEnabled, setCompactionEnabled] = useState(false);

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

      const concNum = maxConcurrent.trim() ? parseNum(maxConcurrent) : undefined;
      if (concNum !== undefined) updated.maxConcurrent = concNum;
      else delete updated.maxConcurrent;

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
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("openclaw.agents.description")}
      </p>

      {/* Runtime Parameters Card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium mb-4">
          {t("openclaw.agents.runtimeSection")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2 block">{t("openclaw.agents.workspace")}</Label>
            <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="~/projects" className="font-mono text-xs" />
          </div>
          <div>
            <Label className="mb-2 block">{t("openclaw.agents.timeout")}</Label>
            <Input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} placeholder="300（秒）" className="font-mono text-xs" />
          </div>
          <div>
            <Label className="mb-2 block">{t("openclaw.agents.contextTokens")}</Label>
            <Input type="number" value={contextTokens} onChange={(e) => setContextTokens(e.target.value)} placeholder="200000（推荐）" className="font-mono text-xs" />
          </div>
          <div>
            <Label className="mb-2 block">{t("openclaw.agents.maxConcurrent")}</Label>
            <Input type="number" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} placeholder="4（并行任务数）" className="font-mono text-xs" />
          </div>
        </div>
      </div>

      {/* Compaction & ContextPruning Card */}
      <div className="rounded-xl border border-border bg-card p-5">
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
              className={cn("relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", compactionEnabled ? "bg-primary" : "bg-muted-foreground/30")}
              role="switch"
              aria-checked={compactionEnabled}
            >
              <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", compactionEnabled ? "translate-x-4" : "translate-x-0")} />
            </button>
            <Label className="text-sm font-medium cursor-pointer" onClick={() => setCompactionEnabled(!compactionEnabled)}>启用 compaction</Label>
          </div>
          {compactionEnabled && (
            <div className="pl-11 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs">mode</Label>
                  <Select value={compactionMode} onValueChange={setCompactionMode}>
                    <SelectTrigger className="font-mono text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="font-mono text-xs">default</SelectItem>
                      <SelectItem value="summarize" className="font-mono text-xs">summarize</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">maxHistoryShare</Label>
                  <Input type="number" step="0.1" min="0" max="1" value={maxHistoryShare} onChange={(e) => setMaxHistoryShare(e.target.value)} placeholder="0.6" className="font-mono text-xs h-8" />
                  <p className="text-xs text-muted-foreground mt-0.5">历史消息占上下文比例上限（0~1）</p>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">reserveTokensFloor</Label>
                  <Input type="number" value={reserveTokensFloor} onChange={(e) => setReserveTokensFloor(e.target.value)} placeholder="40000" className="font-mono text-xs h-8" />
                  <p className="text-xs text-muted-foreground mt-0.5">为新消息保留的最小 Token 数</p>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">memoryFlush.enabled</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setMemoryFlushEnabled(!memoryFlushEnabled)}
                      className={cn("relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", memoryFlushEnabled ? "bg-primary" : "bg-muted-foreground/30")}
                      role="switch"
                      aria-checked={memoryFlushEnabled}
                    >
                      <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", memoryFlushEnabled ? "translate-x-4" : "translate-x-0")} />
                    </button>
                    <span className="text-xs text-muted-foreground">{memoryFlushEnabled ? "已启用（推荐）" : "已禁用"}</span>
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
              className={cn("relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none", contextPruningEnabled ? "bg-primary" : "bg-muted-foreground/30")}
              role="switch"
              aria-checked={contextPruningEnabled}
            >
              <span className={cn("pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", contextPruningEnabled ? "translate-x-4" : "translate-x-0")} />
            </button>
            <Label className="text-sm font-medium cursor-pointer" onClick={() => setContextPruningEnabled(!contextPruningEnabled)}>启用 contextPruning</Label>
          </div>
          {contextPruningEnabled && (
            <div className="pl-11">
              <div className="max-w-xs">
                <Label className="mb-1.5 block text-xs">mode</Label>
                <Select value={contextPruningMode} onValueChange={setContextPruningMode}>
                  <SelectTrigger className="font-mono text-xs h-8"><SelectValue /></SelectTrigger>
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
        <Button size="default" onClick={handleSave} disabled={saveAgentsMutation.isPending} className="min-w-[88px]">
          <Save className="w-4 h-4 mr-1" />
          {saveAgentsMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Main AgentsPanel
// ============================================================

export function AgentsPanel({ onAddOpen, addOpen: externalAddOpen, onAddOpenChange }: AgentsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"list" | "defaults">("list");
  const { data: agents, isLoading } = useOpenClawAgents();
  const { data: models = [] } = useOpenClawProviderModels(true);

  const addAgentMutation = useAddAgent();
  const deleteAgentMutation = useDeleteAgent();
  const updateIdentityMutation = useUpdateAgentIdentity();
  const updateModelMutation = useUpdateAgentModel();
  const backupAgentMutation = useBackupAgent();

  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<OpenClawAgentInfo | null>(null);
  const [deleteAgent, setDeleteAgent] = useState<OpenClawAgentInfo | null>(null);
  const [backingUpId, setBackingUpId] = useState<string | null>(null);

  // controlled or uncontrolled add dialog state
  const addOpen = externalAddOpen !== undefined ? externalAddOpen : internalAddOpen;
  const setAddOpen = (open: boolean) => {
    if (onAddOpenChange) {
      onAddOpenChange(open);
    } else {
      setInternalAddOpen(open);
    }
  };

  // expose open add dialog to parent via callback
  const handleOpenAdd = () => {
    setAddOpen(true);
    onAddOpen?.();
  };

  const handleAdd = async (data: {
    id: string;
    name: string;
    emoji: string;
    model: string;
    workspace: string;
  }) => {
    try {
      await addAgentMutation.mutateAsync({
        name: data.id,
        model: data.model || undefined,
        workspace: data.workspace || undefined,
      });
      // 更新 identity（名称和 emoji）
      if (data.name || data.emoji) {
        await updateIdentityMutation.mutateAsync({
          id: data.id,
          name: data.name || null,
          emoji: data.emoji || null,
        });
      }
      toast.success(t("agentsPanel.addSuccess"));
      setAddOpen(false);
    } catch (error) {
      toast.error(t("agentsPanel.addFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const handleEdit = async (data: { name: string; emoji: string }) => {
    if (!editAgent) return;
    try {
      await updateIdentityMutation.mutateAsync({
        id: editAgent.id,
        name: data.name || null,
        emoji: data.emoji || null,
      });
      toast.success(t("agentsPanel.editSuccess"));
      setEditAgent(null);
    } catch (error) {
      toast.error(t("agentsPanel.editFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const handleModelChange = async (agent: OpenClawAgentInfo, model: string) => {
    if (!model) return;
    try {
      await updateModelMutation.mutateAsync({ id: agent.id, model });
      toast.success(t("agentsPanel.editSuccess"));
    } catch (error) {
      toast.error(t("agentsPanel.editFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteAgent) return;
    try {
      await deleteAgentMutation.mutateAsync(deleteAgent.id);
      toast.success(t("agentsPanel.deleteSuccess"));
      setDeleteAgent(null);
    } catch (error) {
      toast.error(t("agentsPanel.deleteFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const handleBackup = async (agent: OpenClawAgentInfo) => {
    setBackingUpId(agent.id);
    try {
      const zipPath = await backupAgentMutation.mutateAsync(agent.id);
      const fileName = zipPath.split("/").pop() || zipPath;
      toast.success(t("agentsPanel.backupSuccess"), { description: fileName });
    } catch (error) {
      toast.error(t("agentsPanel.backupFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    } finally {
      setBackingUpId(null);
    }
  };

  return (
    <div className="px-6 pt-4 pb-8">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg mb-5 w-fit">
        <button
          onClick={() => setActiveTab("list")}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === "list"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("agentsPanel.tabList", { defaultValue: "智能体列表" })}
        </button>
        <button
          onClick={() => setActiveTab("defaults")}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
            activeTab === "defaults"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("agentsPanel.tabDefaults", { defaultValue: "默认配置" })}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "list" ? (
        <div className="space-y-3">
          {isLoading ? (
            <>
              <AgentCardSkeleton />
              <AgentCardSkeleton />
            </>
          ) : agents && agents.length > 0 ? (
            agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                models={models}
                onEdit={setEditAgent}
                onDelete={setDeleteAgent}
                onBackup={handleBackup}
                onModelChange={handleModelChange}
                isBackingUp={backingUpId === agent.id}
                isSavingModel={updateModelMutation.isPending}
              />
            ))
          ) : (
            <div className="rounded-xl border border-border bg-card p-10 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{t("agentsPanel.emptyTitle", { defaultValue: "还没有 Agent" })}</p>
                <p className="text-xs text-muted-foreground">{t("agentsPanel.emptyHint", { defaultValue: "创建一个 Agent 来配置独立的身份、模型和工作区" })}</p>
              </div>
              <Button
                size="sm"
                onClick={handleOpenAdd}
                disabled={models.length === 0}
                title={models.length === 0 ? t("agentsPanel.noModelsHint") : undefined}
              >
                <Plus className="w-4 h-4 mr-1" />
                {t("agentsPanel.addAgent")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <AgentsDefaultsContent />
      )}

      {/* Add Dialog */}
      <AddAgentDialog
        open={addOpen}
        models={models}
        onClose={() => setAddOpen(false)}
        onConfirm={handleAdd}
        isLoading={addAgentMutation.isPending || updateIdentityMutation.isPending}
      />

      {/* Edit Dialog */}
      <EditAgentDialog
        open={editAgent !== null}
        agent={editAgent}
        onClose={() => setEditAgent(null)}
        onConfirm={handleEdit}
        isLoading={updateIdentityMutation.isPending}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={deleteAgent !== null}
        title={t("agentsPanel.deleteTitle")}
        message={t("agentsPanel.deleteMessage", { id: deleteAgent?.id })}
        confirmText={t("common.delete")}
        onConfirm={handleDelete}
        onCancel={() => setDeleteAgent(null)}
      />
    </div>
  );
}
