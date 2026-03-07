import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Download, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import { settingsApi } from "@/lib/api";
import type { DiscoverableSkill } from "@/lib/api/skills";

type SkillCardSkill = DiscoverableSkill & { installed: boolean };

interface SkillCardProps {
  skill: SkillCardSkill;
  onInstall: (directory: string) => Promise<void>;
  onUninstall: (directory: string) => Promise<void>;
}

export function SkillCard({ skill, onInstall, onUninstall }: SkillCardProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleInstall = async () => {
    setLoading(true);
    try {
      await onInstall(skill.directory);
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    setLoading(true);
    try {
      await onUninstall(skill.directory);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenGithub = async () => {
    if (skill.readmeUrl) {
      try {
        await settingsApi.openExternal(skill.readmeUrl);
      } catch (error) {
        console.error("Failed to open URL:", error);
      }
    }
  };

  const showDirectory =
    Boolean(skill.directory) &&
    skill.directory.trim().toLowerCase() !== skill.name.trim().toLowerCase();

  return (
    <Card className="glass-card flex flex-col h-full transition-all duration-200 hover:shadow-md hover:border-border-focus/50 group relative overflow-hidden">
      {/* installed 状态左侧色条 */}
      {skill.installed && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500 rounded-l-xl" />
      )}

      <CardHeader className="pb-2 pt-4 px-4">
        {/* 第一行：技能名 + installed 标记 */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-foreground leading-snug truncate flex-1">
            {skill.name}
          </h3>
          {skill.installed && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
          )}
        </div>

        {/* 第二行：路径 + 仓库标签（视觉降级） */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {showDirectory && (
            <span className="text-[11px] text-muted-foreground/70 truncate max-w-[120px]">
              {skill.directory}
            </span>
          )}
          {skill.repoOwner && skill.repoName && (
            <span
              className="inline-flex items-center text-[10px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded shrink-0"
            >
              {skill.repoOwner}/{skill.repoName}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 pt-0 pb-3 px-4">
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {skill.description || t("skills.noDescription")}
        </p>
      </CardContent>

      {/* footer：无分隔线，按钮权重分明 */}
      <CardFooter className="flex gap-2 pt-0 pb-3 px-4 relative z-10">
        {skill.readmeUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenGithub}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground h-7 px-2.5 text-xs"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            {t("skills.view")}
          </Button>
        )}
        <div className="flex-1" />
        {skill.installed ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUninstall}
            disabled={loading}
            className="h-7 px-2.5 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" />
            )}
            {loading ? t("skills.uninstalling") : t("skills.uninstall")}
          </Button>
        ) : (
          <Button
            variant="mcp"
            size="sm"
            onClick={handleInstall}
            disabled={loading || !skill.repoOwner}
            className="h-7 px-3 text-xs font-medium"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Download className="h-3 w-3 mr-1" />
            )}
            {loading ? t("skills.installing") : t("skills.install")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
