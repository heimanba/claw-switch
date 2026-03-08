import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Sparkles } from 'lucide-react';
import type { AppId } from '@/lib/api';
import type { Provider } from '@/types';
import { Button } from '@/components/ui/button';
import { CodingPlanBanner } from '@/components/providers/CodingPlanBanner';

interface OnboardingChecklistProps {
  appId: AppId;
  hasProviders: boolean;
  providers?: Record<string, Provider>;
  onCreate?: () => void;
  /** 外部控制是否显示（纯实时检测模式，无持久化） */
  visible?: boolean;
  onClose?: () => void;
  /** OpenClaw: 一键添加 Coding Plan 全部模型 */
  onQuickAddCodingPlan?: () => void;
}

export function OnboardingChecklist({
  appId,
  hasProviders,
  providers = {},
  onCreate,
  visible = true,
  onClose,
  onQuickAddCodingPlan,
}: OnboardingChecklistProps) {
  const { t } = useTranslation();

  const hasAddedProvider = hasProviders || Object.keys(providers).length > 0;

  const handleDismiss = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // 已添加供应商时自动关闭
  useEffect(() => {
    if (hasAddedProvider) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [hasAddedProvider, handleDismiss]);

  if (!visible || hasAddedProvider) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
        className="mb-6 rounded-xl border border-dashed border-border bg-bg-secondary/30 px-8 py-10 text-center"
      >
        {/* 图标 */}
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>

        {/* 标题 */}
        <h3 className="text-base font-semibold">
          {t('onboarding.emptyTitle', { appName: appId.toUpperCase() })}
        </h3>

        {/* 描述 */}
        <p className="mt-2 text-sm text-text-muted">
          {t('onboarding.emptyDescription')}
        </p>

        {/* 操作按钮 */}
        <div className="mt-6 flex items-center justify-center gap-3">
          {onCreate && (
            <Button size="sm" onClick={onCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t('onboarding.steps.addProvider.createButton')}
            </Button>
          )}
        </div>

        {/* OpenClaw: Coding Plan 快速入口 */}
        {onQuickAddCodingPlan && (
          <div className="mt-6 text-left">
            <p className="text-xs text-text-muted mb-2 text-center">
              {t('onboarding.codingPlanHint', {
                defaultValue: '或快速添加百炼 Coding Plan 全部模型，一步完成配置：',
              })}
            </p>
            <CodingPlanBanner onQuickAdd={onQuickAddCodingPlan} />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}