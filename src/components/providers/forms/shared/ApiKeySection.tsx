import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import ApiKeyInput from "../ApiKeyInput";
import { Button } from "@/components/ui/button";
import type { ProviderCategory } from "@/types";

interface ApiKeySectionProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  category?: ProviderCategory;
  shouldShowLink: boolean;
  websiteUrl: string;
  placeholder?: {
    official: string;
    thirdParty: string;
  };
  disabled?: boolean;
  isPartner?: boolean;
  partnerPromotionKey?: string;
}

export function ApiKeySection({
  id,
  label,
  value,
  onChange,
  category,
  shouldShowLink,
  websiteUrl,
  placeholder,
  disabled,
  isPartner,
  partnerPromotionKey,
}: ApiKeySectionProps) {
  const { t } = useTranslation();

  const defaultPlaceholder = {
    official: t("providerForm.officialNoApiKey", {
      defaultValue: "官方供应商无需 API Key",
    }),
    thirdParty: t("providerForm.apiKeyAutoFill", {
      defaultValue: "输入 API Key，将自动填充到配置",
    }),
  };

  const finalPlaceholder = placeholder || defaultPlaceholder;

  return (
    <div className="space-y-1">
      <ApiKeyInput
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        placeholder={
          category === "official"
            ? finalPlaceholder.official
            : finalPlaceholder.thirdParty
        }
        disabled={disabled ?? category === "official"}
      />
      {/* API Key 获取指引 */}
      {shouldShowLink && websiteUrl && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              {t("providerForm.apiKeyGuideHint", {
                defaultValue: "还没有 Key？",
              })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-xs text-primary hover:text-primary/80 hover:bg-transparent gap-1"
              asChild
            >
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {t("providerForm.getApiKey", {
                  defaultValue: "获取 API Key",
                })}
              </a>
            </Button>
          </div>

          {/* 合作伙伴促销信息 */}
          {isPartner && partnerPromotionKey && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 p-2.5 border border-blue-200 dark:border-blue-800">
              <p className="text-xs leading-relaxed text-blue-700 dark:text-blue-300">
                💡{" "}
                {t(`providerForm.partnerPromotion.${partnerPromotionKey}`, {
                  defaultValue: "",
                })}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
