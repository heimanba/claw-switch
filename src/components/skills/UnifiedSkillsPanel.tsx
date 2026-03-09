import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Trash2, ExternalLink, Search, Upload, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useInstalledSkills,
  useToggleSkillApp,
  useUninstallSkill,
  useScanUnmanagedSkills,
  useImportSkillsFromApps,
  useInstallSkillsFromZip,
  type InstalledSkill,
} from "@/hooks/useSkills";
import type { AppId } from "@/lib/api/types";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi, skillsApi } from "@/lib/api";
import { toast } from "sonner";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { ListItemRow } from "@/components/common/ListItemRow";

interface UnifiedSkillsPanelProps {
  currentApp: AppId;
  onOpenDiscovery: () => void;
}

export interface UnifiedSkillsPanelHandle {
  openImport: () => void;
  openInstallFromZip: () => void;
  refresh: () => void;
}

const UnifiedSkillsPanel = React.forwardRef<
  UnifiedSkillsPanelHandle,
  UnifiedSkillsPanelProps
>(({ currentApp, onOpenDiscovery }, ref) => {
  const { t } = useTranslation();
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: skills, isLoading, refetch: refetchSkills } = useInstalledSkills();
  const toggleAppMutation = useToggleSkillApp();
  const uninstallMutation = useUninstallSkill();
  const { data: unmanagedSkills, refetch: scanUnmanaged } =
    useScanUnmanagedSkills();
  const importMutation = useImportSkillsFromApps();
  const installFromZipMutation = useInstallSkillsFromZip();

  /** 仅显示当前应用已启用的技能 */
  const skillsForCurrentApp = useMemo(() => {
    if (!skills) return [];
    return skills.filter((skill) => skill.apps[currentApp]);
  }, [skills, currentApp]);

  /** 根据搜索查询过滤技能 */
  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skillsForCurrentApp;
    
    const query = searchQuery.toLowerCase();
    return skillsForCurrentApp.filter(skill => 
      skill.name.toLowerCase().includes(query) ||
      skill.description?.toLowerCase().includes(query) ||
      (skill.repoOwner && skill.repoName && 
       `${skill.repoOwner}/${skill.repoName}`.toLowerCase().includes(query))
    );
  }, [skillsForCurrentApp, searchQuery]);

  const handleToggleApp = async (id: string, app: AppId, enabled: boolean) => {
    try {
      await toggleAppMutation.mutateAsync({ id, app, enabled });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleUninstall = (skill: InstalledSkill) => {
    setConfirmDialog({
      isOpen: true,
      title: t("skills.uninstall"),
      message: t("skills.uninstallConfirm", { name: skill.name }),
      onConfirm: async () => {
        try {
          await uninstallMutation.mutateAsync(skill.id);
          setConfirmDialog(null);
          toast.success(t("skills.uninstallSuccess", { name: skill.name }), {
            closeButton: true,
          });
        } catch (error) {
          toast.error(t("common.error"), { description: String(error) });
        }
      },
    });
  };

  const handleOpenImport = async () => {
    try {
      const result = await scanUnmanaged();
      if (!result.data || result.data.length === 0) {
        toast.success(t("skills.noUnmanagedFound"), { closeButton: true });
        return;
      }
      const forCurrentApp = result.data.filter((s) => s.foundIn.includes(currentApp));
      if (forCurrentApp.length === 0) {
        toast.success(t("skills.noUnmanagedFound"), { closeButton: true });
        return;
      }
      setImportDialogOpen(true);
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleImport = async (directories: string[]) => {
    try {
      const imported = await importMutation.mutateAsync(directories);
      setImportDialogOpen(false);
      toast.success(t("skills.importSuccess", { count: imported.length }), {
        closeButton: true,
      });
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  const handleInstallFromZip = async () => {
    try {
      const filePath = await skillsApi.openZipFileDialog();
      if (!filePath) return;

      const installed = await installFromZipMutation.mutateAsync({
        filePath,
        currentApp,
      });

      if (installed.length === 0) {
        toast.info(t("skills.installFromZip.noSkillsFound"), {
          closeButton: true,
        });
      } else if (installed.length === 1) {
        toast.success(
          t("skills.installFromZip.successSingle", { name: installed[0].name }),
          { closeButton: true },
        );
      } else {
        toast.success(
          t("skills.installFromZip.successMultiple", {
            count: installed.length,
          }),
          { closeButton: true },
        );
      }
    } catch (error) {
      toast.error(t("skills.installFailed"), { description: String(error) });
    }
  };

  React.useImperativeHandle(ref, () => ({
    openImport: handleOpenImport,
    openInstallFromZip: handleInstallFromZip,
    refresh: () => {
      refetchSkills();
      scanUnmanaged();
    },
  }));

  const unmanagedForCurrentApp = useMemo(() => {
    if (!unmanagedSkills) return [];
    return unmanagedSkills.filter((s) => s.foundIn.includes(currentApp));
  }, [unmanagedSkills, currentApp]);

  return (
    <div className="px-6 flex flex-col h-[calc(100vh-8rem)] overflow-hidden">
      {/* 搜索栏 */}
      {skillsForCurrentApp.length > 0 && (
        <div className="pt-4 pb-3 border-b border-border-default">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("skills.searchInstalled", { defaultValue: "搜索已安装的技能..." })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            {t("skills.loading")}
          </div>
        ) : skillsForCurrentApp.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl flex items-center justify-center">
              <Sparkles size={32} className="text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-3">
              {t("skills.noInstalled")}
            </h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
              {t("skills.noInstalledDescription")}
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={onOpenDiscovery} className="gap-2">
                <Search className="h-4 w-4" />
                {t("skills.discover", { defaultValue: "发现技能" })}
              </Button>
              <Button variant="outline" onClick={handleInstallFromZip} className="gap-2">
                <Upload className="h-4 w-4" />
                {t("skills.installFromZip.title", { defaultValue: "从 ZIP 安装" })}
              </Button>
            </div>
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
              <Search size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("skills.noSearchResults", { defaultValue: "未找到匹配的技能" })}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("skills.noSearchResultsDescription", { 
                defaultValue: "尝试使用不同的关键词搜索" 
              })}
            </p>
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            {/* 搜索结果计数 */}
            {searchQuery.trim() && (
              <p className="mb-3 text-xs text-muted-foreground">
                {t("skills.searchResults", { 
                  count: filteredSkills.length,
                  total: skillsForCurrentApp.length,
                  defaultValue: "找到 {{count}} 个技能（共 {{total}} 个）"
                })}
              </p>
            )}
            <div className="rounded-xl border border-border-default overflow-hidden">
              {filteredSkills.map((skill, index) => (
                <InstalledSkillListItem
                  key={skill.id}
                  skill={skill}
                  onToggleApp={handleToggleApp}
                  onUninstall={() => handleUninstall(skill)}
                  isLast={index === filteredSkills.length - 1}
                  appIds={[currentApp]}
                  currentApp={currentApp}
                />
              ))}
            </div>
          </TooltipProvider>
        )}
      </div>

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {importDialogOpen && unmanagedSkills && (
        <ImportSkillsDialog
          skills={unmanagedForCurrentApp}
          onImport={handleImport}
          onClose={() => setImportDialogOpen(false)}
        />
      )}
    </div>
  );
});

UnifiedSkillsPanel.displayName = "UnifiedSkillsPanel";

interface InstalledSkillListItemProps {
  skill: InstalledSkill;
  onToggleApp: (id: string, app: AppId, enabled: boolean) => void;
  onUninstall: () => void;
  isLast?: boolean;
  appIds: AppId[];
  currentApp: AppId;
}

const InstalledSkillListItem: React.FC<InstalledSkillListItemProps> = ({
  skill,
  onToggleApp,
  onUninstall,
  isLast,
  appIds,
  currentApp,
}) => {
  const { t } = useTranslation();

  const openDocs = async () => {
    if (!skill.readmeUrl) return;
    try {
      await settingsApi.openExternal(skill.readmeUrl);
    } catch {
      // ignore
    }
  };

  const openLocalDir = async () => {
    try {
      await settingsApi.openLocalPath(skill.directory, currentApp);
    } catch {
      // ignore
    }
  };

  const sourceLabel = useMemo(() => {
    if (skill.repoOwner && skill.repoName) {
      return `${skill.repoOwner}/${skill.repoName}`;
    }
    return t("skills.local");
  }, [skill.repoOwner, skill.repoName, t]);

  return (
    <ListItemRow isLast={isLast}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-semibold text-base text-foreground truncate">
            {skill.name}
          </h3>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
            {sourceLabel}
          </span>
        </div>
        {skill.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
            {skill.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <AppToggleGroup
          apps={skill.apps}
          onToggle={(app, enabled) => onToggleApp(skill.id, app, enabled)}
          appIds={appIds}
          neutralActive
        />
        
        {skill.readmeUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openDocs}
            className="h-8 w-8 p-0 hover:bg-muted"
            title={t("skills.viewDocs", { defaultValue: "查看文档" })}
          >
            <ExternalLink size={14} />
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={openLocalDir}
          className="h-8 w-8 p-0 hover:bg-muted"
          title={t("skills.openLocalDir", { defaultValue: "打开本地目录" })}
        >
          <FolderOpen size={14} />
        </Button>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 hover:text-red-500 hover:bg-red-100 dark:hover:text-red-400 dark:hover:bg-red-500/10"
            onClick={onUninstall}
            title={t("skills.uninstall")}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </ListItemRow>
  );
};

interface ImportSkillsDialogProps {
  skills: Array<{
    directory: string;
    name: string;
    description?: string;
    foundIn: string[];
    path: string;
  }>;
  onImport: (directories: string[]) => void;
  onClose: () => void;
}

const ImportSkillsDialog: React.FC<ImportSkillsDialogProps> = ({
  skills,
  onImport,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(skills.map((s) => s.directory)),
  );

  const toggleSelect = (directory: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(directory)) {
      newSelected.delete(directory);
    } else {
      newSelected.add(directory);
    }
    setSelected(newSelected);
  };

  const handleImport = () => {
    onImport(Array.from(selected));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
        <h2 className="text-lg font-semibold mb-2">{t("skills.import")}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t("skills.importDescription")}
        </p>

        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {skills.map((skill) => (
            <label
              key={skill.directory}
              className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(skill.directory)}
                onChange={() => toggleSelect(skill.directory)}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{skill.name}</div>
                {skill.description && (
                  <div className="text-sm text-muted-foreground line-clamp-1">
                    {skill.description}
                  </div>
                )}
                <div
                  className="text-xs text-muted-foreground/50 mt-1 truncate"
                  title={skill.path}
                >
                  {skill.path}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleImport} disabled={selected.size === 0}>
            {t("skills.importSelected", { count: selected.size })}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UnifiedSkillsPanel;
