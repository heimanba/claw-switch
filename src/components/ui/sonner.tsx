import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

export function Toaster() {
  const { theme } = useTheme();

  // 将应用主题映射到 Sonner 的主题
  const sonnerTheme = theme === "system" ? "system" : theme;

  return (
    <SonnerToaster
      position="top-center"
      richColors
      theme={sonnerTheme}
      toastOptions={{
        duration: 2000,
        classNames: {
          toast:
            "group rounded-xl border border-border-subtle bg-bg-card text-text-primary shadow-md",
          title: "text-sm font-semibold",
          description: "text-sm text-text-muted",
          closeButton:
            "absolute right-2 top-2 rounded-full p-1 text-text-muted transition-smooth hover:bg-bg-secondary hover:text-text-primary",
          actionButton:
            "rounded-lg bg-accent px-3 py-1 text-xs font-medium text-text-inverse transition-smooth hover:bg-accent-hover",
        },
      }}
    />
  );
}
