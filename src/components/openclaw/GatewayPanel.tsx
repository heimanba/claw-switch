import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Save,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Monitor,
  Network,
  Cloud,
  HardDrive,
  Lock,
  KeyRound,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { useOpenClawGateway, useSaveOpenClawGateway } from "@/hooks/useOpenClaw";
import { extractErrorMessage } from "@/utils/errorUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { OpenClawGatewayConfig } from "@/types";

// ─── Option card helper ───────────────────────────────────────────────────────

interface OptionCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
}

function OptionCard({ selected, onClick, icon, title, description, className }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg border text-left transition-all w-full",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border-subtle hover:border-border hover:bg-bg-secondary/50",
        className,
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
          selected ? "bg-primary/10 text-primary" : "bg-bg-secondary text-text-muted",
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", selected ? "text-primary" : "text-text-primary")}>
          {title}
        </div>
        <div className="text-xs text-text-muted mt-0.5">{description}</div>
      </div>
    </button>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-text-muted">{icon}</span>
        <span className="text-sm font-semibold text-text-primary">{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const GatewayPanel: React.FC = () => {
  const { t } = useTranslation();
  const { data: gatewayData, isLoading } = useOpenClawGateway();
  const saveMutation = useSaveOpenClawGateway();

  // ── local form state ──
  const [port, setPort] = useState<number>(18789);
  const [bind, setBind] = useState<"loopback" | "lan">("loopback");
  const [mode, setMode] = useState<"local" | "remote">("remote");
  const [authMode, setAuthMode] = useState<"token" | "password">("token");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [tailscaleAddr, setTailscaleAddr] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Populate form from fetched data
  useEffect(() => {
    if (!gatewayData) return;
    const gw = gatewayData;
    setPort(gw.port ?? 18789);
    const b = gw.bind;
    setBind(b === "lan" || b === "all" ? "lan" : "loopback");
    setMode(gw.mode === "remote" ? "remote" : "local");
    const auth = gw.auth;
    if (auth?.mode === "password") {
      setAuthMode("password");
      setPassword((auth.password as string) ?? "");
      setToken((auth.token as string) ?? "");
    } else {
      setAuthMode("token");
      setToken(((auth?.token ?? (gw as any).authToken) as string) ?? "");
      setPassword((auth?.password as string) ?? "");
    }
    setTailscaleAddr((gw.tailscale?.address as string) ?? "");
  }, [gatewayData]);

  const handleSave = async () => {
    const newConfig: OpenClawGatewayConfig = {
      port,
      bind,
      mode,
      auth:
        authMode === "password"
          ? { mode: "password", password }
          : token.trim()
          ? { mode: "token", token }
          : {},
      tailscale: tailscaleAddr.trim() ? { address: tailscaleAddr.trim() } : undefined,
    };

    try {
      await saveMutation.mutateAsync(newConfig);
      toast.success(t("openclaw.gateway.saveSuccess"));
    } catch (error) {
      const detail = extractErrorMessage(error);
      toast.error(t("openclaw.gateway.saveFailed"), {
        description: detail || undefined,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="px-6 pt-4 pb-8 flex items-center justify-center min-h-[200px]">
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-4 pb-8">
      <p className="text-sm text-muted-foreground mb-6">
        {t("openclaw.gateway.description")}
      </p>

      {/* ── 服务端口 ── */}
      <Section
        title={t("openclaw.gateway.port")}
        icon={<Share2 className="w-4 h-4" />}
      >
        <div>
          <Input
            id="gw-port"
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value) || 18789)}
            className="w-[160px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            {t("openclaw.gateway.portHint")}
          </p>
        </div>
      </Section>

      {/* ── 访问控制 ── */}
      <Section
        title={t("openclaw.gateway.bind")}
        icon={<Network className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <OptionCard
            selected={bind === "loopback"}
            onClick={() => setBind("loopback")}
            icon={<Monitor className="w-4 h-4" />}
            title={t("openclaw.gateway.bindLoopback")}
            description={t("openclaw.gateway.bindLoopbackDesc")}
          />
          <OptionCard
            selected={bind === "lan"}
            onClick={() => setBind("lan")}
            icon={<Network className="w-4 h-4" />}
            title={t("openclaw.gateway.bindLan")}
            description={t("openclaw.gateway.bindLanDesc")}
          />
        </div>
      </Section>

      {/* ── 运行模式 ── */}
      <Section
        title={t("openclaw.gateway.mode")}
        icon={<HardDrive className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <OptionCard
            selected={mode === "local"}
            onClick={() => setMode("local")}
            icon={<HardDrive className="w-4 h-4" />}
            title={t("openclaw.gateway.modeLocal")}
            description={t("openclaw.gateway.modeLocalDesc")}
          />
          <OptionCard
            selected={mode === "remote"}
            onClick={() => setMode("remote")}
            icon={<Cloud className="w-4 h-4" />}
            title={t("openclaw.gateway.modeRemote")}
            description={t("openclaw.gateway.modeRemoteDesc")}
          />
        </div>
      </Section>

      {/* ── 安全认证 ── */}
      <Section
        title={t("openclaw.gateway.auth")}
        icon={<Lock className="w-4 h-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          <OptionCard
            selected={authMode === "token"}
            onClick={() => setAuthMode("token")}
            icon={<KeyRound className="w-4 h-4" />}
            title={t("openclaw.gateway.authToken")}
            description={t("openclaw.gateway.authTokenDesc")}
          />
          <OptionCard
            selected={authMode === "password"}
            onClick={() => setAuthMode("password")}
            icon={<Lock className="w-4 h-4" />}
            title={t("openclaw.gateway.authPassword")}
            description={t("openclaw.gateway.authPasswordDesc")}
          />
        </div>

        {authMode === "token" && (
          <div>
            <Label className="text-xs mb-1.5 block">{t("openclaw.gateway.token")}</Label>
            <div className="flex items-center gap-2">
              <Input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("openclaw.gateway.tokenPlaceholder")}
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground flex-shrink-0"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("openclaw.gateway.tokenHint")}
            </p>
          </div>
        )}

        {authMode === "password" && (
          <div>
            <Label className="text-xs mb-1.5 block">{t("openclaw.gateway.password")}</Label>
            <div className="flex items-center gap-2">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("openclaw.gateway.passwordPlaceholder")}
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground flex-shrink-0"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("openclaw.gateway.passwordHint")}
            </p>
          </div>
        )}
      </Section>

      {/* ── 高级选项 ── */}
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          {advancedOpen ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          {t("openclaw.gateway.advanced")}
        </button>

        {advancedOpen && (
          <div className="mt-3 pl-1">
            <Label className="text-xs mb-1.5 block">{t("openclaw.gateway.tailscale")}</Label>
            <Input
              value={tailscaleAddr}
              onChange={(e) => setTailscaleAddr(e.target.value)}
              placeholder={t("openclaw.gateway.tailscalePlaceholder")}
              className="font-mono text-xs max-w-sm"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("openclaw.gateway.tailscaleHint")}
            </p>
          </div>
        )}
      </div>

      {/* ── 保存按钮 ── */}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
          <Save className="w-4 h-4 mr-1" />
          {saveMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
};

export default GatewayPanel;
