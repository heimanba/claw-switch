import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
import { useThemeContext, type ColorTheme } from "@/contexts/ThemeContext";

export function ThemeSettings() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { colorTheme, setColorTheme } = useThemeContext();

  const colorOptions: { value: ColorTheme; label: string; color: string }[] = [
    { value: "black", label: t("settings.themeColorBlack", { defaultValue: "黑色" }), color: "#333333" },
    { value: "blue", label: t("settings.themeColorBlue", { defaultValue: "蓝色" }), color: "#4E80F7" },
    { value: "orange", label: t("settings.themeColorOrange", { defaultValue: "橙色" }), color: "#C47252" },
    { value: "green", label: t("settings.themeColorGreen", { defaultValue: "绿色" }), color: "#57A64B" },
  ];

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
        <p className="text-xs text-text-muted">
          {t("settings.themeHint")}
        </p>
      </header>
      <div className="inline-flex gap-1 rounded-lg border border-border-subtle bg-bg-secondary p-1">
        <ThemeButton
          active={theme === "light"}
          onClick={(e) => setTheme("light", e)}
          icon={Sun}
        >
          {t("settings.themeLight")}
        </ThemeButton>
        <ThemeButton
          active={theme === "dark"}
          onClick={(e) => setTheme("dark", e)}
          icon={Moon}
        >
          {t("settings.themeDark")}
        </ThemeButton>
        <ThemeButton
          active={theme === "system"}
          onClick={(e) => setTheme("system", e)}
          icon={Monitor}
        >
          {t("settings.themeSystem")}
        </ThemeButton>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-text-muted">
          {t("settings.themeColor", { defaultValue: "主题色彩" })}
        </p>
        <div className="flex gap-2">
          {colorOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setColorTheme(opt.value)}
              title={opt.label}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-smooth",
                colorTheme === opt.value
                  ? "border-accent/50 bg-accent/8 text-text-primary"
                  : "border-border-subtle bg-bg-card text-text-muted hover:bg-bg-secondary hover:text-text-primary",
              )}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: opt.color }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ThemeButtonProps {
  active: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}

function ThemeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: ThemeButtonProps) {
  return (
    <Button
      type="button"
      onClick={onClick}
      size="sm"
      variant={active ? "default" : "ghost"}
      className={cn(
        "min-w-[96px] gap-1.5",
        active
          ? "shadow-sm"
          : "text-text-muted hover:text-text-primary hover:bg-bg-card",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Button>
  );
}
