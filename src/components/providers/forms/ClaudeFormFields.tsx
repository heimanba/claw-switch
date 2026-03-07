import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EndpointSpeedTest from "./EndpointSpeedTest";
import { ApiKeySection, EndpointField, TestConnectionButton } from "./shared";
import type { ProviderCategory, ClaudeApiFormat } from "@/types";
import type { TemplateValueConfig } from "@/config/claudeProviderPresets";

const CUSTOM_MODEL_VALUE = "__custom__";

interface EndpointCandidate {
  url: string;
}

interface ClaudeFormFieldsProps {
  providerId?: string;
  // API Key
  shouldShowApiKey: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // Template Values
  templateValueEntries: Array<[string, TemplateValueConfig]>;
  templateValues: Record<string, TemplateValueConfig>;
  templatePresetName: string;
  onTemplateValueChange: (key: string, value: string) => void;

  // Base URL
  shouldShowSpeedTest: boolean;
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;

  // Model Selector
  shouldShowModelSelector: boolean;
  claudeModel: string;
  reasoningModel: string;
  defaultHaikuModel: string;
  defaultSonnetModel: string;
  defaultOpusModel: string;
  onModelChange: (
    field:
      | "ANTHROPIC_MODEL"
      | "ANTHROPIC_REASONING_MODEL"
      | "ANTHROPIC_DEFAULT_HAIKU_MODEL"
      | "ANTHROPIC_DEFAULT_SONNET_MODEL"
      | "ANTHROPIC_DEFAULT_OPUS_MODEL",
    value: string,
  ) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];

  // API Format (for third-party providers that use OpenAI Chat Completions format)
  apiFormat: ClaudeApiFormat;
  onApiFormatChange: (format: ClaudeApiFormat) => void;

  /** Bailian 预设：区域 -> ANTHROPIC_BASE_URL，用于 Region Tag 联动 */
  bailianRegionUrls?: Record<string, string>;
  /** 为 true 时 API 格式固定为 anthropic，不显示格式切换 */
  lockApiFormat?: boolean;
  /** 可选：主模型下拉候选（含时可显示下拉+自定义输入） */
  modelOptions?: string[];
  /** 可选：推理模型下拉候选 */
  reasoningModelOptions?: string[];
  /** 可选：当前主模型是否支持 Thinking，用于显示推理模型配置提示 */
  mainModelSupportsThinking?: boolean;
}

