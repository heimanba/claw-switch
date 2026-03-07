import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Stethoscope,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Lightbulb,
  ChevronDown,
  Rocket,
  Wrench,
  Copy,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { openclawApi } from "@/lib/api/openclaw";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/utils/errorUtils";
import { toast } from "sonner";
import { testingLogger } from "@/lib/logger";

export type OpenClawTestingNavigate = "providers" | "sessions" | "openclawEnv";

export interface DoctorItem {
  name: string;
  passed: boolean;
  /** "error" | "warning" | "info" — 后端返回的严重程度 */
  severity?: "error" | "warning" | "info";
  message: string;
  suggestion: string | null;
}

export interface TestingPanelState {
  results: DoctorItem[] | null;
  lastCheckTime: Date | null;
  isPassedExpanded: boolean;
}

interface TestingPanelProps {
  onNavigate?: (view: OpenClawTestingNavigate) => void;
  /** 外部持久化状态（可选），用于跨视图切换保留诊断结果 */
  persistedState?: TestingPanelState;
  onStateChange?: (state: TestingPanelState) => void;
}

/** SVG 健康度圆环 */
const HealthRing: React.FC<{ passed: number; total: number }> = ({ passed, total }) => {
  const size = 56;
  const strokeWidth = 4;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const ratio = total > 0 ? passed / total : 0;
  const offset = circumference * (1 - ratio);
  const allPassed = passed === total && total > 0;
  const strokeColor = allPassed ? "var(--color-success)" : "var(--color-error)";

  return (
    <svg width={size} height={size} className="-rotate-90 flex-shrink-0">
      {/* 背景轨道 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-border"
      />
      {/* 进度弧 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease" }}
      />
    </svg>
  );
};

/**
 * 测试诊断面板（方案 C 重设计）
 * 健康度圆环 → 失败项（醒目卡片）→ 通过项（静默折叠）
 */
const TestingPanel: React.FC<TestingPanelProps> = ({ onNavigate, persistedState, onStateChange }) => {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DoctorItem[] | null>(persistedState?.results ?? null);
  const [isPassedExpanded, setIsPassedExpanded] = useState(persistedState?.isPassedExpanded ?? false);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(persistedState?.lastCheckTime ?? null);
  const [startingGateway, setStartingGateway] = useState(false);
  const [fixingDoctor, setFixingDoctor] = useState(false);
  /** 进度模拟：0-100 的展示进度 */
  const [progress, setProgress] = useState(0);
  /** 复制报告按鈕反馈状态 */
  const [copied, setCopied] = useState(false);

  // 每当关键状态变化时，通知父组件保存
  const notifyStateChange = useCallback(
    (newResults: DoctorItem[] | null, newLastCheckTime: Date | null, newIsPassedExpanded: boolean) => {
      onStateChange?.({
        results: newResults,
        lastCheckTime: newLastCheckTime,
        isPassedExpanded: newIsPassedExpanded,
      });
    },
    [onStateChange]
  );

  const handleRunDiagnostic = useCallback(async () => {
    testingLogger.action("运行系统诊断");
    testingLogger.info("开始系统诊断...");
    setIsRunning(true);
    setResults(null);
    setIsPassedExpanded(false);
    setProgress(0);
    notifyStateChange(null, lastCheckTime, false);

    // 进度动画：先快后慢，到 90% 停止（等待真实结果）
    let fakeProgress = 0;
    const progressTimer = setInterval(() => {
      fakeProgress += fakeProgress < 60 ? 8 : fakeProgress < 80 ? 4 : 1;
      if (fakeProgress >= 90) {
        clearInterval(progressTimer);
        fakeProgress = 90;
      }
      setProgress(fakeProgress);
    }, 300);

    try {
      const items = await openclawApi.runDoctor();
      clearInterval(progressTimer);
      setProgress(100);
      const newCheckTime = new Date();
      setResults(items);
      setLastCheckTime(newCheckTime);
      notifyStateChange(items, newCheckTime, false);
      const failedCount = items.filter((r) => !r.passed).length;
      if (failedCount === 0) {
        testingLogger.info("✅ 诊断完成，各项正常");
        toast.success(t("openclaw.testing.diagnosticSuccess", { defaultValue: "诊断完成，各项正常" }));
      } else {
        testingLogger.warn(`诊断完成，${failedCount} 项异常`, items.filter((r) => !r.passed));
        toast.warning(
          t("openclaw.testing.diagnosticDoneWithIssues", {
            defaultValue: `诊断完成，${failedCount} 项异常`,
            count: failedCount,
          })
        );
      }
    } catch (error) {
      clearInterval(progressTimer);
      setProgress(0);
      testingLogger.error("❌ 诊断失败", error);
      const msg = extractErrorMessage(error);
      toast.error(t("openclaw.testing.diagnosticFailed", { defaultValue: "诊断失败" }), {
        description: msg || undefined,
      });
    } finally {
      setIsRunning(false);
    }
  }, [t, notifyStateChange, lastCheckTime]);

  /** 内联启动网关服务，完成后自动重新诊断 */
  const handleStartGateway = useCallback(async () => {
    setStartingGateway(true);
    try {
      await openclawApi.startService();
      toast.success(t("openclaw.testing.gatewayStarted", { defaultValue: "网关服务已启动" }));
      // 自动重新诊断以刷新结果
      await handleRunDiagnostic();
    } catch (err) {
      const msg = extractErrorMessage(err);
      toast.error(t("openclaw.testing.gatewayStartFailed", { defaultValue: "启动网关失败" }), {
        description: msg || undefined,
      });
    } finally {
      setStartingGateway(false);
    }
  }, [handleRunDiagnostic, t]);

  /** 执行 openclaw doctor --repair --yes 修复，完成后重启网关并重新诊断 */
  const handleDoctorFix = useCallback(async () => {
    setFixingDoctor(true);
    try {
      testingLogger.action("执行 openclaw doctor --repair --yes");
      const fixResult = await openclawApi.runDoctorFix();
      if (fixResult.success) {
        toast.success(t("openclaw.testing.doctorFixSuccess", { defaultValue: "自动修复完成，正在重启网关…" }));
      } else {
        toast.warning(t("openclaw.testing.doctorFixPartial", { defaultValue: "修复执行完成（部分问题可能需要手动处理）" }));
      }
      // 修复后重启网关服务
      try {
        await openclawApi.restartService();
        toast.success(t("openclaw.testing.gatewayRestarted", { defaultValue: "网关服务已重启" }));
      } catch (restartErr) {
        testingLogger.warn("重启网关失败", restartErr);
        // 网关可能本来没启动，忽略重启失败，继续重新诊断
      }
      // 重新诊断刷新结果
      await handleRunDiagnostic();
    } catch (err) {
      testingLogger.error("自动修复失败", err);
      const msg = extractErrorMessage(err);
      toast.error(t("openclaw.testing.doctorFixFailed", { defaultValue: "自动修复失败" }), {
        description: msg || undefined,
      });
    } finally {
      setFixingDoctor(false);
    }
  }, [handleRunDiagnostic, t]);

  /** 一键复制诊断报告到剪贴板 */
  const handleCopyReport = useCallback(async () => {
    if (!results) return;
    const lines: string[] = [
      `OpenClaw 诊断报告 — ${lastCheckTime?.toLocaleString() ?? "未知时间"}`,
      `检查项：${results.filter((r) => r.passed).length}/${results.length} 项通过`,
      "",
    ];
    const failedItems = results.filter((r) => !r.passed);
    const passedItems = results.filter((r) => r.passed);
    if (failedItems.length > 0) {
      lines.push("❌ 异常项:");
      for (const item of failedItems) {
        const icon = item.severity === "warning" ? "⚠️" : "❌";
        lines.push(`  ${icon} ${item.name}: ${item.message}`);
        if (item.suggestion) lines.push(`     → ${item.suggestion}`);
      }
      lines.push("");
    }
    if (passedItems.length > 0) {
      lines.push("✅ 通过项:");
      for (const item of passedItems) {
        lines.push(`  ✓ ${item.name}: ${item.message}`);
      }
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("openclaw.testing.reportCopied", { defaultValue: "诊断报告已复制到剪贴板" }));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("openclaw.testing.reportCopyFailed", { defaultValue: "复制失败，请手动选取内容" }));
    }
  }, [results, lastCheckTime, t]);

  /**
   * 判断某项是否为 warning 级别：
   * 1. 后端显式返回 severity="warning"
   * 2. 当旧版后端未返回 severity 时，按关键词判断
   */
  const isWarningItem = (item: DoctorItem): boolean => {
    if (item.severity === "warning") return true;
    if (item.severity === "error") return false;
    // 兼容旧版本后端
    return !item.passed && !!(
      item.suggestion?.includes("建议") ||
      item.message.includes("建议升级")
    );
  };

  /** 格式化上次检查时间 */
  const formatCheckTime = (date: Date): string => {
    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSeconds < 60) return t("openclaw.testing.justNow", { defaultValue: "刚刚" });
    const diffMins = Math.floor(diffSeconds / 60);
    return t("openclaw.testing.minutesAgo", { defaultValue: `${diffMins} 分钟前`, count: diffMins });
  };

  const passedItems = results?.filter((r) => r.passed) ?? [];
  const failedItems = results?.filter((r) => !r.passed) ?? [];
  const passedCount = passedItems.length;
  const failedCount = failedItems.length;
  const totalCount = results?.length ?? 0;
  const allPassed = results !== null && failedCount === 0;

  // 判断失败项类型，以决定显示哪个快捷操作按钮
  const isEnvRelated = (item: DoctorItem) =>
    /(env|environment|api.?key|环境变量|\.env)/i.test(
      (item.suggestion ?? "") + item.message + item.name
    );

  const isProviderRelated = (item: DoctorItem) =>
    /(供应商|provider)/i.test(
      (item.suggestion ?? "") + item.message + item.name
    );

  const isGatewayRelated = (item: DoctorItem) =>
    /(网关|服务|gateway|port|18789)/i.test(item.name + item.message);

  return (
    <div className="px-6 pt-4 pb-8 space-y-4 min-h-full">
      {/* 系统诊断卡片 */}
      <div className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-5">

        {/* 卡片头部：图标 + 标题（有结果时不显示顶部按钮） */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Stethoscope className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                {t("openclaw.testing.systemDiagnosisTitle", { defaultValue: "系统诊断" })}
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                {t("openclaw.testing.systemDiagnosisDesc", {
                  defaultValue: "检查 OpenClaw 安装和配置状态",
                })}
              </p>
            </div>
          </div>
          {/* 没有结果时显示顶部按钮，有结果后按钮移到底部 */}
          {!results && (
            <Button
              variant="default"
              size="sm"
              onClick={handleRunDiagnostic}
              disabled={isRunning}
              className="flex-shrink-0 border border-red-500/50 bg-red-600 hover:bg-red-700 text-white hover:text-white"
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-1.5" />
              )}
              {isRunning
                ? t("openclaw.testing.running", { defaultValue: "诊断中…" })
                : t("openclaw.testing.runDiagnostic", { defaultValue: "开始检查" })}
            </Button>
          )}
        </div>

        {/* ── 空状态 ── */}
        {!results && !isRunning && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-text-muted">
            <Stethoscope className="w-8 h-8 opacity-20" />
            <p className="text-sm">
              {t("openclaw.testing.runDiagnosticHint", {
                defaultValue: "点击「运行诊断」按钮开始检查系统状态",
              })}
            </p>
          </div>
        )}

        {/* ── 加载中：进度条 + skeleton ── */}
        {isRunning && (
          <div className="space-y-3">
            {/* 进度条 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t("openclaw.testing.running", { defaultValue: "诊断中…" })}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            {/* 骨架展示 */}
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-bg-secondary animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── 结果区域 ── */}
        <AnimatePresence>
          {results && results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="space-y-4"
            >
              {/* 健康度 Banner */}
              <div
                className={cn(
                  "flex items-center gap-4 p-4 rounded-xl border",
                  allPassed
                    ? "bg-status-success/5 border-status-success/20"
                    : failedCount === 1
                      ? "bg-amber-500/5 border-amber-500/20"
                      : "bg-status-error/5 border-status-error/20"
                )}
              >
                <HealthRing passed={passedCount} total={totalCount} />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      allPassed
                        ? "text-status-success"
                        : failedCount === 1
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-status-error"
                    )}
                  >
                    {allPassed
                      ? t("openclaw.testing.statusAllGood", { defaultValue: "一切正常，系统运行良好" })
                      : t("openclaw.testing.statusHasIssues", {
                          defaultValue: `发现 ${failedCount} 个问题需要处理`,
                          count: failedCount,
                        })}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t("openclaw.testing.checksPassedStats", {
                      defaultValue: `${passedCount}/${totalCount} 项检查通过`,
                      passed: passedCount,
                      total: totalCount,
                    })}
                  </p>
                </div>
              </div>

              {/* 失败项卡片 */}
              {failedItems.length > 0 && (
                <div className="space-y-2">
                  {failedItems.map((item, index) => (
                    <motion.div
                      key={item.name}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      className={cn(
                        "flex items-start gap-3 pl-3 pr-4 py-3 rounded-lg border-l-2",
                        isWarningItem(item)
                          ? "bg-amber-500/6 border-amber-500"
                          : "bg-status-error/6 border-status-error"
                      )}
                    >
                      {isWarningItem(item) ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-semibold",
                          isWarningItem(item) ? "text-amber-600 dark:text-amber-400" : "text-status-error"
                        )}>{item.name}</p>
                        <p className="text-xs text-text-secondary mt-0.5 whitespace-pre-wrap break-words">
                          {item.message}
                        </p>
                        {item.suggestion && (
                          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                            <Lightbulb className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                            <span>{item.suggestion}</span>
                          </p>
                        )}
                        {/* 根据失败原因显示不同的快捷操作按钮 */}
                        <div className="flex flex-wrap gap-2 mt-2">
                          {/* openclaw doctor 失败时显示「自动修复并重启」 */}
                          {item.name === "OpenClaw Doctor" && (
                            <button
                              type="button"
                              onClick={handleDoctorFix}
                              disabled={fixingDoctor || startingGateway}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-500/15 text-purple-700 dark:text-purple-400 hover:bg-purple-500/25 transition-colors disabled:opacity-50"
                            >
                              {fixingDoctor ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Wrench className="w-3 h-3" />
                              )}
                              {fixingDoctor
                                ? t("openclaw.testing.fixing", { defaultValue: "修复中…" })
                                : t("openclaw.testing.autoFix", { defaultValue: "自动修复并重启网关 →" })}
                            </button>
                          )}
                          {isGatewayRelated(item) && (
                            <button
                              type="button"
                              onClick={handleStartGateway}
                              disabled={startingGateway}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                            >
                              {startingGateway ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Rocket className="w-3 h-3" />
                              )}
                              {startingGateway
                                ? t("openclaw.testing.startingGateway", { defaultValue: "启动中…" })
                                : t("openclaw.testing.startGateway", { defaultValue: "启动网关服务 →" })}
                            </button>
                          )}
                          {isProviderRelated(item) && onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate("providers")}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
                            >
                              {t("openclaw.testing.goConfigureProviders", { defaultValue: "前往供应商配置 →" })}
                            </button>
                          )}
                          {isEnvRelated(item) && !isProviderRelated(item) && onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate("openclawEnv")}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
                            >
                              {t("openclaw.testing.goConfigureEnv", { defaultValue: "前往配置环境变量 →" })}
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* 重新检查按鈕 + 上次检查时间 + 复制报告（有结果后显示在底部） */}
              <div className="flex items-center justify-between pt-1 gap-2">
                {lastCheckTime && (
                  <p className="text-xs text-text-muted shrink-0">
                    {t("openclaw.testing.lastChecked", { defaultValue: "上次检查：" })}
                    {formatCheckTime(lastCheckTime)}
                  </p>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  {/* 复制诊断报告 */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyReport}
                    disabled={isRunning}
                    className="flex-shrink-0 text-text-muted hover:text-text-primary"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 mr-1.5 text-status-success" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {copied
                      ? t("openclaw.testing.copied", { defaultValue: "已复制" })
                      : t("openclaw.testing.copyReport", { defaultValue: "复制报告" })}
                  </Button>
                  {/* 重新检查 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRunDiagnostic}
                    disabled={isRunning}
                    className="flex-shrink-0"
                  >
                    {isRunning ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {isRunning
                      ? t("openclaw.testing.running", { defaultValue: "检查中…" })
                      : t("openclaw.testing.recheck", { defaultValue: "重新检查" })}
                  </Button>
                </div>
              </div>

              {/* 通过项折叠区 */}
              {passedItems.length > 0 && (
                <div className="rounded-lg border border-border-subtle overflow-hidden">
                  {/* 标题行 */}
                  <button
                    type="button"
                    onClick={() => {
                      const newVal = !isPassedExpanded;
                      setIsPassedExpanded(newVal);
                      notifyStateChange(results, lastCheckTime, newVal);
                    }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-bg-secondary transition-colors"
                  >
                    <span className="flex items-center gap-2 text-sm text-text-secondary">
                      <CheckCircle className="w-3.5 h-3.5 text-status-success" />
                      {t("openclaw.testing.passedSection", {
                        defaultValue: `通过的检查项 (${passedCount})`,
                        count: passedCount,
                      })}
                    </span>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-text-muted transition-transform duration-200",
                        isPassedExpanded && "rotate-180"
                      )}
                    />
                  </button>

                  {/* 展开内容 */}
                  <AnimatePresence initial={false}>
                    {isPassedExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-3 pt-1 space-y-2 border-t border-border-subtle">
                          {passedItems.map((item) => (
                            <div key={item.name} className="flex items-start gap-2.5 py-1.5">
                              <CheckCircle className="w-3.5 h-3.5 text-status-success mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-primary">{item.name}</p>
                                <p className="text-xs text-text-muted mt-0.5 whitespace-pre-wrap break-words">
                                  {item.message}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 诊断说明卡片 */}
      <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
        <h4 className="text-sm font-semibold text-text-primary mb-3">
          {t("openclaw.testing.notesTitle", { defaultValue: "诊断说明" })}
        </h4>
        <ul className="text-sm text-text-muted space-y-1.5">
          <li className="flex items-start gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-text-muted flex-shrink-0" />
            {t("openclaw.testing.noteSystem", {
              defaultValue: "系统诊断会检查 Node.js、OpenClaw 安装、配置文件等状态",
            })}
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-text-muted flex-shrink-0" />
            <span>
              {t("openclaw.testing.noteAiConfig", {
                defaultValue: "AI 连接测试请前往「供应商配置」页面进行",
              })}
              {onNavigate && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => onNavigate("providers")}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    {t("openclaw.testing.linkProviders", { defaultValue: "供应商配置" })}
                  </button>
                </>
              )}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 w-1 h-1 rounded-full bg-text-muted flex-shrink-0" />
            <span>
              {t("openclaw.testing.noteChannels", {
                defaultValue: "渠道/会话测试请前往「会话管理」页面进行",
              })}
              {onNavigate && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => onNavigate("sessions")}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    {t("openclaw.testing.linkSessions", { defaultValue: "会话管理" })}
                  </button>
                </>
              )}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default TestingPanel;
