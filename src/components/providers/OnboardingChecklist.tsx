import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Zap } from 'lucide-react';
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
  /** OpenClaw: 一键添加 Coding Plan 全部模型（传入用户填写的 API Key） */
  onQuickAddCodingPlan?: (apiKey: string) => void;
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

  // OpenClaw：百炼 Coding Plan 优先布局
  if (onQuickAddCodingPlan) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="mb-6 space-y-4"
        >
          {/* 主推：Coding Plan Banner */}
          <CodingPlanBanner onQuickAdd={onQuickAddCodingPlan} />

          {/* 次级：手动新建入口 */}
          {onCreate && (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted flex-shrink-0">
                {t('onboarding.manualSetupHint', { defaultValue: '或者手动配置' })}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}
          {onCreate && (
            <div
              className="rounded-xl border border-dashed border-primary/30 bg-primary/5 px-6 py-5 text-center cursor-pointer hover:bg-primary/10 hover:border-primary/50 transition-colors group"
              onClick={onCreate}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            >
              <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-medium text-text-primary">
                {t('onboarding.manualSetupTitle', { defaultValue: '手动添加供应商' })}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {t('onboarding.manualSetupDesc', { defaultValue: '自定义 API Key 和服务端点' })}
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    );
  }

  // 通用：无 Coding Plan 快捷入口时的标准空状态
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
          <Zap className="h-6 w-6 text-primary" />
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
      </motion.div>
    </AnimatePresence>
  );
}