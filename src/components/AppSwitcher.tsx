import { ChevronDown } from "lucide-react";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { APP_IDS } from "@/config/appConfig";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface AppSwitcherProps {
  activeApp: AppId;
  onSwitch: (app: AppId) => void;
  visibleApps?: VisibleApps;
  compact?: boolean;
}
const STORAGE_KEY = "claw-switch-last-app";

const appIconName: Record<AppId, string> = {
  claude: "claude",
  codex: "openai",
  gemini: "gemini",
  opencode: "opencode",
  openclaw: "openclaw",
  qwen: "qwen",
  cline: "cline",
};

const appDisplayName: Record<AppId, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  qwen: "Qwen Code",
  cline: "Cline",
};

const iconSize = 20;

export function AppSwitcher({
  activeApp,
  onSwitch,
  visibleApps,
  compact,
}: AppSwitcherProps) {
  const handleSwitch = (app: AppId) => {
    if (app === activeApp) return;
    localStorage.setItem(STORAGE_KEY, app);
    onSwitch(app);
  };

  const appsToShow = APP_IDS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-between gap-2 bg-bg-secondary/50 hover:bg-bg-secondary border-border h-9 font-medium text-sm",
            compact && "px-2 justify-center"
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <ProviderIcon
              icon={appIconName[activeApp]}
              name={appDisplayName[activeApp]}
              size={iconSize}
            />
            {!compact && (
              <span className="truncate">{appDisplayName[activeApp]}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        {appsToShow.map((app) => (
          <DropdownMenuItem
            key={app}
            onClick={() => handleSwitch(app)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <ProviderIcon
              icon={appIconName[app]}
              name={appDisplayName[app]}
              size={iconSize}
            />
            <span>{appDisplayName[app]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
