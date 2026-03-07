import type { AppId } from '@/lib/api';

const STORAGE_PREFIX = 'claw-switch-onboarding';

export interface OnboardingState {
  dismissed: boolean;
  completedSteps: string[];
  lastUpdated: number;
}

/**
 * 获取指定应用的onboarding状态
 */
export function getOnboardingState(appId: AppId): OnboardingState {
  const key = `${STORAGE_PREFIX}-${appId}`;
  const stored = localStorage.getItem(key);
  
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (error) {
      console.error('[OnboardingStorage] 解析状态失败:', error);
    }
  }
  
  // 默认状态
  return {
    dismissed: false,
    completedSteps: [],
    lastUpdated: Date.now(),
  };
}

/**
 * 保存指定应用的onboarding状态
 */
export function saveOnboardingState(appId: AppId, state: OnboardingState): void {
  const key = `${STORAGE_PREFIX}-${appId}`;
  try {
    const stateToSave = {
      ...state,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(stateToSave));
  } catch (error) {
    console.error('[OnboardingStorage] 保存状态失败:', error);
  }
}

/**
 * 检查onboarding是否已关闭
 */
export function getDismissed(appId: AppId): boolean {
  const state = getOnboardingState(appId);
  return state.dismissed;
}

/**
 * 设置onboarding关闭状态
 */
export function setDismissed(appId: AppId, dismissed: boolean): void {
  const state = getOnboardingState(appId);
  saveOnboardingState(appId, {
    ...state,
    dismissed,
  });
}

/**
 * 获取已完成的步骤列表
 */
export function getCompletedSteps(appId: AppId): string[] {
  const state = getOnboardingState(appId);
  return state.completedSteps;
}

/**
 * 添加一个已完成的步骤
 */
export function addCompletedStep(appId: AppId, stepId: string): void {
  const state = getOnboardingState(appId);
  if (!state.completedSteps.includes(stepId)) {
    saveOnboardingState(appId, {
      ...state,
      completedSteps: [...state.completedSteps, stepId],
    });
  }
}

/**
 * 检查特定步骤是否已完成
 */
export function isStepCompleted(appId: AppId, stepId: string): boolean {
  const completedSteps = getCompletedSteps(appId);
  return completedSteps.includes(stepId);
}

/**
 * 重置指定应用的onboarding状态
 */
export function reset(appId: AppId): void {
  const key = `${STORAGE_PREFIX}-${appId}`;
  localStorage.removeItem(key);
}

/**
 * 重置所有应用的onboarding状态
 */
export function resetAll(): void {
  const keys = Object.keys(localStorage).filter((key) =>
    key.startsWith(STORAGE_PREFIX)
  );
  keys.forEach((key) => localStorage.removeItem(key));
}
