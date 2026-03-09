import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { AppId } from '@/lib/api';

type View =
  | "dashboard"
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawGateway"
  | "openclawTesting"
  | "openclawChannels"
  | "openclawLogs"
  | "openclawSkills"
  | "chat";

interface HeaderProps {
  currentView: View;
  activeApp: AppId;
  children?: ReactNode; // 用于放置页面特定的操作按钮
  className?: string;
}

export function Header({ currentView, activeApp, children, className }: HeaderProps) {
  const { t } = useTranslation();

  const getViewTitle = (): string => {
    switch (currentView) {
      case 'dashboard':
        return t('overview.title', { appName: t(`apps.${activeApp}`), defaultValue: '{{appName}} 概览' });
      case 'providers':
        return activeApp === 'openclaw'
          ? t('openclaw.providers.title', { defaultValue: '模型配置' })
          : t('providers.title', { defaultValue: '供应商配置' });
      case 'settings':
        return t('settings.title', { defaultValue: '系统设置' });
      case 'prompts':
        return t('prompts.title', { 
          appName: t(`apps.${activeApp}`),
          defaultValue: '提示词管理',
        });
      case 'skills':
        return t('skills.title', { defaultValue: 'Skills 管理' });
      case 'mcp':
        return t('mcp.unifiedPanel.title', { defaultValue: 'MCP 服务配置' });
      case 'agents':
        return t('agents.title', { defaultValue: 'Agent 管理' });
      case 'universal':
        return t('universalProvider.title', { defaultValue: '统一供应商' });
      case 'sessions':
        return t('sessionManager.title', { defaultValue: '会话管理' });
      case 'workspace':
        return t('workspace.title', { defaultValue: '工作区文件' });
      case 'openclawEnv':
        return t('openclaw.env.title', { defaultValue: '环境变量' });
      case 'openclawTools':
        return t('openclaw.tools.title', { defaultValue: '核心工具' });
      case 'openclawTesting':
        return t('openclaw.testing.title', { defaultValue: '系统体检' });
      case 'openclawChannels':
        return t('openclaw.channels.title', { defaultValue: '消息渠道' });
      case 'openclawGateway':
        return t('openclaw.gateway.title', { defaultValue: 'Gateway 配置' });
      case 'openclawLogs':
        return t('openclaw.logs.title', { defaultValue: '服务日志' });
      case 'openclawSkills':
        return t('openclaw.skills.title', { defaultValue: 'Skills 管理' });
      case 'chat':
        return t('chat.title', { defaultValue: '聊天' });
      default:
        return t('common.unknown', { defaultValue: '未知页面' });
    }
  };

  const getViewDescription = (): string => {
    switch (currentView) {
      case 'dashboard':
        return '';
      case 'providers':
        return activeApp === 'openclaw'
          ? t('openclaw.modelConfig.description', { defaultValue: '选择主模型及回退模型，主模型不可用时自动切换到回退模型。' })
          : t('providers.description', { defaultValue: '配置和管理模型供应商' });
      case 'settings':
        return t('settings.description', { defaultValue: '系统配置和偏好设置' });
      case 'prompts':
        return t('prompts.description', { defaultValue: '管理提示词模板' });
      case 'skills':
        return t('skills.description', { defaultValue: '安装和管理技能插件' });
      case 'mcp':
        return t('mcp.description', { defaultValue: '配置模型上下文协议服务' });
      case 'sessions':
        return t('sessionManager.description', { defaultValue: '查看和管理对话会话' });
      case 'workspace':
        return t('workspace.description', { defaultValue: '管理工作区文件和项目' });
      case 'openclawEnv':
        return t('openclaw.env.description', { defaultValue: '配置环境变量和密钥' });
      case 'openclawTools':
        return t('openclaw.tools.description', { defaultValue: '配置可用工具和权限' });
      case 'openclawTesting':
        return t('openclaw.testing.subtitle', { defaultValue: '系统诊断与问题排查' });
      case 'openclawGateway':
        return t('openclaw.gateway.description', { defaultValue: '配置 AI 模型统一入口，访问权限和认证方式' });
      case 'openclawChannels':
        return t('openclaw.channels.description', { defaultValue: '配置 Telegram、Discord、飞书等通知渠道' });
      case 'openclawSkills':
        return t('openclaw.skills.description', { defaultValue: '查看和管理 OpenClaw Skills 及其依赖状态' });
      default:
        return '';
    }
  };

  const description = getViewDescription();

  return (
    <header 
      className={cn(
        "h-16 bg-bg-primary/80 backdrop-blur-md shadow-[0_1px_0_0_var(--color-border-subtle)] flex items-center justify-between px-6",
        className
      )}
      data-tauri-drag-region
    >
      {/* 左侧：页面标题 + 副标题 */}
      <div className="flex-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-text-primary truncate shrink-0 tracking-tight">
            {getViewTitle()}
          </h1>
          {description && (
            <span className="text-sm text-text-muted truncate hidden sm:block">
              {description}
            </span>
          )}
        </div>
      </div>

      {/* 右侧：页面特定操作 */}
      {children && (
        <div 
          className="flex items-center gap-2 ml-4"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {children}
        </div>
      )}
    </header>
  );
}