/**
 * 全局安装状态 store（无第三方依赖）
 *
 * 使用模块级单例 + useSyncExternalStore 实现，
 * 确保切换 Tab 时安装进度不丢失。
 */
import { useSyncExternalStore } from "react";
import type { AppId } from "@/lib/api";
import type { InstallError } from "@/lib/cliInstaller";

export interface AppInstallState {
  isInstalling: boolean;
  progress: number;
  logs: string[];
  error: InstallError | null;
  /** 卸载状态（与安装并列，同一 appId 同时只会有其一在进行） */
  isUninstalling: boolean;
  uninstallProgress: number;
  uninstallLogs: string[];
  uninstallError: InstallError | null;
}

const DEFAULT_STATE: AppInstallState = {
  isInstalling: false,
  progress: 0,
  logs: [],
  error: null,
  isUninstalling: false,
  uninstallProgress: 0,
  uninstallLogs: [],
  uninstallError: null,
};

// 模块级单例状态
let states: Partial<Record<AppId, AppInstallState>> = {};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function getSnapshot() {
  return states;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 操作函数
export function getInstallState(appId: AppId): AppInstallState {
  return states[appId] ?? DEFAULT_STATE;
}

export function setInstalling(appId: AppId, installing: boolean) {
  states = {
    ...states,
    [appId]: {
      ...(states[appId] ?? DEFAULT_STATE),
      isInstalling: installing,
      ...(installing ? { progress: 0, logs: [], error: null } : {}),
    },
  };
  notify();
}

export function updateInstallProgress(appId: AppId, progress: number, log: string) {
  const prev = states[appId] ?? DEFAULT_STATE;
  states = {
    ...states,
    [appId]: {
      ...prev,
      progress,
      logs: [...prev.logs, log],
    },
  };
  notify();
}

export function setInstallError(appId: AppId, error: InstallError | null) {
  states = {
    ...states,
    [appId]: {
      ...(states[appId] ?? DEFAULT_STATE),
      isInstalling: false,
      error,
    },
  };
  notify();
}

export function resetInstallState(appId: AppId) {
  states = { ...states, [appId]: DEFAULT_STATE };
  notify();
}

// ─── 卸载状态 ─────────────────────────────────────────────────────────────────

export function setUninstalling(appId: AppId, uninstalling: boolean) {
  states = {
    ...states,
    [appId]: {
      ...(states[appId] ?? DEFAULT_STATE),
      isUninstalling: uninstalling,
      ...(uninstalling ? { uninstallProgress: 0, uninstallLogs: [], uninstallError: null } : {}),
    },
  };
  notify();
}

export function updateUninstallProgress(appId: AppId, progress: number, log: string) {
  const prev = states[appId] ?? DEFAULT_STATE;
  states = {
    ...states,
    [appId]: {
      ...prev,
      uninstallProgress: progress,
      uninstallLogs: [...prev.uninstallLogs, log],
    },
  };
  notify();
}

export function setUninstallError(appId: AppId, error: InstallError | null) {
  states = {
    ...states,
    [appId]: {
      ...(states[appId] ?? DEFAULT_STATE),
      isUninstalling: false,
      uninstallError: error,
    },
  };
  notify();
}

export function resetUninstallState(appId: AppId) {
  const prev = states[appId] ?? DEFAULT_STATE;
  states = {
    ...states,
    [appId]: {
      ...prev,
      isUninstalling: false,
      uninstallProgress: 0,
      uninstallLogs: [],
      uninstallError: null,
    },
  };
  notify();
}

/** 取指定 appId 的卸载状态（与安装状态同形状，便于 UI 复用） */
export function getUninstallState(appId: AppId): Pick<
  AppInstallState,
  'isUninstalling' | 'uninstallProgress' | 'uninstallLogs' | 'uninstallError'
> {
  const s = states[appId] ?? DEFAULT_STATE;
  return {
    isUninstalling: s.isUninstalling,
    uninstallProgress: s.uninstallProgress,
    uninstallLogs: s.uninstallLogs,
    uninstallError: s.uninstallError,
  };
}

/** React hook：订阅指定 appId 的安装状态 */
export function useInstallState(appId: AppId): AppInstallState {
  const allStates = useSyncExternalStore(subscribe, getSnapshot);
  return allStates[appId] ?? DEFAULT_STATE;
}

/** React hook：订阅指定 appId 的卸载状态 */
export function useUninstallState(appId: AppId): Pick<
  AppInstallState,
  'isUninstalling' | 'uninstallProgress' | 'uninstallLogs' | 'uninstallError'
> {
  const allStates = useSyncExternalStore(subscribe, getSnapshot);
  const s = allStates[appId] ?? DEFAULT_STATE;
  return {
    isUninstalling: s.isUninstalling,
    uninstallProgress: s.uninstallProgress,
    uninstallLogs: s.uninstallLogs,
    uninstallError: s.uninstallError,
  };
}
