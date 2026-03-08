import React, { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  RefreshCw,
  Download,
  Filter,
  Terminal,
  FileText,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { openclawApi } from "@/lib/api/openclaw";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { logStore, type LogEntry as MemLogEntry } from "@/lib/logger";

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string | null;
}

interface LogEntry {
  id: number;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | "unknown";
  module: string;
  message: string;
  raw: string;
}

type FilterLevel = "all" | "debug" | "info" | "warn" | "error";

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-green-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  unknown: "text-gray-500",
};

const LEVEL_BG: Record<string, string> = {
  debug: "bg-gray-500/10",
  info: "bg-green-500/10",
  warn: "bg-yellow-500/10",
  error: "bg-red-500/10",
  unknown: "bg-gray-500/5",
};

const MODULE_COLORS: Record<string, string> = {
  App: "text-purple-400",
  Service: "text-blue-400",
  Config: "text-emerald-400",
  AI: "text-pink-400",
  Channel: "text-orange-400",
  Setup: "text-cyan-400",
  Dashboard: "text-lime-400",
  Testing: "text-fuchsia-400",
  API: "text-amber-400",
  Gateway: "text-sky-400",
  Auth: "text-violet-400",
  Proxy: "text-teal-400",
};

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  debug: <span className="text-gray-400">•</span>,
  info: <CheckCircle className="w-3 h-3 text-green-400" />,
  warn: <AlertCircle className="w-3 h-3 text-yellow-400" />,
  error: <XCircle className="w-3 h-3 text-red-400" />,
  unknown: <span className="text-gray-500">•</span>,
};

/**
 * Parse log line to extract level, module and message
 * Supports formats:
 *   [HH:MM:SS.mmm] [LEVEL] [Module] message
 *   2024-01-01T00:00:00 [LEVEL] message
 *   [LEVEL] [Module] message
 */
function parseLogLine(line: string, index: number): LogEntry {
  let level: LogEntry["level"] = "unknown";
  let module = "";

  // Detect log level
  if (/\[error\]|\[err\]|\berror\b|failed/i.test(line)) {
    level = "error";
  } else if (/\[warn\]|\bwarn\b|\bwarning\b/i.test(line)) {
    level = "warn";
  } else if (/\[debug\]|\bdebug\b/i.test(line)) {
    level = "debug";
  } else if (/\[info\]|\binfo\b|\bsuccess\b/i.test(line)) {
    level = "info";
  }

  // Try to extract timestamp
  const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/);
  const timestamp = timestampMatch ? timestampMatch[1] : "";

  // Try to extract module from [Module] pattern (excluding known level keywords)
  const levelKeywords = new Set(["error", "err", "warn", "warning", "debug", "info", "trace"]);
  const moduleMatches = line.matchAll(/\[([A-Za-z][A-Za-z0-9_-]*)\]/g);
  for (const m of moduleMatches) {
    if (!levelKeywords.has(m[1].toLowerCase())) {
      module = m[1];
      break;
    }
  }

  return {
    id: index,
    timestamp,
    level,
    module,
    message: line,
    raw: line,
  };
}

/**
 * Format file size to human readable
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TabType = "app" | "service";

/**
 * Logs Panel - View and manage OpenClaw log files
 * Aligned with openclaw-manager Logs component
 * - "app" tab: in-memory frontend logs (logStore), same as openclaw-manager
 * - "service" tab: gateway log files from ~/.openclaw/logs/
 */
