import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Plus, Pencil, Trash2, Archive, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import {
  useOpenClawAgents,
  useAddAgent,
  useDeleteAgent,
  useUpdateAgentIdentity,
  useUpdateAgentModel,
  useBackupAgent,
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
import type { OpenClawAgentInfo } from "@/types";

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

        <div className="space-y-4 py-2">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-sm">{t("agentsPanel.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agentsPanel.namePlaceholder")}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("agentsPanel.emoji")}</Label>
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🤖"
              />
            </div>
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
// Edit Agent Dialog
// ============================================================

interface EditAgentDialogProps {
  open: boolean;
  agent: OpenClawAgentInfo | null;
  models: string[];
  onClose: () => void;
  onConfirm: (data: { name: string; emoji: string; model: string }) => void;
  isLoading: boolean;
}

function EditAgentDialog({
  open,
  agent,
  models,
  onClose,
  onConfirm,
  isLoading,
}: EditAgentDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(agent?.identityName || "");
  const [emoji, setEmoji] = useState(agent?.identityEmoji || "");
  const [model, setModel] = useState(agent?.model || models[0] || "");

  // 当 agent 变化时同步初始值
  React.useEffect(() => {
    if (agent) {
      setName(agent.identityName || "");
      setEmoji(agent.identityEmoji || "");
      setModel(agent.model || models[0] || "");
    }
  }, [agent, models]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("agentsPanel.editTitle")} — {agent?.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-sm">{t("agentsPanel.name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("agentsPanel.namePlaceholder")}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("agentsPanel.emoji")}</Label>
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="🤖"
              />
            </div>
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
              value={agent?.workspace || t("agentsPanel.notSet")}
              readOnly
              className="font-mono text-xs text-muted-foreground bg-muted cursor-not-allowed"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm({ name: name.trim(), emoji: emoji.trim(), model })}
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
// Agent Card
// ============================================================

interface AgentCardProps {
  agent: OpenClawAgentInfo;
  onEdit: (agent: OpenClawAgentInfo) => void;
  onDelete: (agent: OpenClawAgentInfo) => void;
  onBackup: (agent: OpenClawAgentInfo) => void;
  isBackingUp: boolean;
}

function AgentCard({ agent, onEdit, onDelete, onBackup, isBackingUp }: AgentCardProps) {
  const { t } = useTranslation();
  const displayName = agent.identityName || agent.id;
  const displayEmoji = agent.identityEmoji;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Left: avatar + info */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
            {displayEmoji ? (
              <span>{displayEmoji}</span>
            ) : (
              <Bot className="w-5 h-5 text-primary" />
            )}
          </div>

          <div className="min-w-0">
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
              <p className="text-xs text-muted-foreground truncate max-w-xs">
                <span className="font-medium">{t("agentsPanel.workspaceLabel")}: </span>
                <span className="font-mono">
                  {agent.workspace || <span className="italic">{t("agentsPanel.notSet")}</span>}
                </span>
              </p>
            </div>
          </div>
        </div>

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
            <Archive className="w-3.5 h-3.5" />
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
// Main AgentsPanel
// ============================================================

export function AgentsPanel({ onAddOpen, addOpen: externalAddOpen, onAddOpenChange }: AgentsPanelProps) {
  const { t } = useTranslation();
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

  const handleEdit = async (data: { name: string; emoji: string; model: string }) => {
    if (!editAgent) return;
    try {
      const promises: Promise<unknown>[] = [];

      if (data.name !== (editAgent.identityName || "") || data.emoji !== (editAgent.identityEmoji || "")) {
        promises.push(
          updateIdentityMutation.mutateAsync({
            id: editAgent.id,
            name: data.name || null,
            emoji: data.emoji || null,
          }),
        );
      }

      if (data.model && data.model !== editAgent.model) {
        promises.push(
          updateModelMutation.mutateAsync({ id: editAgent.id, model: data.model }),
        );
      }

      await Promise.all(promises);
      toast.success(t("agentsPanel.editSuccess"));
      setEditAgent(null);
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
      {/* Agent list */}
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
              onEdit={setEditAgent}
              onDelete={setDeleteAgent}
              onBackup={handleBackup}
              isBackingUp={backingUpId === agent.id}
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
        models={models}
        onClose={() => setEditAgent(null)}
        onConfirm={handleEdit}
        isLoading={updateIdentityMutation.isPending || updateModelMutation.isPending}
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
