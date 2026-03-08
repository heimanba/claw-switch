import { useTranslation } from "react-i18next";
import { Zap, Key, Globe } from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import { BAILIAN_ICON, BAILIAN_ICON_COLOR } from "@/config/bailianShared";

interface CodingPlanBannerProps {
  /** 点击"一键添加全部模型"按钮的回调 */
  onQuickAdd: () => void;
}

export function CodingPlanBanner({ onQuickAdd }: CodingPlanBannerProps) {
  const { t } = useTranslation();

  const handleOpenLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-700/30 bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#1e1b4b] px-5 py-4 shadow-lg">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 bg-gradient-to-l from-violet-500/10 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-1/2 w-1/3 bg-gradient-to-tr from-indigo-600/10 to-transparent" />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        {/* 左侧：图标 + 文字 */}
        <div className="flex flex-1 items-start gap-3 min-w-0">
          <div className="flex-shrink-0 mt-0.5">
            <ProviderIcon
              icon={BAILIAN_ICON}
              name="百炼"
              color={BAILIAN_ICON_COLOR}
              size={28}
            />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                {t("provider.codingPlanBanner.title", {
                  defaultValue: "百炼 Coding Plan",
                })}
              </span>
              <span className="inline-flex items-center rounded-full bg-violet-500/30 border border-violet-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                {t("provider.codingPlanBanner.badge", { defaultValue: "首购 7.9 元" })}
              </span>
            </div>
            <p className="text-xs text-indigo-200 leading-relaxed">
              {t("provider.codingPlanBanner.desc1", {
                defaultValue:
                  "支持 Qwen3.5-Plus、Qwen3-Coder-Next、GLM-5、Kimi-k2.5 等模型",
              })}
            </p>
            <p className="text-xs text-indigo-300/80 leading-relaxed">
              {t("provider.codingPlanBanner.desc2", {
                defaultValue: "续费 5 折起，专为 AI Coding 场景打造，适配 OpenClaw 等工具",
              })}
            </p>
          </div>
        </div>

        {/* 右侧：按钮 + 链接 */}
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {/* 一键添加按钮 */}
          <button
            type="button"
            onClick={onQuickAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-purple-900/40 transition-all hover:from-violet-400 hover:to-purple-500 hover:shadow-purple-900/60 active:scale-95"
          >
            <Zap className="h-3.5 w-3.5 fill-current" />
            {t("provider.codingPlanBanner.quickAdd", {
              defaultValue: "一键添加全部模型",
            })}
          </button>

          {/* 辅助链接 */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                handleOpenLink(
                  "https://bailian.console.aliyun.com/?tab=coding-plan#/efm/detail",
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-indigo-300 transition-colors hover:text-white"
            >
              <Key className="h-3 w-3" />
              {t("provider.codingPlanBanner.getApiKey", {
                defaultValue: "获取 API Key",
              })}
            </button>
            <button
              type="button"
              onClick={() =>
                handleOpenLink(
                  "https://www.aliyun.com/benefit/scene/codingplan",
                )
              }
              className="inline-flex items-center gap-1 text-[11px] text-indigo-300 transition-colors hover:text-white"
            >
              <Globe className="h-3 w-3" />
              {t("provider.codingPlanBanner.official", {
                defaultValue: "官网",
              })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
