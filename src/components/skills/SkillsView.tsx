import React, { useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderArchive,
  Download,
  MoreHorizontal,
  Settings2,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import UnifiedSkillsPanel from "./UnifiedSkillsPanel";
import type { UnifiedSkillsPanelHandle } from "./UnifiedSkillsPanel";
import { SkillsPage } from "./SkillsPage";
import type { SkillsPageHandle } from "./SkillsPage";
import type { AppId } from "@/lib/api/types";
import { useInstalledSkills } from "@/hooks/useSkills";

type SkillsTab = "installed" | "discover";

interface SkillsViewProps {
  currentApp: AppId;
}

export interface SkillsViewHandle {
  openInstallFromZip: () => void;
  openImport: () => void;
}

export const SkillsView = React.forwardRef<SkillsViewHandle, SkillsViewProps>(
  ({ currentApp }, ref) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SkillsTab>("installed");
    const panelRef = useRef<UnifiedSkillsPanelHandle>(null);
    const discoverRef = useRef<SkillsPageHandle>(null);

    const { data: skills } = useInstalledSkills();
    const installedCount = useMemo(() => {
      if (!skills) return 0;
      return skills.filter((s) => s.apps[currentApp]).length;
    }, [skills, currentApp]);

    React.useImperativeHandle(ref, () => ({
      openInstallFromZip: () => panelRef.current?.openInstallFromZip(),
      openImport: () => panelRef.current?.openImport(),
    }));

    return (
      <div className="flex flex-col h-full">
        {/* Tab bar */}
        <div className="flex items-end px-6 pt-3 border-b border-border-default shrink-0">
          <div className="flex items-end gap-0 flex-1">
            <TabButton
              active={activeTab === "installed"}
              onClick={() => setActiveTab("installed")}
              count={installedCount}
            >
              {t("skills.installed")}
            </TabButton>
            <TabButton
              active={activeTab === "discover"}
              onClick={() => setActiveTab("discover")}
            >
              {t("skills.discover")}
            </TabButton>
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-0.5 mb-1.5">
            {activeTab === "discover" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => discoverRef.current?.refresh()}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  title={t("skills.refresh")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => discoverRef.current?.openRepoManager()}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  title={t("skills.repoManager")}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            {activeTab === "installed" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => panelRef.current?.refresh()}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                  title={t("skills.refresh")}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px]">
                    <DropdownMenuItem
                      onClick={() => panelRef.current?.openInstallFromZip()}
                    >
                      <FolderArchive className="h-4 w-4 mr-2" />
                      {t("skills.installFromZip.button")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => panelRef.current?.openImport()}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {t("skills.import")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </div>

        {/* Content panels — both mounted to preserve state, only one visible */}
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col",
            activeTab !== "installed" && "hidden",
          )}
        >
          <UnifiedSkillsPanel
            ref={panelRef}
            currentApp={currentApp}
            onOpenDiscovery={() => setActiveTab("discover")}
          />
        </div>
        <div
          className={cn(
            "flex-1 min-h-0 flex flex-col",
            activeTab !== "discover" && "hidden",
          )}
        >
          <SkillsPage
            ref={discoverRef}
            initialApp={
              currentApp === "openclaw" || currentApp === "cline"
                ? "claude"
                : currentApp
            }
          />
        </div>
      </div>
    );
  },
);

SkillsView.displayName = "SkillsView";

// ─── Tab Button ────────────────────────────────────────────────────────────

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}

function TabButton({ active, onClick, children, count }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors select-none",
        "after:absolute after:left-0 after:right-0 after:bottom-0 after:h-0.5 after:rounded-t-full after:transition-all after:duration-150",
        active
          ? "text-foreground after:bg-accent"
          : "text-muted-foreground hover:text-foreground/80 after:bg-transparent",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums transition-colors",
            active
              ? "bg-accent/15 text-accent"
              : "bg-muted text-muted-foreground/70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
