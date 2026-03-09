import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Link2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { providersApi } from "@/lib/api/providers";

export type TestConnectionProtocol = "openai" | "anthropic";

interface TestConnectionButtonProps {
  /** 认证协议类型，仅支持 "openai" | "anthropic"，其他值会禁用按鈕 */
  protocol: string | undefined;
  baseUrl: string;
  apiKey: string;
  /** 可选的模型名，用于测试请求 */
  modelName?: string;
  /** 协议不支持时展示的提示文字，默认显示通用提示 */
  unsupportedHint?: string;
  /** 按鈕放置位置：顶部小按鈕(默认) 或 底部全宽按鈕 */
  placement?: "top" | "bottom";
}

interface TestResult {
  ok: boolean;
  message: string;
}

function isSupportedProtocol(
  protocol: string | undefined,
): protocol is TestConnectionProtocol {
  return protocol === "openai" || protocol === "anthropic";
}

/**
 * 通用"测试连接"按钮组件
 *
 * 封装防抖、loading 状态、内联结果展示逻辑，
 * 适用于所有支持 OpenAI / Anthropic 协议的 Provider 表单。
 */
export function TestConnectionButton({
  protocol,
  baseUrl,
  apiKey,
  modelName,
  unsupportedHint,
  placement = "top",
}: TestConnectionButtonProps) {
  const { t } = useTranslation();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const lastTestTimeRef = useRef<number>(0);

  const supported = isSupportedProtocol(protocol);
  const canTest = supported && !!baseUrl.trim() && !!apiKey.trim();

  const handleTest = useCallback(async () => {
    if (isTesting) return;

    const now = Date.now();
    if (now - lastTestTimeRef.current < 2000) {
      toast.error(
        t("provider.testConnection.rateLimited", {
          defaultValue: "请勿频繁测试，请稍后再试",
        }),
      );
      return;
    }
    lastTestTimeRef.current = now;

    if (!baseUrl.trim()) {
      toast.error(
        t("provider.testConnection.missingUrl", {
          defaultValue: "请先填写 Base URL",
        }),
      );
      return;
    }
    if (!apiKey.trim()) {
      toast.error(
        t("provider.testConnection.missingKey", {
          defaultValue: "请先填写 API Key",
        }),
      );
      return;
    }
    if (!isSupportedProtocol(protocol)) {
      toast.error(
        t("provider.testConnection.unsupportedType", {
          defaultValue: "当前协议不支持测试连接",
        }),
      );
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await providersApi.testProviderConnection({
        selectedType: protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        modelName: modelName?.trim() || undefined,
      });

      if (result.ok) {
        const msg =
          result.latencyMs != null
            ? t("provider.testConnection.successWithLatency", {
                defaultValue: "连接正常（{{ms}}ms）",
                ms: result.latencyMs,
              })
            : t("provider.testConnection.success", {
                defaultValue: "连接正常，API Key 有效",
              });
        toast.success(msg);
        setTestResult({ ok: true, message: msg });
      } else {
        // 优先用 errorCode 走 i18n，无映射时 fallback 到英文 message
        const msg = result.errorCode
          ? t(`provider.testConnection.error.${result.errorCode}`, {
              defaultValue: result.message,
            })
          : result.message ||
            t("provider.testConnection.failed", { defaultValue: "连接失败" });
        toast.error(msg);
        setTestResult({ ok: false, message: msg });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err);
      const errorMessage =
        msg ||
        t("provider.testConnection.failed", { defaultValue: "连接失败" });
      toast.error(errorMessage);
      setTestResult({ ok: false, message: errorMessage });
    } finally {
      setIsTesting(false);
    }
  }, [isTesting, baseUrl, apiKey, protocol, modelName, t]);

  const isBottom = placement === "bottom";

  return (
    <div className={isBottom ? "space-y-2" : "flex items-center gap-2"}>
      {/* 协议不支持提示 */}
      {!supported && protocol && (
        <span className="text-xs text-muted-foreground">
          {unsupportedHint ||
            t("provider.testConnection.unsupportedHint", {
              defaultValue: "当前协议不支持测试",
            })}
        </span>
      )}

      {/* 底部模式：分割线 + 全宽按鈕区域 */}
      {isBottom ? (
        <>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between gap-3">
            {/* 内联测试结果 */}
            {testResult && !isTesting ? (
              <span
                className={`flex items-center gap-1.5 text-sm font-medium ${
                  testResult.ok
                    ? "text-green-600 dark:text-green-400"
                    : "text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0" />
                )}
                {testResult.message}
              </span>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!canTest}
              aria-busy={isTesting}
              className={`gap-1.5 shrink-0 min-w-[88px] ${isTesting ? "pointer-events-none" : ""}`}
            >
              {isTesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("provider.testConnection.testing", { defaultValue: "验证中…" })}
                </>
              ) : (
                <>
                  <Link2 className="h-3.5 w-3.5" />
                  {t("provider.testConnection.button", {
                    defaultValue: "测试连接",
                  })}
                </>
              )}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* 顶部模式：内联小按鈕 */}
          {testResult && !isTesting && (
            <span
              className={`flex items-center gap-1 text-xs font-medium ${
                testResult.ok
                  ? "text-green-600 dark:text-green-400"
                  : "text-destructive"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              {testResult.message}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!canTest || isTesting}
            className="gap-1.5 h-7 text-xs shrink-0"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("provider.testConnection.testing", { defaultValue: "测试中…" })}
              </>
            ) : (
              <>
                <Link2 className="h-3 w-3" />
                {t("provider.testConnection.button", {
                  defaultValue: "测试连接",
                })}
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}