export function LogsPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>("service");

  // ── App logs (in-memory logStore) ──────────────────────────
  const [memLogs, setMemLogs] = useState<MemLogEntry[]>([]);
  const [memFilter, setMemFilter] = useState<FilterLevel>("all");
  const [memModuleFilter, setMemModuleFilter] = useState<string>("all");
  const [memAutoScroll, setMemAutoScroll] = useState(true);
  const memLogsEndRef = useRef<HTMLDivElement>(null);

  // ── Service logs (file-based) ──────────────────────────────
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogFile | null>(null);
  const [logContent, setLogContent] = useState<string>("");
  const [parsedLogs, setParsedLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<FilterLevel>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── Subscribe to in-memory logStore ───────────────────────
  useEffect(() => {
    const update = () => setMemLogs(logStore.getAll());
    update();
    return logStore.subscribe(update);
  }, []);

  // Auto-scroll for app logs
  useEffect(() => {
    if (memAutoScroll && memLogsEndRef.current) {
      memLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [memLogs, memAutoScroll]);

  // App log derived data
  const memModules = [...new Set(memLogs.map((l) => l.module).filter(Boolean))];
  const filteredMemLogs = memLogs.filter((log) => {
    if (memFilter !== "all" && log.level !== memFilter) return false;
    if (memModuleFilter !== "all" && log.module !== memModuleFilter) return false;
    return true;
  });
  const memErrorCount = memLogs.filter((l) => l.level === "error").length;
  const memWarnCount = memLogs.filter((l) => l.level === "warn").length;

  // Export app logs
  const handleExportAppLogs = () => {
    const content = filteredMemLogs
      .map((log) => {
        const time = log.timestamp.toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const args = log.args.length > 0 ? " " + JSON.stringify(log.args) : "";
        return `[${time}] [${log.level.toUpperCase()}] [${log.module}] ${log.message}${args}`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openclaw-app-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("openclaw.logs.exported", { defaultValue: "日志已导出" }));
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0");

  const formatArgs = (args: unknown[]): string => {
    if (args.length === 0) return "";
    try {
      return args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
        )
        .join(" ");
    } catch {
      return "[无法序列化]";
    }
  };

  // Load log files list
  const loadLogFiles = useCallback(async () => {
    try {
      const files = await openclawApi.listLogs();
      setLogFiles(files);
      // Auto-select first log if none selected
      if (files.length > 0 && !selectedLog) {
        setSelectedLog(files[0]);
      }
    } catch (error) {
      console.error("Failed to load log files:", error);
    }
  }, [selectedLog]);

  // Load selected log content
  const loadLogContent = useCallback(async () => {
    if (!selectedLog) return;
    
    try {
      setIsLoading(true);
      const content = await openclawApi.readLog(selectedLog.path, 1000);
      setLogContent(content);
      
      // Parse log entries
      const lines = content.split("\n").filter(line => line.trim());
      const entries = lines.map((line, index) => parseLogLine(line, index));
      setParsedLogs(entries);
    } catch (error) {
      console.error("Failed to load log content:", error);
      toast.error(t("openclaw.logs.loadError", { defaultValue: "加载日志失败" }));
    } finally {
      setIsLoading(false);
    }
  }, [selectedLog, t]);

  // Initial load
  useEffect(() => {
    loadLogFiles();
  }, [loadLogFiles]);

  // Load content when selected log changes
  useEffect(() => {
    loadLogContent();
  }, [loadLogContent]);

  // Auto refresh every 3 seconds for all log files
  useEffect(() => {
    if (selectedLog) {
      refreshIntervalRef.current = setInterval(() => {
        loadLogContent();
      }, 3000);
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [selectedLog, loadLogContent]);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [parsedLogs, autoScroll]);

  // Get all modules from parsed logs
  const modules = [...new Set(parsedLogs.map((l) => l.module).filter(Boolean))];

  // Filter logs
  const filteredLogs = parsedLogs.filter((log) => {
    if (filter !== "all" && log.level !== filter) return false;
    if (moduleFilter !== "all" && log.module !== moduleFilter) return false;
    return true;
  });

  // Stats
  const errorCount = parsedLogs.filter((l) => l.level === "error").length;
  const warnCount = parsedLogs.filter((l) => l.level === "warn").length;

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadLogContent();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Handle clear log
  const handleClear = async () => {
    if (!selectedLog) return;
    
    try {
      await openclawApi.clearLog(selectedLog.path);
      setLogContent("");
      setParsedLogs([]);
      toast.success(t("openclaw.logs.cleared", { defaultValue: "日志已清空" }));
      loadLogFiles();
    } catch (error) {
      toast.error(t("openclaw.logs.clearError", { defaultValue: "清空日志失败" }));
    }
  };

  // Handle export
  const handleExport = () => {
    if (!logContent) return;
    
    const blob = new Blob([logContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedLog?.name || `openclaw-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success(t("openclaw.logs.exported", { defaultValue: "日志已导出" }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 border-b border-border-subtle">
        <button
          onClick={() => setActiveTab("service")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "service"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <FileText size={14} />
          {t("openclaw.logs.serviceTab", { defaultValue: "服务日志" })}
        </button>
        <button
          onClick={() => setActiveTab("app")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "app"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-primary"
          )}
        >
          <Terminal size={14} />
          {t("openclaw.logs.appTab", { defaultValue: "应用日志" })}
          {memLogs.length > 0 && (
            <span className="ml-1 text-[10px] bg-bg-secondary rounded-full px-1.5 py-0.5 text-text-muted">
              {memLogs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── App Logs Tab ──────────────────────────────────── */}
      {activeTab === "app" && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-500" />
              <select
                value={memFilter}
                onChange={(e) => setMemFilter(e.target.value as FilterLevel)}
                className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="all">{t("openclaw.logs.allLevels", { defaultValue: "所有级别" })}</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>

            {memModules.length > 0 && (
              <select
                value={memModuleFilter}
                onChange={(e) => setMemModuleFilter(e.target.value)}
                className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="all">{t("openclaw.logs.allModules", { defaultValue: "所有模块" })}</option>
                {memModules.map((mod) => (
                  <option key={mod} value={mod}>{mod}</option>
                ))}
              </select>
            )}

            <div className="flex-1" />

            {memLogs.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>{filteredMemLogs.length} / {memLogs.length} {t("openclaw.logs.count", { defaultValue: "条" })}</span>
                {memErrorCount > 0 && <span className="text-red-400">{memErrorCount} {t("openclaw.logs.errors", { defaultValue: "错误" })}</span>}
                {memWarnCount > 0 && <span className="text-yellow-400">{memWarnCount} {t("openclaw.logs.warnings", { defaultValue: "警告" })}</span>}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={memAutoScroll}
                  onChange={(e) => setMemAutoScroll(e.target.checked)}
                  className="w-3 h-3 rounded"
                />
                {t("openclaw.logs.autoScroll", { defaultValue: "自动滚动" })}
              </label>
              <Button
                variant="ghost" size="icon"
                onClick={handleExportAppLogs}
                disabled={memLogs.length === 0}
                className="h-8 w-8 text-text-muted hover:text-text-primary"
                title={t("openclaw.logs.export", { defaultValue: "导出日志" })}
              >
                <Download size={16} />
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={() => setMemLogs(logStore.getAll())}
                className="h-8 w-8 text-text-muted hover:text-text-primary"
                title={t("openclaw.logs.refresh", { defaultValue: "刷新" })}
              >
                <RefreshCw size={16} />
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={() => logStore.clear()}
                disabled={memLogs.length === 0}
                className="h-8 w-8 text-text-muted hover:text-red-400"
                title={t("openclaw.logs.clear", { defaultValue: "清空日志" })}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>

          {/* App log content */}
          <div className="flex-1 bg-bg-card rounded-xl border border-border-subtle overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border-subtle">
              <Terminal size={14} className="text-text-muted" />
              <span className="text-xs text-text-muted font-medium">
                {t("openclaw.logs.appTab", { defaultValue: "应用日志" })}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
              {filteredMemLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-text-muted">
                  <div className="text-center">
                    <Terminal size={32} className="mx-auto mb-2 opacity-30" />
                    <p>{t("openclaw.logs.empty", { defaultValue: "暂无日志" })}</p>
                  </div>
                </div>
              ) : (
                <>
                  <AnimatePresence initial={false}>
                    {filteredMemLogs.map((log) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn("py-1.5 px-2 rounded mb-1", LEVEL_BG[log.level])}
                      >
                        <div className="flex items-start gap-2">
                          <span className="flex-shrink-0 mt-0.5">{LEVEL_ICONS[log.level]}</span>
                          <span className="text-text-tertiary flex-shrink-0 text-[10px]">
                            {formatTime(log.timestamp)}
                          </span>
                          <span className={cn("text-[10px] uppercase flex-shrink-0", LEVEL_COLORS[log.level])}>
                            {log.level}
                          </span>
                          <span className={cn("flex-shrink-0 text-[10px]", MODULE_COLORS[log.module] || "text-text-muted")}>
                            [{log.module}]
                          </span>
                          <span className="text-text-secondary break-all whitespace-pre-wrap">
                            {log.message}
                          </span>
                        </div>
                        {log.args.length > 0 && (
                          <div className="mt-1 ml-20 text-text-tertiary break-all whitespace-pre-wrap">
                            {formatArgs(log.args)}
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div ref={memLogsEndRef} />
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Service Logs Tab ──────────────────────────────── */}
      {activeTab === "service" && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-gray-500" />
              <select
                value={selectedLog?.path || ""}
                onChange={(e) => {
                  const file = logFiles.find((f) => f.path === e.target.value);
                  setSelectedLog(file || null);
                }}
                className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary min-w-[180px]"
              >
                {logFiles.length === 0 ? (
                  <option value="">{t("openclaw.logs.noLogs", { defaultValue: "暂无日志文件" })}</option>
                ) : (
                  logFiles.map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.name} ({formatFileSize(file.size)})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-500" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterLevel)}
                className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="all">{t("openclaw.logs.allLevels", { defaultValue: "所有级别" })}</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>

            {modules.length > 0 && (
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                className="bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                <option value="all">{t("openclaw.logs.allModules", { defaultValue: "所有模块" })}</option>
                {modules.map((mod) => (
                  <option key={mod} value={mod}>{mod}</option>
                ))}
              </select>
            )}

            <div className="flex-1" />

            {parsedLogs.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span>{filteredLogs.length} / {parsedLogs.length} {t("openclaw.logs.count", { defaultValue: "条" })}</span>
                {errorCount > 0 && <span className="text-red-400">{errorCount} {t("openclaw.logs.errors", { defaultValue: "错误" })}</span>}
                {warnCount > 0 && <span className="text-yellow-400">{warnCount} {t("openclaw.logs.warnings", { defaultValue: "警告" })}</span>}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="w-3 h-3 rounded"
                />
                {t("openclaw.logs.autoScroll", { defaultValue: "自动滚动" })}
              </label>
              <Button
                variant="ghost" size="icon"
                onClick={handleExport}
                disabled={!logContent}
                className="h-8 w-8 text-text-muted hover:text-text-primary"
                title={t("openclaw.logs.export", { defaultValue: "导出日志" })}
              >
                <Download size={16} />
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="h-8 w-8 text-text-muted hover:text-text-primary"
                title={t("openclaw.logs.refresh", { defaultValue: "刷新" })}
              >
                <RefreshCw size={16} className={cn(isRefreshing && "animate-spin")} />
              </Button>
              <Button
                variant="ghost" size="icon"
                onClick={handleClear}
                disabled={!selectedLog}
                className="h-8 w-8 text-text-muted hover:text-red-400"
                title={t("openclaw.logs.clear", { defaultValue: "清空日志" })}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>

          {/* Service log content */}
          <div className="flex-1 bg-bg-card rounded-xl border border-border-subtle overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border-b border-border-subtle">
              <Terminal size={14} className="text-text-muted" />
              <span className="text-xs text-text-muted font-medium">
                {selectedLog?.name || t("openclaw.logs.serviceTab", { defaultValue: "服务日志" })}
              </span>
              {selectedLog?.modified && (
                <span className="text-xs text-text-tertiary ml-auto">
                  {t("openclaw.logs.updated", { defaultValue: "更新于" })} {selectedLog.modified}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-text-muted">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  {t("openclaw.logs.loading", { defaultValue: "加载中..." })}
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-text-muted">
                  <div className="text-center">
                    <Terminal size={32} className="mx-auto mb-2 opacity-30" />
                    <p>
                      {logContent
                        ? t("openclaw.logs.noMatchingLines", { defaultValue: "没有匹配的日志行" })
                        : t("openclaw.logs.empty", { defaultValue: "暂无日志" })}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <AnimatePresence initial={false}>
                    {filteredLogs.map((log) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn("py-1.5 px-2 rounded mb-1", LEVEL_BG[log.level])}
                      >
                        <div className="flex items-start gap-2">
                          <span className="flex-shrink-0 mt-0.5">{LEVEL_ICONS[log.level]}</span>
                          {log.timestamp && (
                            <span className="text-text-tertiary flex-shrink-0 text-[10px]">
                              {log.timestamp}
                            </span>
                          )}
                          <span className={cn("text-[10px] uppercase flex-shrink-0", LEVEL_COLORS[log.level])}>
                            {log.level}
                          </span>
                          {log.module && (
                            <span className={cn("flex-shrink-0 text-[10px]", MODULE_COLORS[log.module] || "text-text-muted")}>
                              [{log.module}]
                            </span>
                          )}
                          <span className="text-text-secondary break-all whitespace-pre-wrap">
                            {log.message}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div ref={logsEndRef} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LogsPanel;
