import { Zap, Key, Globe, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useRef } from 'react';
import { ProviderIcon } from '@/components/ProviderIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { BAILIAN_ICON, BAILIAN_ICON_COLOR } from '@/config/bailianShared';

interface CodingPlanBannerProps {
  /** 传入 apiKey 完成添加 */
  onQuickAdd: (apiKey: string) => void;
  /** 是否已添加（已添加时隐藏按钮） */
  isAdded?: boolean;
}

const CODING_PLAN_API_KEY_URL = 'https://bailian.console.aliyun.com/?tab=coding-plan#/efm/detail';
const CODING_PLAN_WEBSITE_URL = 'https://www.aliyun.com/benefit/scene/codingplan';

// 在卡片上展示的主要模型名
const FEATURED_MODEL_LABELS: Record<string, string> = {
  'qwen3.5-plus': 'Qwen3.5-Plus',
  'MiniMax-M2.5': 'MiniMax-M2.5',
  'glm-5': 'GLM-5',
  'kimi-k2.5': 'Kimi-k2.5',
};

// 卡片展示的模型 ID 顺序
const FEATURED_MODEL_IDS = ['qwen3.5-plus', 'MiniMax-M2.5', 'glm-5', 'kimi-k2.5'];

export function CodingPlanBanner({ onQuickAdd, isAdded = false }: CodingPlanBannerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const featuredModels = FEATURED_MODEL_IDS
    .map((id) => FEATURED_MODEL_LABELS[id] ?? id);

  const handleQuickAddClick = () => {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSubmit = () => {
    if (!apiKey.trim()) return;
    onQuickAdd(apiKey.trim());
    setApiKey('');
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') { setExpanded(false); setApiKey(''); }
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl p-px"
      style={{
        background: 'linear-gradient(135deg, #624AFF 0%, #4A6EFF 50%, #2D9EFF 100%)',
      }}
    >
      {/* 内层卡片 */}
      <div
        className="relative rounded-[11px] px-5 py-4"
        style={{
          background: 'linear-gradient(135deg, #1a1040 0%, #0d1a3d 60%, #0a1628 100%)',
        }}
      >
        {/* 顶部：Logo + 名称 + 标签 + 按钮 */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0"
              style={{ backgroundColor: `${BAILIAN_ICON_COLOR}22` }}
            >
              <ProviderIcon icon={BAILIAN_ICON} name="百炼" size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">
                  {t('codingPlan.title', { defaultValue: '百炼 Coding Plan' })}
                </span>
                <Badge
                  variant="outline"
                  className="h-4 px-1.5 text-[10px] font-medium border-orange-400/50 text-orange-300 bg-orange-500/10"
                >
                  {t('codingPlan.discountBadge', { defaultValue: '首购 7.9 元' })}
                </Badge>
              </div>
            </div>
          </div>

          {/* 一键添加按钮（未展开时显示） */}
          {!isAdded && !expanded && (
            <Button
              size="sm"
              onClick={handleQuickAddClick}
              className="h-8 gap-1.5 text-xs font-semibold flex-shrink-0 transition-all"
              style={{
                background: 'linear-gradient(135deg, #624AFF 0%, #4A6EFF 100%)',
                border: 'none',
                color: 'white',
              }}
            >
              <Zap className="h-3.5 w-3.5" />
              {t('codingPlan.quickAddButton', { defaultValue: '一键添加全部模型' })}
            </Button>
          )}

          {/* 已添加状态 */}
          {isAdded && (
            <span className="text-xs text-white/40 flex-shrink-0 self-center">
              {t('codingPlan.added', { defaultValue: '已添加' })}
            </span>
          )}
        </div>

        {/* 模型标签列表 */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {featuredModels.map((label) => (
            <span
              key={label}
              className="inline-block rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.75)',
              }}
            >
              {label}
            </span>
          ))}
          <span
            className="inline-block rounded-md px-2 py-0.5 text-[11px]"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            {t('codingPlan.moreModels', { defaultValue: '等模型' })}
          </span>
        </div>

        {/* 内联 API Key 输入区（展开时显示） */}
        {expanded && (
          <div className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('apiKeyInput.placeholder', { defaultValue: '请输入 API Key' })}
                  className="h-8 text-xs pr-8 bg-white/10 border-white/20 text-white placeholder:text-white/30 focus-visible:ring-white/30"
                />
                {apiKey && (
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-white/40 hover:text-white/70 transition-colors"
                  >
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
              </div>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!apiKey.trim()}
                className="h-8 px-3 text-xs font-semibold flex-shrink-0"
                style={{
                  background: apiKey.trim() ? 'linear-gradient(135deg, #624AFF 0%, #4A6EFF 100%)' : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: 'white',
                }}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => { setExpanded(false); setApiKey(''); }}
                className="text-white/30 hover:text-white/60 text-xs transition-colors flex-shrink-0"
              >
                {t('common.cancel', { defaultValue: '取消' })}
              </button>
            </div>
            {/* 获取 API Key 引导链接 */}
            <a
              href={CODING_PLAN_API_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ color: '#7B9EFF' }}
            >
              <Key className="h-3 w-3" />
              {t('codingPlan.getApiKeyHint', { defaultValue: '还没有 API Key？点此获取' })}
            </a>
          </div>
        )}

        {/* 底部：说明文案 + 链接 */}
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {t('codingPlan.description', {
              defaultValue: '续费 5 折起，专为 AI Coding 场景打造，适配 OpenClaw 等工具',
            })}
          </p>
          <div className="flex items-center gap-3 flex-shrink-0 ml-3">
            <a
              href={CODING_PLAN_API_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              <Key className="h-3 w-3" />
              {t('codingPlan.getApiKey', { defaultValue: '获取 API Key' })}
            </a>
            <a
              href={CODING_PLAN_WEBSITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.55)' }}
            >
              <Globe className="h-3 w-3" />
              {t('codingPlan.website', { defaultValue: '官网' })}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
