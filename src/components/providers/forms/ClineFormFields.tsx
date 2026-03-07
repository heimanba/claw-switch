import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { ProviderCategory } from "@/types";
import { providersApi } from "@/lib/api/providers";
import { TestConnectionButton } from "./shared";

interface ClineFormFieldsProps {
  providerId?: string;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // 认证协议（统一控制 Plan Mode 和 Act Mode 的提供商）
  authProtocol: string;
  onAuthProtocolChange: (protocol: string) => void;

  // OpenAI 相关字段
  openAiApiKey: string;
  onOpenAiApiKeyChange: (key: string) => void;
  openAiBaseUrl: string;
  onOpenAiBaseUrlChange: (url: string) => void;
  planModeOpenAiModelId: string;
  onPlanModeOpenAiModelIdChange: (model: string) => void;
  actModeOpenAiModelId: string;
  onActModeOpenAiModelIdChange: (model: string) => void;

  // Anthropic 相关字段
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  anthropicBaseUrl: string;
  onAnthropicBaseUrlChange: (url: string) => void;
  planModeApiModelId: string;
  onPlanModeApiModelIdChange: (model: string) => void;
  actModeApiModelId: string;
  onActModeApiModelIdChange: (model: string) => void;
}

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
];

export function ClineFormFields({
  providerId,
  category: _category,
  shouldShowApiKeyLink: _shouldShowApiKeyLink,
  websiteUrl: _websiteUrl,
  isPartner: _isPartner,
  partnerPromotionKey: _partnerPromotionKey,
  authProtocol,
  onAuthProtocolChange,
  openAiApiKey,
  onOpenAiApiKeyChange,
  openAiBaseUrl,
  onOpenAiBaseUrlChange,
  planModeOpenAiModelId,
  onPlanModeOpenAiModelIdChange,
  actModeOpenAiModelId,
  onActModeOpenAiModelIdChange,
  apiKey,
  onApiKeyChange,
  anthropicBaseUrl,
  onAnthropicBaseUrlChange,
  planModeApiModelId,
  onPlanModeApiModelIdChange,
  actModeApiModelId,
  onActModeApiModelIdChange,
}: ClineFormFieldsProps) {
  const { t } = useTranslation();

  // 配置不一致状态
  const [isInconsistent, setIsInconsistent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // 追踪表单是否被修改过（编辑模式保护）
  const [hasFormChanged, setHasFormChanged] = useState(false);

  // 当前编辑的认证协议（决定显示哪套字段）
  const currentAuthProtocol = authProtocol as "anthropic" | "openai";

  // 密码可见性状态
  const [showOpenAiApiKey, setShowOpenAiApiKey] = useState(false);
  const [showAnthropicApiKey, setShowAnthropicApiKey] = useState(false);

  // 标记表单为已修改
  const markFormAsChanged = useCallback(() => {
    setHasFormChanged(true);
  }, []);

  // 包装所有字段变更函数
  const wrappedOnOpenAiApiKeyChange = useCallback(
    (key: string) => {
      markFormAsChanged();
      onOpenAiApiKeyChange(key);
    },
    [markFormAsChanged, onOpenAiApiKeyChange],
  );

  const wrappedOnOpenAiBaseUrlChange = useCallback(
    (url: string) => {
      markFormAsChanged();
      onOpenAiBaseUrlChange(url);
    },
    [markFormAsChanged, onOpenAiBaseUrlChange],
  );

  const wrappedOnPlanModeOpenAiModelIdChange = useCallback(
    (model: string) => {
      markFormAsChanged();
      onPlanModeOpenAiModelIdChange(model);
    },
    [markFormAsChanged, onPlanModeOpenAiModelIdChange],
  );

  const wrappedOnActModeOpenAiModelIdChange = useCallback(
    (model: string) => {
      markFormAsChanged();
      onActModeOpenAiModelIdChange(model);
    },
    [markFormAsChanged, onActModeOpenAiModelIdChange],
  );

  const wrappedOnApiKeyChange = useCallback(
    (key: string) => {
      markFormAsChanged();
      onApiKeyChange(key);
    },
    [markFormAsChanged, onApiKeyChange],
  );

  const wrappedOnAnthropicBaseUrlChange = useCallback(
    (url: string) => {
      markFormAsChanged();
      onAnthropicBaseUrlChange(url);
    },
    [markFormAsChanged, onAnthropicBaseUrlChange],
  );

  const wrappedOnPlanModeApiModelIdChange = useCallback(
    (model: string) => {
      markFormAsChanged();
      onPlanModeApiModelIdChange(model);
    },
    [markFormAsChanged, onPlanModeApiModelIdChange],
  );

  const wrappedOnActModeApiModelIdChange = useCallback(
    (model: string) => {
      markFormAsChanged();
      onActModeApiModelIdChange(model);
    },
    [markFormAsChanged, onActModeApiModelIdChange],
  );

  // 处理认证协议切换
  const handleAuthProtocolChange = useCallback(
    (protocol: string) => {
      markFormAsChanged();
      onAuthProtocolChange(protocol);
    },
    [markFormAsChanged, onAuthProtocolChange],
  );

  // 根据当前认证协议获取对应的字段值
  const currentFields = useMemo(() => {
    if (currentAuthProtocol === "openai") {
      return {
        apiKey: openAiApiKey,
        baseUrl: openAiBaseUrl,
        planModeModel: planModeOpenAiModelId,
        actModeModel: actModeOpenAiModelId,
      };
    } else {
      return {
        apiKey: apiKey,
        baseUrl: anthropicBaseUrl,
        planModeModel: planModeApiModelId,
        actModeModel: actModeApiModelId,
      };
    }
  }, [
    currentAuthProtocol,
    openAiApiKey,
    openAiBaseUrl,
    planModeOpenAiModelId,
    actModeOpenAiModelId,
    apiKey,
    anthropicBaseUrl,
    planModeApiModelId,
    actModeApiModelId,
  ]);

  // 根据当前认证协议获取对应的变更函数
  const currentHandlers = useMemo(() => {
    if (currentAuthProtocol === "openai") {
      return {
        onApiKeyChange: wrappedOnOpenAiApiKeyChange,
        onBaseUrlChange: wrappedOnOpenAiBaseUrlChange,
        onPlanModeModelChange: wrappedOnPlanModeOpenAiModelIdChange,
        onActModeModelChange: wrappedOnActModeOpenAiModelIdChange,
      };
    } else {
      return {
        onApiKeyChange: wrappedOnApiKeyChange,
        onBaseUrlChange: wrappedOnAnthropicBaseUrlChange,
        onPlanModeModelChange: wrappedOnPlanModeApiModelIdChange,
        onActModeModelChange: wrappedOnActModeApiModelIdChange,
      };
    }
  }, [
    currentAuthProtocol,
    wrappedOnOpenAiApiKeyChange,
    wrappedOnOpenAiBaseUrlChange,
    wrappedOnPlanModeOpenAiModelIdChange,
    wrappedOnActModeOpenAiModelIdChange,
    wrappedOnApiKeyChange,
    wrappedOnAnthropicBaseUrlChange,
    wrappedOnPlanModeApiModelIdChange,
    wrappedOnActModeApiModelIdChange,
  ]);

  const toggleApiKeyVisibility = useCallback(() => {
    if (currentAuthProtocol === "openai") {
      setShowOpenAiApiKey(!showOpenAiApiKey);
    } else {
      setShowAnthropicApiKey(!showAnthropicApiKey);
    }
  }, [currentAuthProtocol, showOpenAiApiKey, showAnthropicApiKey]);

  const isApiKeyVisible =
    currentAuthProtocol === "openai" ? showOpenAiApiKey : showAnthropicApiKey;

  // 配置一致性检测
  const checkConsistency = useCallback(async () => {
    // 编辑时不检测，避免干扰用户
    if (!providerId || dismissed || hasFormChanged) return;

    try {
      const formConfig = {
        authProtocol,
        planModeApiProvider: authProtocol,
        actModeApiProvider: authProtocol,
        openAiBaseUrl,
        planModeOpenAiModelId,
        actModeOpenAiModelId,
        anthropicBaseUrl,
        planModeApiModelId,
        actModeApiModelId,
      };

      const consistent = await providersApi.checkClineConfigConsistency(
        providerId,
        formConfig,
      );
      setIsInconsistent(!consistent);
    } catch (error) {
      console.error("检测配置一致性失败:", error);
      setIsInconsistent(false);
    }
  }, [
    providerId,
    dismissed,
    hasFormChanged,
    authProtocol,
    openAiBaseUrl,
    planModeOpenAiModelId,
    actModeOpenAiModelId,
    anthropicBaseUrl,
    planModeApiModelId,
    actModeApiModelId,
  ]);

  // 配置同步功能
  const handleSyncConfig = useCallback(async () => {
    if (!providerId) return;

    try {
      setSyncing(true);
      const updatedProvider = await providersApi.refreshClineLiveConfig(providerId);

      // 更新表单字段（使用原始函数，不触发"已修改"标记）
      const config = updatedProvider.settingsConfig as any;
      onAuthProtocolChange(config?.authProtocol || "anthropic");
      onOpenAiBaseUrlChange(config?.openAiBaseUrl || "");
      onPlanModeOpenAiModelIdChange(config?.planModeOpenAiModelId || "");
      onActModeOpenAiModelIdChange(config?.actModeOpenAiModelId || "");
      onAnthropicBaseUrlChange(config?.anthropicBaseUrl || "");
      onPlanModeApiModelIdChange(config?.planModeApiModelId || "");
      onActModeApiModelIdChange(config?.actModeApiModelId || "");

      setIsInconsistent(false);
      setHasFormChanged(false);
      toast.success(t("cline.config.synced", { defaultValue: "配置已同步" }));
    } catch (error) {
      console.error("同步配置失败:", error);
      toast.error(t("cline.config.syncFailed", { defaultValue: "同步配置失败" }));
    } finally {
      setSyncing(false);
    }
  }, [
    providerId,
    onAuthProtocolChange,
    onOpenAiBaseUrlChange,
    onPlanModeOpenAiModelIdChange,
    onActModeOpenAiModelIdChange,
    onAnthropicBaseUrlChange,
    onPlanModeApiModelIdChange,
    onActModeApiModelIdChange,
    t,
  ]);

  // 组件挂载时和定期检查
  useEffect(() => {
    if (!providerId) return;
    checkConsistency();
    const interval = setInterval(checkConsistency, 60000);
    return () => clearInterval(interval);
  }, [providerId, checkConsistency]);

  // 窗口获得焦点时检查
  useEffect(() => {
    if (!providerId) return;
    const handleFocus = () => checkConsistency();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [providerId, checkConsistency]);

  return (
    <div className="space-y-6">
      {/* 不一致提示横幅 */}
      {isInconsistent && !dismissed && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertCircle className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-200">
            {t("cline.config.inconsistent.title", { defaultValue: "配置不一致" })}
          </AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {t("cline.config.inconsistent.description", {
              defaultValue: "本地配置文件与表单内容不一致，可能在 VS Code 中被修改了。",
            })}
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={handleSyncConfig} disabled={syncing}>
                {syncing ? t("common.syncing", { defaultValue: "同步中..." }) : t("cline.config.sync", { defaultValue: "同步配置" })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                {t("common.dismiss", { defaultValue: "忽略" })}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 认证协议切换 - 统一控制 Plan Mode 和 Act Mode 的提供商 */}
      <div className="space-y-2">
        <FormLabel>
          <span className="ml-2">
            {t("cline.authProtocol", { defaultValue: "认证协议" })}
          </span>
          <span className="text-destructive ml-1">*</span>
        </FormLabel>
        <div className="flex gap-2">
          {PROVIDER_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={
                currentAuthProtocol === option.value ? "default" : "outline"
              }
              size="sm"
              onClick={() => handleAuthProtocolChange(option.value)}
              className="rounded-full font-medium"
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {t("cline.authProtocolHint", {
            defaultValue:
              "切换认证协议只影响当前可见编辑字段，不清空另一协议已有值",
          })}
        </p>
      </div>

      {/* 当前认证协议字段区 */}
      <div className="space-y-4 p-4 border rounded-lg bg-bg-secondary/30">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">
            {currentAuthProtocol === "openai"
              ? t("cline.openaiFields", { defaultValue: "OpenAI 配置" })
              : t("cline.anthropicFields", { defaultValue: "Anthropic 配置" })}
          </h4>
          <TestConnectionButton
            protocol={currentAuthProtocol as "openai" | "anthropic"}
            baseUrl={currentFields.baseUrl}
            apiKey={currentFields.apiKey}
          />
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <FormLabel>
            <span className="ml-2">
              {t("cline.apiKey", { defaultValue: "API Key" })}
            </span>
          </FormLabel>
          <div className="relative">
            <Input
              type={isApiKeyVisible ? "text" : "password"}
              value={currentFields.apiKey}
              onChange={(e) => currentHandlers.onApiKeyChange(e.target.value)}
              placeholder={
                currentAuthProtocol === "openai"
                  ? "sk-xxxxxxxxxxxxxxxxxx"
                  : "sk-ant-xxxxxxxxxxxxxxxxxx"
              }
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
              onClick={toggleApiKeyVisibility}
            >
              {isApiKeyVisible ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Base URL */}
        <div className="space-y-2">
          <FormLabel>
            <span className="ml-2">
              {t("cline.baseUrl", { defaultValue: "Base URL" })}
            </span>
          </FormLabel>
          <Input
            value={currentFields.baseUrl}
            onChange={(e) => currentHandlers.onBaseUrlChange(e.target.value)}
            placeholder={
              currentAuthProtocol === "openai"
                ? "https://api.openai.com/v1"
                : "https://api.anthropic.com"
            }
          />
          <p className="text-xs text-text-muted">
            {currentAuthProtocol === "openai"
              ? t("cline.openaiBaseUrlHint", {
                  defaultValue: "OpenAI API 端点地址",
                })
              : t("cline.anthropicBaseUrlHint", {
                  defaultValue: "Anthropic API 端点地址",
                })}
          </p>
        </div>

        {/* Plan Mode Model */}
        <div className="space-y-2">
          <FormLabel>
            <span className="ml-2">
              {t("cline.planModeModel", { defaultValue: "Plan Model" })}
            </span>
          </FormLabel>
          <Input
            value={currentFields.planModeModel}
            onChange={(e) =>
              currentHandlers.onPlanModeModelChange(e.target.value)
            }
            placeholder={
              currentAuthProtocol === "openai"
                ? "gpt-4o"
                : "claude-3-5-sonnet-20241022"
            }
          />
          <p className="text-xs text-text-muted">
            {t("cline.planModeModelHint", {
              defaultValue: "Plan Mode 使用的模型 ID",
            })}
          </p>
        </div>

        {/* Act Mode Model */}
        <div className="space-y-2">
          <FormLabel>
            <span className="ml-2">
              {t("cline.actModeModel", { defaultValue: "Act Model" })}
            </span>
          </FormLabel>
          <Input
            value={currentFields.actModeModel}
            onChange={(e) =>
              currentHandlers.onActModeModelChange(e.target.value)
            }
            placeholder={
              currentAuthProtocol === "openai"
                ? "gpt-4o"
                : "claude-3-5-sonnet-20241022"
            }
          />
          <p className="text-xs text-text-muted">
            {t("cline.actModeModelHint", {
              defaultValue: "Act Mode 使用的模型 ID",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
