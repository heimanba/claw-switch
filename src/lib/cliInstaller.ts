import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppId } from '@/lib/api';

export interface InstallError {
  code: 'PERMISSION_DENIED' | 'INSTALL_FAILED' | 'INSTALL_TIMEOUT' | 'NODE_NPM_NOT_FOUND' | 'UNKNOWN_ERROR' | 'CANCELLED';
  message: string;
  fallbackAction: 'manual' | 'retry' | null;
}

export interface InstallCompletePayload {
  /** npm 全局 bin 目录，若终端中 command not found 可将此目录加入 PATH */
  globalBinPath?: string | null;
}

export interface InstallOptions {
  appId: AppId;
  onProgress?: (progress: number, log: string) => void;
  onComplete?: (payload?: InstallCompletePayload) => void;
  onError?: (error: InstallError) => void;
}

export interface UninstallOptions {
  appId: AppId;
  onProgress?: (progress: number, log: string) => void;
  onComplete?: () => void;
  onError?: (error: InstallError) => void;
}

/** 正在进行中的安装任务（appId → Promise），防止重复启动 */
const activeInstalls = new Map<AppId, Promise<void>>();

/** 正在进行中的卸载任务（appId → Promise），防止重复启动 */
const activeUninstalls = new Map<AppId, Promise<void>>();

// 应用安装命令映射（仅供 UI 展示，实际安装由后端执行）
const REGISTRY = '--registry=https://registry.npmmirror.com';

const INSTALL_COMMANDS: Record<AppId, string> = {
  claude: `npm install -g @anthropic-ai/claude-code ${REGISTRY}`,
  codex: `npm install -g @openai/codex ${REGISTRY}`,
  gemini: `npm install -g @google/gemini-cli ${REGISTRY}`,
  opencode: `npm install -g opencode-ai ${REGISTRY}`,
  qwen: `npm install -g @qwen-code/qwen-code ${REGISTRY}`,
  openclaw: `npm install -g openclaw ${REGISTRY}`,
  cline: `npm install -g @cline/cline-code ${REGISTRY}`,
};

/** 卸载命令（仅供 UI 展示） */
const UNINSTALL_COMMANDS: Partial<Record<AppId, string>> = {
  claude: `npm uninstall -g @anthropic-ai/claude-code ${REGISTRY}`,
  codex: `npm uninstall -g @openai/codex ${REGISTRY}`,
  gemini: `npm uninstall -g @google/gemini-cli ${REGISTRY}`,
  opencode: `npm uninstall -g opencode-ai ${REGISTRY}`,
  qwen: `npm uninstall -g @qwen-code/qwen-code ${REGISTRY}`,
  openclaw: `npm uninstall -g openclaw ${REGISTRY}`,
  cline: `npm uninstall -g @cline/cline-code ${REGISTRY}`,
};

/** 后端返回的安装结果结构 */
interface BackendInstallResult {
  success: boolean;
  message: string;
  error_code: string | null;
  fallback_action: string | null;
  /** 安装成功时 npm 全局 bin 目录，用于提示用户将 PATH 加入终端 */
  global_bin_path?: string | null;
}

/** 后端推送的实时进度事件负载 */
interface CliInstallProgress {
  app_id: string;
  progress: number;
  log: string;
}

/**
 * 获取应用的安装命令（供 UI 展示）
 */
export function getInstallCommand(appId: AppId): string {
  return INSTALL_COMMANDS[appId] || '';
}

/**
 * 获取应用的卸载命令（供 UI 展示）；opencode 等无 npm 包则返回空字符串
 */
export function getUninstallCommand(appId: AppId): string {
  return UNINSTALL_COMMANDS[appId] ?? '';
}

/** 是否支持通过本应用卸载该 CLI（有 npm 包则支持） */
export function canUninstall(appId: AppId): boolean {
  return appId in UNINSTALL_COMMANDS;
}

/**
 * 检测 CLI 工具是否已安装
 */
export async function checkInstalled(appId: AppId): Promise<boolean> {
  try {
    const toolName = getToolName(appId);
    if (!toolName) return false;
    // 利用 Tauri shell 插件做快速检测（仅用于检测，不用于安装）
    const { Command } = await import('@tauri-apps/plugin-shell');
    const command = Command.create('sh', ['-c', `command -v ${toolName}`]);
    const output = await command.execute();
    return output.code === 0;
  } catch {
    return false;
  }
}

/**
 * 获取工具的命令名称
 */
function getToolName(appId: AppId): string {
  const toolNames: Record<AppId, string> = {
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    opencode: 'opencode',
    qwen: 'qwen',
    openclaw: 'openclaw',
    cline: 'cline',
  };
  return toolNames[appId] || '';
}