export function ClaudeFormFields({
  providerId,
  shouldShowApiKey,
  apiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  isPartner,
  partnerPromotionKey,
  templateValueEntries,
  templateValues,
  templatePresetName,
  onTemplateValueChange,
  shouldShowSpeedTest,
  baseUrl,
  onBaseUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  autoSelect,
  onAutoSelectChange,
  shouldShowModelSelector,
  claudeModel,
  reasoningModel,
  defaultHaikuModel,
  defaultSonnetModel,
  defaultOpusModel,
  onModelChange,
  speedTestEndpoints,
  apiFormat,
  onApiFormatChange,
  bailianRegionUrls,
  lockApiFormat = false,
  modelOptions,
  reasoningModelOptions,
  mainModelSupportsThinking = false,
}: ClaudeFormFieldsProps) {
  const { t } = useTranslation();
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [isCustomReasoningModel, setIsCustomReasoningModel] = useState(false);

  const baseUrlNorm = baseUrl?.trim().replace(/\/+$/, "") ?? "";
  const currentBailianRegion =
    bailianRegionUrls && baseUrlNorm
      ? Object.entries(bailianRegionUrls).find(
          ([, url]) => (url ?? "").trim().replace(/\/+$/, "") === baseUrlNorm,
        )?.[0] ??
        Object.entries(bailianRegionUrls).find(([, url]) =>
          baseUrlNorm.startsWith((url ?? "").trim().replace(/\/+$/, "")),
        )?.[0]
      : undefined;

  // 测试连接协议映射：anthropic 格式对应 anthropic，OpenAI Chat 对应 openai
  const testProtocol: "openai" | "anthropic" | undefined =
    apiFormat === "anthropic" ? "anthropic"
    : apiFormat === "openai_chat" ? "openai"
    : undefined;

  return (
    <>
      {/* API Key 输入框 */}
      {shouldShowApiKey && (
        <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
          <ApiKeySection
            value={apiKey}
            onChange={onApiKeyChange}
            category={category}
            shouldShowLink={shouldShowApiKeyLink}
            websiteUrl={websiteUrl}
            isPartner={isPartner}
            partnerPromotionKey={partnerPromotionKey}
          />
          {shouldShowSpeedTest && (
            <TestConnectionButton
              placement="bottom"
              protocol={testProtocol}
              baseUrl={baseUrl}
              apiKey={apiKey}
            />
          )}
        </div>
      )}

      {/* Bailian 区域选择（仅 Bailian 预设显示） */}
      {bailianRegionUrls && Object.keys(bailianRegionUrls).length > 0 && (
        <div className="space-y-2">
          <FormLabel>
            {t("providerForm.bailianRegion", { defaultValue: "区域 (Region)" })}
          </FormLabel>
          <div className="flex flex-wrap gap-2">
            {Object.keys(bailianRegionUrls).map((region) => {
              const isSelected = currentBailianRegion === region;
              const url = bailianRegionUrls[region];
              return (
                <Button
                  key={region}
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => url && onBaseUrlChange(url)}
                  className={
                    isSelected
                      ? "rounded-full font-medium"
                      : "rounded-full font-medium hover:bg-accent"
                  }
                >
                  {region}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-text-muted">
            {t("providerForm.bailianRegionHint", {
              defaultValue: "切换区域将更新 API 端点 (ANTHROPIC_BASE_URL)",
            })}
          </p>
        </div>
      )}

      {/* 模板变量输入 */}
      {templateValueEntries.length > 0 && (
        <div className="space-y-3">
          <FormLabel>
            {t("providerForm.parameterConfig", {
              name: templatePresetName,
              defaultValue: `${templatePresetName} 参数配置`,
            })}
          </FormLabel>
          <div className="space-y-4">
            {templateValueEntries.map(([key, config]) => (
              <div key={key} className="space-y-2">
                <FormLabel htmlFor={`template-${key}`}>
                  {config.label}
                </FormLabel>
                <Input
                  id={`template-${key}`}
                  type="text"
                  required
                  value={
                    templateValues[key]?.editorValue ??
                    config.editorValue ??
                    config.defaultValue ??
                    ""
                  }
                  onChange={(e) => onTemplateValueChange(key, e.target.value)}
                  placeholder={config.placeholder || config.label}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Base URL 输入框 */}
      {shouldShowSpeedTest && (
        <EndpointField
          id="baseUrl"
          label={t("providerForm.apiEndpoint")}
          value={baseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.apiEndpointPlaceholder")}
          hint={
            apiFormat === "openai_chat"
              ? t("providerForm.apiHintOAI")
              : t("providerForm.apiHint")
          }
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}

      {/* 端点测速弹窗 */}
      {shouldShowSpeedTest && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="claude"
          providerId={providerId}
          value={baseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          visible={isEndpointModalOpen}
          onClose={() => onEndpointModalToggle(false)}
          autoSelect={autoSelect}
          onAutoSelectChange={onAutoSelectChange}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}

      {/* API 格式选择（仅非官方、非云服务商显示；Bailian 预设锁定为 anthropic） */}
      {shouldShowModelSelector && category !== "cloud_provider" && (
        <div className="space-y-2">
          <FormLabel htmlFor="apiFormat">
            {t("providerForm.apiFormat", { defaultValue: "API 格式" })}
          </FormLabel>
          {lockApiFormat ? (
            <>
              <p className="text-sm text-text-muted">
                {t("providerForm.apiFormatAnthropic", {
                  defaultValue: "Anthropic Messages (原生)",
                })}
              </p>
              <p className="text-xs text-text-muted">
                {t("providerForm.bailianApiFormatLockHint", {
                  defaultValue: "Bailian 仅支持 Anthropic 协议",
                })}
              </p>
            </>
          ) : (
            <>
              <Select value={apiFormat} onValueChange={onApiFormatChange}>
                <SelectTrigger id="apiFormat" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">
                    {t("providerForm.apiFormatAnthropic", {
                      defaultValue: "Anthropic Messages (原生)",
                    })}
                  </SelectItem>
                  <SelectItem value="openai_chat">
                    {t("providerForm.apiFormatOpenAIChat", {
                      defaultValue: "OpenAI Chat Completions (需转换)",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-text-muted">
                {t("providerForm.apiFormatHint", {
                  defaultValue: "选择供应商 API 的输入格式",
                })}
              </p>
            </>
          )}
        </div>
      )}

      {/* 模型选择器 */}
      {shouldShowModelSelector && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 主模型：下拉+自定义输入 或 纯输入 */}
            <div className="space-y-2">
              <FormLabel htmlFor="claudeModel">
                {t("providerForm.anthropicModel", { defaultValue: "主模型" })}
              </FormLabel>
              {modelOptions && modelOptions.length > 0 ? (
                (() => {
                  const availableIds = modelOptions;
                  const showModelInput =
                    isCustomModel ||
                    (claudeModel.trim() !== "" &&
                      !availableIds.includes(claudeModel));
                  if (showModelInput) {
                    return (
                      <div className="space-y-2">
                        <Input
                          id="claudeModel"
                          type="text"
                          value={claudeModel}
                          onChange={(e) => {
                            const v = e.target.value;
                            onModelChange("ANTHROPIC_MODEL", v);
                            if (availableIds.includes(v))
                              setIsCustomModel(false);
                          }}
                          placeholder={t(
                            "providerForm.modelPlaceholder",
                            { defaultValue: "" },
                          )}
                          autoComplete="off"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto py-1 px-0 text-xs text-text-muted hover:text-text-primary"
                          onClick={() => {
                            setIsCustomModel(false);
                            if (
                              !availableIds.includes(claudeModel) &&
                              availableIds.length > 0
                            ) {
                              onModelChange("ANTHROPIC_MODEL", availableIds[0]);
                            }
                          }}
                        >
                          {t("providerForm.modelSelectFromList", {
                            defaultValue: "从列表选择",
                          })}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <Select
                      value={claudeModel || undefined}
                      onValueChange={(v) => {
                        if (v === CUSTOM_MODEL_VALUE) {
                          setIsCustomModel(true);
                          onModelChange("ANTHROPIC_MODEL", "");
                        } else {
                          onModelChange("ANTHROPIC_MODEL", v);
                        }
                      }}
                    >
                      <SelectTrigger id="claudeModel">
                        <SelectValue
                          placeholder={t("providerForm.modelPlaceholder", {
                            defaultValue: "",
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {modelOptions.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MODEL_VALUE}>
                          {t("providerForm.modelCustomOption", {
                            defaultValue: "自定义...",
                          })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  );
                })()
              ) : (
                <Input
                  id="claudeModel"
                  type="text"
                  value={claudeModel}
                  onChange={(e) =>
                    onModelChange("ANTHROPIC_MODEL", e.target.value)
                  }
                  placeholder={t("providerForm.modelPlaceholder", {
                    defaultValue: "",
                  })}
                  autoComplete="off"
                />
              )}
            </div>

            {/* 推理模型：下拉+自定义输入 或 纯输入；可选 Thinking 提示 */}
            <div className="space-y-2">
              <FormLabel htmlFor="reasoningModel">
                {t("providerForm.anthropicReasoningModel")}
              </FormLabel>
              {reasoningModelOptions && reasoningModelOptions.length > 0 ? (
                (() => {
                  const availableIds = reasoningModelOptions;
                  const showReasoningInput =
                    isCustomReasoningModel ||
                    (reasoningModel.trim() !== "" &&
                      !availableIds.includes(reasoningModel));
                  if (showReasoningInput) {
                    return (
                      <div className="space-y-2">
                        <Input
                          id="reasoningModel"
                          type="text"
                          value={reasoningModel}
                          onChange={(e) => {
                            const v = e.target.value;
                            onModelChange("ANTHROPIC_REASONING_MODEL", v);
                            if (availableIds.includes(v))
                              setIsCustomReasoningModel(false);
                          }}
                          placeholder={t(
                            "providerForm.modelPlaceholder",
                            { defaultValue: "" },
                          )}
                          autoComplete="off"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto py-1 px-0 text-xs text-text-muted hover:text-text-primary"
                          onClick={() => {
                            setIsCustomReasoningModel(false);
                            if (
                              !availableIds.includes(reasoningModel) &&
                              availableIds.length > 0
                            ) {
                              onModelChange(
                                "ANTHROPIC_REASONING_MODEL",
                                availableIds[0],
                              );
                            }
                          }}
                        >
                          {t("providerForm.modelSelectFromList", {
                            defaultValue: "从列表选择",
                          })}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <Select
                      value={reasoningModel || undefined}
                      onValueChange={(v) => {
                        if (v === CUSTOM_MODEL_VALUE) {
                          setIsCustomReasoningModel(true);
                          onModelChange("ANTHROPIC_REASONING_MODEL", "");
                        } else {
                          onModelChange("ANTHROPIC_REASONING_MODEL", v);
                        }
                      }}
                    >
                      <SelectTrigger id="reasoningModel">
                        <SelectValue
                          placeholder={t("providerForm.modelPlaceholder", {
                            defaultValue: "",
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {reasoningModelOptions.map((id) => (
                          <SelectItem key={id} value={id}>
                            {id}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MODEL_VALUE}>
                          {t("providerForm.modelCustomOption", {
                            defaultValue: "自定义...",
                          })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  );
                })()
              ) : (
                <Input
                  id="reasoningModel"
                  type="text"
                  value={reasoningModel}
                  onChange={(e) =>
                    onModelChange("ANTHROPIC_REASONING_MODEL", e.target.value)
                  }
                  autoComplete="off"
                />
              )}
              {mainModelSupportsThinking && (
                <p className="text-xs text-text-muted">
                  {t("providerForm.reasoningModelThinkingHint", {
                    defaultValue:
                      "当前主模型支持 Thinking，可配置推理模型。",
                  })}
                </p>
              )}
            </div>

            {/* 默认 Haiku */}
            <div className="space-y-2">
              <FormLabel htmlFor="claudeDefaultHaikuModel">
                {t("providerForm.anthropicDefaultHaikuModel", {
                  defaultValue: "Haiku 默认模型",
                })}
              </FormLabel>
              <Input
                id="claudeDefaultHaikuModel"
                type="text"
                value={defaultHaikuModel}
                onChange={(e) =>
                  onModelChange("ANTHROPIC_DEFAULT_HAIKU_MODEL", e.target.value)
                }
                placeholder={t("providerForm.haikuModelPlaceholder", {
                  defaultValue: "",
                })}
                autoComplete="off"
              />
            </div>

            {/* 默认 Sonnet */}
            <div className="space-y-2">
              <FormLabel htmlFor="claudeDefaultSonnetModel">
                {t("providerForm.anthropicDefaultSonnetModel", {
                  defaultValue: "Sonnet 默认模型",
                })}
              </FormLabel>
              <Input
                id="claudeDefaultSonnetModel"
                type="text"
                value={defaultSonnetModel}
                onChange={(e) =>
                  onModelChange(
                    "ANTHROPIC_DEFAULT_SONNET_MODEL",
                    e.target.value,
                  )
                }
                placeholder={t("providerForm.modelPlaceholder", {
                  defaultValue: "",
                })}
                autoComplete="off"
              />
            </div>

            {/* 默认 Opus */}
            <div className="space-y-2">
              <FormLabel htmlFor="claudeDefaultOpusModel">
                {t("providerForm.anthropicDefaultOpusModel", {
                  defaultValue: "Opus 默认模型",
                })}
              </FormLabel>
              <Input
                id="claudeDefaultOpusModel"
                type="text"
                value={defaultOpusModel}
                onChange={(e) =>
                  onModelChange("ANTHROPIC_DEFAULT_OPUS_MODEL", e.target.value)
                }
                placeholder={t("providerForm.modelPlaceholder", {
                  defaultValue: "",
                })}
                autoComplete="off"
              />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {t("providerForm.modelHelper", {
              defaultValue:
                "可选：指定默认使用的 Claude 模型，留空则使用系统默认。",
            })}
          </p>
        </div>
      )}
    </>
  );
}
