import { useTranslation } from "react-i18next";
import { Zap, Star, Layers, Settings2, Info } from "lucide-react";
import type { ProviderPreset } from "@/config/claudeProviderPresets";
import type { CodexProviderPreset } from "@/config/codexProviderPresets";
import type { GeminiProviderPreset } from "@/config/geminiProviderPresets";
import type { OpenClawProviderPreset } from "@/config/openclawProviderPresets";
import type { OpenCodeProviderPreset } from "@/config/opencodeProviderPresets";
import type { QwenProviderPreset } from "@/config/qwenProviderPresets";
import type { ProviderCategory } from "@/types";
import {
  universalProviderPresets,
  type UniversalProviderPreset,
} from "@/config/universalProviderPresets";
import { ProviderIcon } from "@/components/ProviderIcon";

export type PresetEntry = {
  id: string;
  preset: ProviderPreset | CodexProviderPreset | GeminiProviderPreset | OpenClawProviderPreset | OpenCodeProviderPreset | QwenProviderPreset;
};

interface ProviderPresetSelectorProps {
  selectedPresetId: string | null;
  groupedPresets: Record<string, PresetEntry[]>;
  categoryKeys: string[];
  onPresetChange: (value: string) => void;
  onUniversalPresetSelect?: (preset: UniversalProviderPreset) => void;
  onManageUniversalProviders?: () => void;
  category?: ProviderCategory;
}

export function ProviderPresetSelector({
  selectedPresetId,
  groupedPresets,
  categoryKeys,
  onPresetChange,
  onUniversalPresetSelect,
  onManageUniversalProviders,
  category,
}: ProviderPresetSelectorProps) {
  const { t } = useTranslation();

  const getCategoryHintText = (): string => {
    switch (category) {
      case "official":
        return t("providerForm.officialHint", {
          defaultValue: "官方供应商使用浏览器登录，无需配置 API Key",
        });
      case "cn_official":
        return t("providerForm.cnOfficialApiKeyHint", {
          defaultValue: "国产官方供应商只需填写 API Key，请求地址已预设",
        });
      case "aggregator":
        return t("providerForm.aggregatorApiKeyHint", {
          defaultValue: "聚合服务供应商只需填写 API Key 即可使用",
        });
      case "third_party":
        return t("providerForm.thirdPartyApiKeyHint", {
          defaultValue: "第三方供应商需要填写 API Key 和请求地址",
        });
      case "custom":
        return t("providerForm.customApiKeyHint", {
          defaultValue: "自定义配置需手动填写所有必要字段",
        });
      case "omo":
        return t("providerForm.omoHint", {
          defaultValue: "OMO 配置管理 Agent 模型分配，写入 oh-my-opencode.jsonc",
        });
      default:
        return t("providerPreset.hint", {
          defaultValue: "选择预设后可继续调整下方字段。",
        });
    }
  };

  const getPresetCardClass = (isSelected: boolean) => {
    const base =
      "relative flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all cursor-pointer text-left w-full";
    if (isSelected) {
      return `${base} border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500 text-foreground`;
    }
    return `${base} border-border bg-background hover:bg-muted/50 text-text-muted hover:text-foreground`;
  };

  return (
    <div className="space-y-2">
      {/* 双列网格预设列表 */}
      <div className="grid grid-cols-2 gap-1.5">
        {/* 自定义配置卡片 */}
        <button
          type="button"
          onClick={() => onPresetChange("custom")}
          className={getPresetCardClass(selectedPresetId === "custom")}
        >
          {selectedPresetId === "custom" && (
            <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500" />
          )}
          <span className="flex-shrink-0">
            <Zap className="h-4 w-4 text-text-muted" />
          </span>
          <span className="font-medium leading-tight truncate">{t("providerPreset.custom")}</span>
        </button>

        {categoryKeys.map((cat) => {
          const entries = groupedPresets[cat];
          if (!entries || entries.length === 0) return null;
          return entries.map((entry) => {
            const isSelected = selectedPresetId === entry.id;
            const isPartner = entry.preset.isPartner;
            const presetIcon = (entry.preset as { icon?: string }).icon;
            const presetIconColor = (entry.preset as { iconColor?: string }).iconColor;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onPresetChange(entry.id)}
                className={getPresetCardClass(isSelected)}
                title={entry.preset.name}
              >
                {isSelected && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500" />
                )}
                <span className="flex-shrink-0">
                  <ProviderIcon
                    icon={presetIcon}
                    name={entry.preset.name}
                    color={presetIconColor}
                    size={18}
                  />
                </span>
                <span className="flex-1 min-w-0 flex items-center justify-between gap-1">
                  <span className="font-medium leading-tight truncate">{entry.preset.name}</span>
                  {isPartner && (
                    <span className="flex-shrink-0 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 px-1 py-0.5 text-[9px] font-bold text-white">
                      <Star className="h-2 w-2 fill-current" />
                    </span>
                  )}
                </span>
              </button>
            );
          });
        })}
      </div>

      {onUniversalPresetSelect && universalProviderPresets.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {universalProviderPresets.map((preset) => (
              <button
                key={`universal-${preset.providerType}`}
                type="button"
                onClick={() => onUniversalPresetSelect(preset)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors bg-accent text-text-muted hover:bg-accent/80 relative"
                title={t("universalProvider.hint", {
                  defaultValue: "跨应用统一配置，自动同步到 Claude/Codex/Gemini",
                })}
              >
                <ProviderIcon icon={preset.icon} name={preset.name} size={12} />
                {preset.name}
                <span className="absolute -top-1 -right-1 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-md">
                  <Layers className="h-2 w-2" />
                </span>
              </button>
            ))}
            {onManageUniversalProviders && (
              <button
                type="button"
                onClick={onManageUniversalProviders}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors bg-accent text-text-muted hover:bg-accent/80"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t("universalProvider.manage", { defaultValue: "管理" })}
              </button>
            )}
          </div>
        </>
      )}

      {/* 提示信息 */}
      <p className="flex items-center gap-1.5 text-xs text-text-muted pt-1">
        <Info className="h-3 w-3 flex-shrink-0" />
        {getCategoryHintText()}
      </p>
    </div>
  );
}
