import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  ShieldOff,
  Sparkles,
  Package,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { openclawApi } from "@/lib/api/openclaw";
import { settingsApi, skillsApi } from "@/lib/api";
import type { OpenClawSkillItem, ClawHubSkillItem } from "@/types";
import { ListItemRow } from "@/components/common/ListItemRow";
import { TooltipProvider } from "@/components/ui/tooltip";

// ─── Query Keys ───────────────────────────────────────────────────────────────

const openclawSkillsKeys = {
  list: ["openclaw", "skills", "list"] as const,
};

// ─── Section component ────────────────────────────────────────────────────────

interface SkillSectionProps {
  title: React.ReactNode;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function SkillSection({ title, count, defaultOpen = true, children }: SkillSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-4 rounded-xl border border-border-subtle overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary/40 hover:bg-bg-secondary/70 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {open ? (
            <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
          )}
          {title}
        </div>
        <span className="text-xs text-text-muted tabular-nums">{count}</span>
      </button>
      {open && <div className="divide-y divide-border-subtle">{children}</div>}
    </div>
  );
}

// ─── Detail card ──────────────────────────────────────────────────────────────

interface SkillDetailCardProps {
  name: string;
  onClose: () => void;
}

function SkillDetailCard({ name, onClose }: SkillDetailCardProps) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["openclaw", "skills", "info", name],
    queryFn: () => openclawApi.skillsInfo(name),
  });

  return (
    <div className="mt-4 rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-text-primary">
          {data?.emoji || "📦"} {data?.name || name}
        </h4>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}>
          ×
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <RefreshCw className="w-3 h-3 animate-spin" />
          {t("common.loading", { defaultValue: "加载中..." })}
        </div>
      )}
      {error && (
        <p className="text-xs text-red-500">
          {t("openclaw.skills.detailFailed", { defaultValue: "加载详情失败:" })}{" "}
          {String(error)}
        </p>
      )}
      {data && !isLoading && (
        <div className="space-y-2 text-xs">
          <div className="text-text-muted">
            {t("openclaw.skills.source", { defaultValue: "来源:" })}{" "}
            <span className="text-text-secondary">{data.source || "—"}</span>
            {data.filePath && (
              <>
                {" · "}
                {t("openclaw.skills.path", { defaultValue: "路径:" })}{" "}
                <code className="bg-bg-tertiary px-1 rounded text-[11px]">{data.filePath}</code>
              </>
            )}
          </div>
          {data.description && (
            <p className="text-text-secondary">{data.description}</p>
          )}
          {data.requirements?.bins && data.requirements.bins.length > 0 && (
            <div>
              <span className="font-medium text-text-primary">
                {t("openclaw.skills.requiredCmds", { defaultValue: "需要命令:" })}
              </span>{" "}
              {data.requirements.bins.map((b) => {
                const ok = !(data.missing?.bins || []).includes(b);
                return (
                  <code
                    key={b}
                    className={cn(
                      "px-1 rounded text-[11px] mr-1",
                      ok ? "text-status-success bg-status-success/10" : "text-red-500 bg-red-500/10"
                    )}
                  >
                    {ok ? "✓" : "✗"} {b}
                  </code>
                );
              })}
            </div>
          )}
          {data.requirements?.env && data.requirements.env.length > 0 && (
            <div>
              <span className="font-medium text-text-primary">
                {t("openclaw.skills.requiredEnv", { defaultValue: "环境变量:" })}
              </span>{" "}
              {data.requirements.env.map((e) => {
                const ok = !(data.missing?.env || []).includes(e);
                return (
                  <code
                    key={e}
                    className={cn(
                      "px-1 rounded text-[11px] mr-1",
                      ok ? "text-status-success bg-status-success/10" : "text-red-500 bg-red-500/10"
                    )}
                  >
                    {ok ? "✓" : "✗"} {e}
                  </code>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ClawHub Search ───────────────────────────────────────────────────────────

interface ClawHubSectionProps {
  onInstalled: () => void;
}

const CLAWHUB_CATEGORY_LABELS: Record<string, string> = {
  "AI 智能": "AI 智能",
  "开发工具": "开发工具",
  "效率提升": "效率提升",
  "数据分析": "数据分析",
  "内容创作": "内容创作",
  "安全合规": "安全合规",
  "通讯协作": "通讯协作",
};

function ClawHubSection({ onInstalled }: ClawHubSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [results, setResults] = useState<ClawHubSkillItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** 当前列表中安装失败的 skill slug 及错误信息，用于在对应行内展示 */
  const [installFailedSlug, setInstallFailedSlug] = useState<string | null>(null);
  const [installFailedMessage, setInstallFailedMessage] = useState<string | null>(null);

  const installMutation = useMutation({
    mutationFn: (slug: string) => openclawApi.clawHubInstall(slug),
    onSuccess: (_data, slug) => {
      setInstallFailedSlug(null);
      setInstallFailedMessage(null);
      toast.success(
        t("openclaw.skills.clawHub.installSuccess", { slug, defaultValue: `Skill ${slug} 安装成功` })
      );
      onInstalled();
    },
    onError: (e, slug) => {
      setInstallFailedSlug(slug);
      setInstallFailedMessage(String(e));
    },
  });

  const loadList = async (searchQuery: string, category: string | null) => {
    setSearching(true);
    setSearchError(null);
    try {
      const items = await openclawApi.clawHubSearch(searchQuery, category ?? undefined);
      setResults(Array.isArray(items) ? items : []);
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/i, "");
      setSearchError(msg);
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    openclawApi
      .clawHubSkillsMeta()
      .then((meta) => {
        const names = meta.categories ? Object.keys(meta.categories) : [];
        setCategoryNames(names);
        loadList("", null);
      })
      .catch(() => {
        loadList("", null);
      });
  }, []);

  const handleSearch = async () => {
    await loadList(query.trim(), selectedCategory);
  };

  const handleCategoryClick = (category: string | null) => {
    setSelectedCategory(category);
    loadList(query.trim(), category);
  };

  return (
    <div className="rounded-xl border border-border-subtle overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-bg-secondary/40 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary">
            {t("openclaw.skills.clawHub.title", { defaultValue: "从 ClawHub 安装新 Skill" })}
          </span>
        </div>
      </div>

      <div className="p-4">
        {/* Category tabs */}
        {categoryNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Button
              variant={selectedCategory === null ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleCategoryClick(null)}
            >
              {t("openclaw.skills.clawHub.allCategories", { defaultValue: "全部" })}
            </Button>
            {categoryNames.map((name) => (
              <Button
                key={name}
                variant={selectedCategory === name ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => handleCategoryClick(name)}
              >
                {CLAWHUB_CATEGORY_LABELS[name] ?? name}
              </Button>
            ))}
          </div>
        )}

        {/* Search bar */}
        <div className="flex gap-2 mb-3">
          <Input
            placeholder={t("openclaw.skills.clawHub.placeholder", {
              defaultValue: "搜索 ClawHub，如 weather / github / summarize",
            })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            className="h-9 flex-1"
          />
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={searching}
            className="h-9 min-w-[72px]"
          >
            {searching ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span className="ml-1.5">
                  {t("openclaw.skills.clawHub.search", { defaultValue: "搜索" })}
                </span>
              </>
            )}
          </Button>
        </div>

        {/* Results */}
        {results === null && !searchError && (
          <p className="text-xs text-muted-foreground text-center py-3">
            {searching
              ? t("openclaw.skills.clawHub.loading", { defaultValue: "加载中…" })
              : t("openclaw.skills.clawHub.hint", {
                  defaultValue: "输入关键词搜索 ClawHub 社区 Skills",
                })}
          </p>
        )}
        {searchError && (
          <div className="flex items-start gap-2 py-3 px-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-xs text-red-600 dark:text-red-400 leading-relaxed space-y-1">
              <p>{searchError}</p>
              <p>
                {t("openclaw.skills.clawHub.searchErrorHint", { defaultValue: "您也可以" })}
                {" "}
                <button
                  type="button"
                  className="underline hover:no-underline font-medium"
                  onClick={async () => {
                    try {
                      await settingsApi.openExternal("https://clawhub.ai/skills");
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {t("openclaw.skills.clawHub.visitClawHub", { defaultValue: "前往 ClawHub 网站" })}
                </button>
                {" "}
                {t("openclaw.skills.clawHub.searchErrorHintSuffix", { defaultValue: "手动下载 Skill" })}
              </p>
            </div>
          </div>
        )}
        {results !== null && results.length === 0 && !searchError && (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t("openclaw.skills.clawHub.noResults", { defaultValue: "没有找到匹配的 Skill" })}
          </p>
        )}
        {results && results.length > 0 && (
          <div className="rounded-lg border border-border-subtle divide-y divide-border-subtle">
            {results.map((item) => {
              const isFailed = installFailedSlug === item.slug;
              const clawHubUrl = `https://clawhub.ai/skills?sort=downloads&q=${encodeURIComponent(item.slug)}`;
              return (
                <div
                  key={item.slug}
                  className={cn(
                    "px-4 py-3 flex flex-col gap-1 hover:bg-muted/30 transition-colors",
                    isFailed && "bg-red-50/50 dark:bg-red-950/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.slug || item.name}
                      </p>
                      {(item.description || item.summary) && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {item.description || item.summary}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={installMutation.isPending && installMutation.variables === item.slug}
                      onClick={() => {
                        if (item.slug === installFailedSlug) {
                          setInstallFailedSlug(null);
                          setInstallFailedMessage(null);
                        }
                        installMutation.mutate(item.slug);
                      }}
                      className="h-7 shrink-0"
                    >
                      {installMutation.isPending && installMutation.variables === item.slug ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        t("openclaw.skills.clawHub.install", { defaultValue: "安装" })
                      )}
                    </Button>
                  </div>
                  {isFailed && installFailedMessage && (
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-red-600 dark:text-red-400 shrink-0">
                        {installFailedMessage}
                      </span>
                      <button
                        type="button"
                        className="text-accent hover:underline font-medium inline-flex items-center gap-1"
                        onClick={async () => {
                          try {
                            await settingsApi.openExternal(clawHubUrl);
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        <ExternalLink className="w-3 h-3" />
                        {t("openclaw.skills.clawHub.openOnFail", { defaultValue: "打开 ClawHub 页面" })}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Installed Skills Tab ─────────────────────────────────────────────────────

interface InstalledTabProps {
  skills: OpenClawSkillItem[];
  isLoading: boolean;
  isFetching: boolean;
  cliAvailable: boolean;
  onRefetch: () => void;
  onInstallDep: (skill: OpenClawSkillItem, opt: { kind: string; label: string; [key: string]: unknown }) => void;
  installingDep: string | null;
  onSwitchToDiscover: () => void;
}

function InstalledTab({
  skills,
  isLoading,
  isFetching,
  cliAvailable,
  onRefetch,
  onInstallDep,
  installingDep,
  onSwitchToDiscover,
}: InstalledTabProps) {
  const { t } = useTranslation();
  const [filterQuery, setFilterQuery] = useState("");
  const [detailSkill, setDetailSkill] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!filterQuery.trim()) return skills;
    const q = filterQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
    );
  }, [skills, filterQuery]);

  const eligible = filtered.filter((s) => s.eligible && !s.disabled);
  const missing = filtered.filter((s) => !s.eligible && !s.disabled && !s.blockedByAllowlist);
  const disabled = filtered.filter((s) => s.disabled);
  const blocked = filtered.filter((s) => s.blockedByAllowlist && !s.disabled);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-3 shrink-0 border-b border-border-default">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t("openclaw.skills.filterPlaceholder", { defaultValue: "过滤 Skills..." })}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          disabled={isFetching}
          onClick={onRefetch}
        >
          {isFetching ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-1.5" />
          )}
          {t("common.refresh", { defaultValue: "刷新" })}
        </Button>
      </div>

      {/* CLI not available warning */}
      {!cliAvailable && (
        <div className="flex items-center gap-2 px-6 py-2 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-xs shrink-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {t("openclaw.skills.cliNotAvailable", {
            defaultValue: "CLI 不可用，仅显示本地扫描结果。请确认 OpenClaw 已安装并可用。",
          })}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8">
        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {t("openclaw.skills.loading", { defaultValue: "正在加载 Skills..." })}
            </p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && skills.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl flex items-center justify-center">
              <Sparkles size={32} className="text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-base font-semibold text-foreground mb-2">
              {t("openclaw.skills.empty", { defaultValue: "未检测到任何 Skills" })}
            </p>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              {t("openclaw.skills.emptyHint", {
                defaultValue:
                  "请确认 OpenClaw 已正确安装。Skills 随 OpenClaw 捆绑提供，也可从 ClawHub 安装。",
              })}
            </p>
            <Button onClick={onSwitchToDiscover} className="gap-2">
              <Search className="h-4 w-4" />
              {t("openclaw.skills.goDiscover", { defaultValue: "从 ClawHub 安装" })}
            </Button>
          </div>
        )}

        {/* Skill sections */}
        {!isLoading && skills.length > 0 && (
          <div className="pt-4 space-y-4">
            {/* Summary */}
            <p className="text-xs text-muted-foreground">
              {t("openclaw.skills.summary", {
                total: skills.length,
                eligible: skills.filter((s) => s.eligible && !s.disabled).length,
                missing: skills.filter((s) => !s.eligible && !s.disabled && !s.blockedByAllowlist).length,
                disabled: skills.filter((s) => s.disabled).length,
                defaultValue: `共 ${skills.length} 个 Skills：${skills.filter((s) => s.eligible && !s.disabled).length} 可用 / ${skills.filter((s) => !s.eligible && !s.disabled && !s.blockedByAllowlist).length} 缺依赖 / ${skills.filter((s) => s.disabled).length} 已禁用`,
              })}
            </p>

            {/* Eligible */}
            {eligible.length > 0 && (
              <SkillSection
                title={
                  <span className="flex items-center gap-1.5 text-status-success">
                    <CheckCircle2 className="w-4 h-4" />
                    {t("openclaw.skills.sectionEligible", { defaultValue: "可用" })}
                  </span>
                }
                count={eligible.length}
              >
                {eligible.map((s) => (
                  <InstalledSkillRow
                    key={s.name}
                    skill={s}
                    status="eligible"
                    onInfo={setDetailSkill}
                    onInstallDep={onInstallDep}
                    installing={installingDep}
                  />
                ))}
              </SkillSection>
            )}

            {/* Missing deps */}
            {missing.length > 0 && (
              <SkillSection
                title={
                  <span className="flex items-center gap-1.5 text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="w-4 h-4" />
                    {t("openclaw.skills.sectionMissing", { defaultValue: "缺少依赖" })}
                  </span>
                }
                count={missing.length}
              >
                {missing.map((s) => (
                  <InstalledSkillRow
                    key={s.name}
                    skill={s}
                    status="missing"
                    onInfo={setDetailSkill}
                    onInstallDep={onInstallDep}
                    installing={installingDep}
                  />
                ))}
              </SkillSection>
            )}

            {/* Disabled */}
            {disabled.length > 0 && (
              <SkillSection
                title={
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <PauseCircle className="w-4 h-4" />
                    {t("openclaw.skills.sectionDisabled", { defaultValue: "已禁用" })}
                  </span>
                }
                count={disabled.length}
                defaultOpen={false}
              >
                {disabled.map((s) => (
                  <InstalledSkillRow
                    key={s.name}
                    skill={s}
                    status="disabled"
                    onInfo={setDetailSkill}
                    onInstallDep={onInstallDep}
                    installing={installingDep}
                  />
                ))}
              </SkillSection>
            )}

            {/* Blocked */}
            {blocked.length > 0 && (
              <SkillSection
                title={
                  <span className="flex items-center gap-1.5 text-red-500">
                    <ShieldOff className="w-4 h-4" />
                    {t("openclaw.skills.sectionBlocked", { defaultValue: "白名单阻止" })}
                  </span>
                }
                count={blocked.length}
                defaultOpen={false}
              >
                {blocked.map((s) => (
                  <InstalledSkillRow
                    key={s.name}
                    skill={s}
                    status="blocked"
                    onInfo={setDetailSkill}
                    onInstallDep={onInstallDep}
                    installing={installingDep}
                  />
                ))}
              </SkillSection>
            )}

            {/* Detail card */}
            {detailSkill && (
              <SkillDetailCard name={detailSkill} onClose={() => setDetailSkill(null)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Installed Skill Row (list style like Qwen Skills) ────────────────────────

interface InstalledSkillRowProps {
  skill: OpenClawSkillItem;
  status: "eligible" | "missing" | "disabled" | "blocked";
  onInfo: (name: string) => void;
  onInstallDep: (skill: OpenClawSkillItem, opt: { kind: string; label: string; [key: string]: unknown }) => void;
  installing: string | null;
}

function InstalledSkillRow({ skill, status, onInfo, onInstallDep, installing }: InstalledSkillRowProps) {
  const { t } = useTranslation();
  const emoji = skill.emoji || "📦";
  const sourceLabel = skill.bundled
    ? t("openclaw.skills.bundled", { defaultValue: "捆绑" })
    : skill.source || t("openclaw.skills.custom", { defaultValue: "自定义" });

  const openHomepage = async () => {
    const url = skill.homepage || `https://clawhub.ai/skills/${skill.name}`;
    try {
      await settingsApi.openExternal(url);
    } catch {
      // ignore
    }
  };

  return (
    <ListItemRow>
      {/* Emoji */}
      <span className="text-xl flex-shrink-0">{emoji}</span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">{skill.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {sourceLabel}
          </span>
          {status === "eligible" && (
            <Badge className="bg-status-success/15 text-status-success border-0 text-[11px]">
              {t("openclaw.skills.available", { defaultValue: "可用" })}
            </Badge>
          )}
          {status === "missing" && (
            <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0 text-[11px]">
              {t("openclaw.skills.missingDeps", { defaultValue: "缺依赖" })}
            </Badge>
          )}
          {status === "disabled" && (
            <Badge variant="outline" className="text-muted-foreground text-[11px]">
              {t("openclaw.skills.disabled", { defaultValue: "已禁用" })}
            </Badge>
          )}
          {status === "blocked" && (
            <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0 text-[11px]">
              {t("openclaw.skills.blocked", { defaultValue: "已阻止" })}
            </Badge>
          )}
        </div>

        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{skill.description}</p>
        )}

        {/* Missing deps detail */}
        {status === "missing" && skill.missing && (
          <div className="mt-1.5 space-y-0.5">
            {(skill.missing.bins || []).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("openclaw.skills.missingCmd", { defaultValue: "缺少命令:" })}{" "}
                {skill.missing.bins!.map((b) => (
                  <code key={b} className="bg-muted px-1 rounded text-[11px]">{b}</code>
                ))}
              </p>
            )}
            {(skill.missing.env || []).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("openclaw.skills.missingEnv", { defaultValue: "缺少环境变量:" })}{" "}
                {skill.missing.env!.map((e) => (
                  <code key={e} className="bg-muted px-1 rounded text-[11px]">{e}</code>
                ))}
              </p>
            )}
            {(skill.install || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {skill.install!.map((opt) => (
                  <Button
                    key={opt.kind}
                    size="sm"
                    variant="outline"
                    disabled={installing === `${skill.name}:${opt.kind}`}
                    onClick={() => onInstallDep(skill, opt)}
                    className="h-6 text-[11px] px-2"
                  >
                    {installing === `${skill.name}:${opt.kind}` ? (
                      <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                    ) : null}
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={openHomepage}
        >
          <ExternalLink size={12} className="mr-1" />
          {t("openclaw.skills.detail", { defaultValue: "详情" })}
        </Button>
      </div>
    </ListItemRow>
  );
}

// ─── Discover Tab ─────────────────────────────────────────────────────────────

interface DiscoverTabProps {
  onInstalled: () => void;
  skills: OpenClawSkillItem[];
}

function DiscoverTab({ onInstalled, skills }: DiscoverTabProps) {
  const { t } = useTranslation();

  // Missing-dep skills that have install options
  const fixableSkills = skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && (s.install || []).length > 0
  );

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8">
      <div className="pt-4 space-y-4">
        {/* ClawHub install section */}
        <ClawHubSection onInstalled={onInstalled} />

        {/* Fix missing deps section */}
        {fixableSkills.length > 0 && (
          <div className="rounded-xl border border-border-subtle overflow-hidden">
            <div className="px-4 py-3 bg-bg-secondary/40 border-b border-border-subtle">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span className="text-sm font-medium text-foreground">
                  {t("openclaw.skills.fixDepsTitle", { defaultValue: "修复缺失依赖" })}
                </span>
              </div>
            </div>
            <div className="divide-y divide-border-subtle">
              {fixableSkills.map((s) => (
                <FixDepRow key={s.name} skill={s} onFixed={onInstalled} />
              ))}
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="rounded-xl border border-border-subtle p-4">
          <h4 className="text-sm font-medium text-foreground mb-2">
            {t("openclaw.skills.tipsTitle", { defaultValue: "关于 Skills" })}
          </h4>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>
              <strong className="text-foreground/80">
                {t("openclaw.skills.tipBundled", { defaultValue: "捆绑 Skills" })}
              </strong>
              ：{t("openclaw.skills.tipBundledDesc", { defaultValue: "随 OpenClaw 安装包自带，无需额外安装" })}
            </li>
            <li>
              <strong className="text-foreground/80">
                {t("openclaw.skills.tipCustom", { defaultValue: "自定义 Skills" })}
              </strong>
              ：{t("openclaw.skills.tipCustomDesc", {
                defaultValue: "将 SKILL.md 放入 ~/.openclaw/skills/<name>/ 目录即可",
              })}
            </li>
            <li>
              <strong className="text-foreground/80">
                {t("openclaw.skills.tipDep", { defaultValue: "依赖检查" })}
              </strong>
              ：{t("openclaw.skills.tipDepDesc", {
                defaultValue: "某些 Skills 需要特定命令行工具（如 gh、curl）才能使用",
              })}
            </li>
            <li>
              <strong className="text-foreground/80">
                {t("openclaw.skills.tipMore", { defaultValue: "浏览更多" })}
              </strong>
              ：{t("openclaw.skills.tipMoreDesc", { defaultValue: "访问" })}{" "}
              <a
                href="https://clawhub.ai/skills"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                ClawHub
              </a>{" "}
              {t("openclaw.skills.tipMoreSuffix", { defaultValue: "发现社区共享的 Skills" })}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Fix Dep Row ──────────────────────────────────────────────────────────────

function FixDepRow({ skill, onFixed }: { skill: OpenClawSkillItem; onFixed: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [installing, setInstalling] = useState<string | null>(null);

  const handleInstall = async (opt: { kind: string; label: string; [key: string]: unknown }) => {
    const key = `${skill.name}:${opt.kind}`;
    setInstalling(key);
    try {
      await openclawApi.clawHubInstall(skill.name);
      toast.success(
        t("openclaw.skills.depInstallSuccess", { name: skill.name, defaultValue: `${skill.name} 依赖安装成功` })
      );
      queryClient.invalidateQueries({ queryKey: openclawSkillsKeys.list });
      onFixed();
    } catch (e) {
      toast.error(t("openclaw.skills.depInstallFailed", { defaultValue: "安装失败" }), {
        description: String(e),
      });
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="px-4 py-3 hover:bg-bg-secondary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{skill.emoji || "📦"} {skill.name}</p>
          {skill.missing && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {(skill.missing.bins || []).length > 0 && (
                <p>
                  {t("openclaw.skills.missingCmd", { defaultValue: "缺少命令:" })}{" "}
                  {skill.missing.bins!.map((b) => (
                    <code key={b} className="bg-muted px-1 rounded">{b}</code>
                  ))}
                </p>
              )}
              {(skill.missing.env || []).length > 0 && (
                <p>
                  {t("openclaw.skills.missingEnv", { defaultValue: "缺少环境变量:" })}{" "}
                  {skill.missing.env!.map((e) => (
                    <code key={e} className="bg-muted px-1 rounded">{e}</code>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {(skill.install || []).map((opt) => (
            <Button
              key={opt.kind}
              size="sm"
              variant="outline"
              disabled={installing === `${skill.name}:${opt.kind}`}
              onClick={() => handleInstall(opt)}
              className="h-7 text-xs"
            >
              {installing === `${skill.name}:${opt.kind}` ? (
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

interface OpenClawTabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}

function OpenClawTabButton({ active, onClick, children, count }: OpenClawTabButtonProps) {
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

// ─── Main Panel ───────────────────────────────────────────────────────────────

const OpenClawSkillsPanel: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"installed" | "discover">("installed");
  const [installingDep, setInstallingDep] = useState<string | null>(null);
  const [installingFromZip, setInstallingFromZip] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: openclawSkillsKeys.list,
    queryFn: () => openclawApi.skillsList(),
    staleTime: 10_000,
  });

  const skills = data?.skills || [];
  const cliAvailable = data?.cliAvailable !== false;

  const handleInstallDep = async (
    skill: OpenClawSkillItem,
    opt: { kind: string; label: string; [key: string]: unknown }
  ) => {
    const key = `${skill.name}:${opt.kind}`;
    setInstallingDep(key);
    try {
      await openclawApi.clawHubInstall(skill.name);
      toast.success(
        t("openclaw.skills.depInstallSuccess", {
          name: skill.name,
          defaultValue: `${skill.name} 依赖安装成功`,
        })
      );
      queryClient.invalidateQueries({ queryKey: openclawSkillsKeys.list });
    } catch (e) {
      toast.error(t("openclaw.skills.depInstallFailed", { defaultValue: "安装失败" }), {
        description: String(e),
      });
    } finally {
      setInstallingDep(null);
    }
  };

  const handleInstallFromZip = async () => {
    setInstallingFromZip(true);
    try {
      const filePath = await skillsApi.openZipFileDialog();
      if (!filePath) {
        setInstallingFromZip(false);
        return;
      }

      // 使用 OpenClaw 专用的 ZIP 安装方法（直接安装到 ~/.openclaw/skills/，不走 SSOT）
      const installed = await openclawApi.installSkillsFromZip(filePath);

      if (installed.length === 0) {
        toast.info(
          t("skills.installFromZip.noSkillsFound", {
            defaultValue: "ZIP 包中未找到有效的 Skill（需要包含 SKILL.md）",
          }),
          { closeButton: true }
        );
      } else if (installed.length === 1) {
        toast.success(
          t("openclaw.skills.installFromZip.successSingle", {
            name: installed[0],
            defaultValue: `Skill "${installed[0]}" 安装成功`,
          }),
          { closeButton: true }
        );
      } else {
        toast.success(
          t("openclaw.skills.installFromZip.successMultiple", {
            count: installed.length,
            defaultValue: `已成功安装 ${installed.length} 个 Skills`,
          }),
          { closeButton: true }
        );
      }

      // 刷新 openclaw skills 列表
      queryClient.invalidateQueries({ queryKey: openclawSkillsKeys.list });
      refetch();
    } catch (e) {
      toast.error(
        t("skills.installFailed", { defaultValue: "安装失败" }),
        { description: String(e) }
      );
    } finally {
      setInstallingFromZip(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-end px-6 pt-3 border-b border-border-default shrink-0">
          <div className="flex items-end gap-0 flex-1">
            <OpenClawTabButton
              active={activeTab === "installed"}
              onClick={() => setActiveTab("installed")}
              count={skills.length}
            >
              {t("skills.installed", { defaultValue: "已安装" })}
            </OpenClawTabButton>
            <OpenClawTabButton
              active={activeTab === "discover"}
              onClick={() => setActiveTab("discover")}
            >
              {t("skills.discover", { defaultValue: "发现" })}
            </OpenClawTabButton>
          </div>
          {/* Right: ZIP upload + ClawHub link */}
          <div className="mb-1.5 flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 gap-1"
              onClick={handleInstallFromZip}
              disabled={installingFromZip}
              title={t("skills.installFromZip.button", { defaultValue: "从 ZIP 安装 Skill" })}
            >
              {installingFromZip ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {t("skills.installFromZip.button", { defaultValue: "上传 ZIP" })}
            </Button>
            <a
              href="https://clawhub.ai/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 h-7 text-xs text-muted-foreground border border-border rounded-md hover:bg-muted/50 transition-colors"
            >
              ClawHub
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Tab content */}
        <div className={cn("flex-1 min-h-0 flex flex-col", activeTab !== "installed" && "hidden")}>
          <InstalledTab
            skills={skills}
            isLoading={isLoading}
            isFetching={isFetching}
            cliAvailable={cliAvailable}
            onRefetch={refetch}
            onInstallDep={handleInstallDep}
            installingDep={installingDep}
            onSwitchToDiscover={() => setActiveTab("discover")}
          />
        </div>
        <div className={cn("flex-1 min-h-0 flex flex-col", activeTab !== "discover" && "hidden")}>
          <DiscoverTab
            onInstalled={() => {
              queryClient.invalidateQueries({ queryKey: openclawSkillsKeys.list });
            }}
            skills={skills}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default OpenClawSkillsPanel;