/**
 * 安装 CLI 工具（后端驱动，后台持续运行）
 *
 * 安装任务与组件生命周期解耦：切换 Tab 不会中断安装进程。
 * - 同一 appId 的安装只会启动一次，重复调用会复用已有任务
 * - 进度通过全局 installStore 持久化，组件重新挂载后可恢复显示
 */
export async function install(options: InstallOptions): Promise<void> {
  const { appId, onProgress, onComplete, onError } = options;

  // 如果已有正在进行的安装任务，直接复用（不重复启动）
  if (activeInstalls.has(appId)) {
    return activeInstalls.get(appId);
  }

  // 动态导入 store，避免循环依赖
  const storeModule = await import('@/stores/installStore');
  storeModule.setInstalling(appId, true);

  const task = (async () => {
    // 订阅后端推送的实时进度事件（生命周期与任务绑定，不与组件绑定）
    const unlisten = await listen<CliInstallProgress>('cli-install-progress', (event) => {
      const { app_id, progress, log } = event.payload;
      if (app_id !== appId) return;

      // 写入全局 store（组件可随时读取，切换 Tab 后恢复显示）
      storeModule.updateInstallProgress(appId, progress, log);
      onProgress?.(progress, log);
    });

    try {
      const result = await invoke<BackendInstallResult>('install_cli_tool', { appId });

      if (result.success) {
        storeModule.setInstalling(appId, false);
        onComplete?.({
          globalBinPath: result.global_bin_path ?? null,
        });
      } else {
        const err: InstallError = {
          code: (result.error_code as InstallError['code']) ?? 'UNKNOWN_ERROR',
          message: result.message,
          fallbackAction: (result.fallback_action as InstallError['fallbackAction']) ?? null,
        };
        storeModule.setInstallError(appId, err);
        onError?.(err);
      }
    } catch (error) {
      console.error('[CLI Installer] 调用后端安装命令失败:', error);
      const err: InstallError = {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : '未知错误',
        fallbackAction: 'manual',
      };
      storeModule.setInstallError(appId, err);
      onError?.(err);
    } finally {
      unlisten();
      activeInstalls.delete(appId);
    }
  })();

  activeInstalls.set(appId, task);
  return task;
}

/**
 * 取消正在进行的安装
 */
export function cancel(): void {
  invoke('cancel_cli_install').catch((error) => {
    console.error('[CLI Installer] 取消安装失败:', error);
  });
}

/**
 * 打开系统终端进行手动安装
 */
export async function openTerminalInstall(appId: AppId): Promise<void> {
  try {
    await invoke('open_terminal_for_install', { appId });
  } catch (error) {
    console.error('[CLI Installer] 打开终端失败:', error);
    throw error;
  }
}

/**
 * 卸载 CLI 工具（后端驱动，事件名 cli-uninstall-progress）
 * 同一 appId 的卸载只会启动一次，重复调用复用已有任务。
 */
export async function uninstall(options: UninstallOptions): Promise<void> {
  const { appId, onProgress, onComplete, onError } = options;

  if (activeUninstalls.has(appId)) {
    return activeUninstalls.get(appId);
  }

  const storeModule = await import('@/stores/installStore');
  storeModule.setUninstalling(appId, true);

  const task = (async () => {
    const unlisten = await listen<CliInstallProgress>('cli-uninstall-progress', (event) => {
      const { app_id, progress, log } = event.payload;
      if (app_id !== appId) return;
      storeModule.updateUninstallProgress(appId, progress, log);
      onProgress?.(progress, log);
    });

    try {
      const result = await invoke<BackendInstallResult>('uninstall_cli_tool', { appId });

      if (result.success) {
        storeModule.setUninstalling(appId, false);
        onComplete?.();
      } else {
        const err: InstallError = {
          code: (result.error_code as InstallError['code']) ?? 'UNKNOWN_ERROR',
          message: result.message,
          fallbackAction: (result.fallback_action as InstallError['fallbackAction']) ?? null,
        };
        storeModule.setUninstallError(appId, err);
        onError?.(err);
      }
    } catch (error) {
      console.error('[CLI Installer] 调用后端卸载命令失败:', error);
      const err: InstallError = {
        code: 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : '未知错误',
        fallbackAction: 'manual',
      };
      storeModule.setUninstallError(appId, err);
      onError?.(err);
    } finally {
      unlisten();
      activeUninstalls.delete(appId);
    }
  })();

  activeUninstalls.set(appId, task);
  return task;
}

/**
 * 取消正在进行的卸载
 */
export function cancelUninstall(): void {
  invoke('cancel_cli_uninstall').catch((error) => {
    console.error('[CLI Installer] 取消卸载失败:', error);
  });
}

/**
 * 打开系统终端进行手动卸载
 */
export async function openTerminalUninstall(appId: AppId): Promise<void> {
  try {
    await invoke('open_terminal_for_uninstall', { appId });
  } catch (error) {
    console.error('[CLI Installer] 打开终端失败:', error);
    throw error;
  }
}
