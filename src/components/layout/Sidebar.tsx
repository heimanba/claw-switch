import {
  LayoutDashboard,
  Settings,
  Book,
  Wrench,
  History,
  FolderOpen,
  KeyRound,
  Shield,
  Cpu,
  Users,
  FlaskConical,
  MessageCircle,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { AppId } from '@/lib/api';
import type { VisibleApps } from '@/types';
import { McpIcon } from '@/components/BrandIcons';
import { AppSwitcher } from '@/components/AppSwitcher';
import { ProxyToggle } from '@/components/proxy/ProxyToggle';
import { FailoverToggle } from '@/components/proxy/FailoverToggle';
import { Button } from '@/components/ui/button';
import { useProxyStatus } from '@/hooks/useProxyStatus';
import { useOpenClawServiceStatus } from '@/hooks/useOpenClaw';

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
  | "openclawAgents"
  | "openclawTesting"
  | "openclawChannels"
  | "openclawLogs";

interface SidebarProps {
  currentView: View;
  activeApp: AppId;
  visibleApps: VisibleApps;
  onViewChange: (view: View) => void;
  onAppChange: (app: AppId) => void;
  enableLocalProxy?: boolean;
}

interface MenuItem {
  id: View;
  label: string;
  icon: React.ElementType;
  visible?: boolean;
}

export function Sidebar({
  currentView,
  activeApp,
  visibleApps,
  onViewChange,
  onAppChange,
  enableLocalProxy = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const {
    isRunning: isProxyRunning,
    takeoverStatus,
  } = useProxyStatus();

  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;

  const isOpenClaw = activeApp === 'openclaw';
  const { data: isOpenClawRunning } = useOpenClawServiceStatus(isOpenClaw);

  // 根据当前应用决定功能菜单项
  const getAppMenuItems = (): MenuItem[] => {
    if (activeApp === 'openclaw') {
      return [
        { id: 'providers', label: t('providers.title', { defaultValue: '供应商配置' }), icon: Users },
        { id: 'workspace', label: t('workspace.title', { defaultValue: '工作区文件' }), icon: FolderOpen },
        { id: 'openclawEnv', label: t('openclaw.env.title', { defaultValue: '环境变量' }), icon: KeyRound },
        { id: 'openclawTools', label: t('openclaw.tools.title', { defaultValue: '核心工具' }), icon: Shield },
        { id: 'openclawAgents', label: t('openclaw.agents.title', { defaultValue: '智能体' }), icon: Cpu },
        { id: 'openclawTesting', label: t('openclaw.testing.title', { defaultValue: '系统体检' }), icon: FlaskConical },
        { id: 'openclawChannels', label: t('openclaw.channels.title', { defaultValue: '消息渠道' }), icon: MessageCircle },
        { id: 'openclawLogs', label: t('openclaw.logs.title', { defaultValue: '服务日志' }), icon: Terminal },
        { id: 'sessions', label: t('sessionManager.title', { defaultValue: '会话记录' }), icon: History },
      ];
    }

    // 常规应用的菜单项
    const baseItems: MenuItem[] = [
      { id: 'providers', label: t('providers.title', { defaultValue: '供应商配置' }), icon: Users },
      { id: 'skills', label: t('skills.title', { defaultValue: '技能管理' }), icon: Wrench },
      // { id: 'prompts', label: t('prompts.title', { defaultValue: '提示词' }), icon: Book },
      // { id: 'mcp', label: t('mcp.title', { defaultValue: 'MCP 服务' }), icon: McpIcon },  // MCP 管理已隐藏
    ];

    // 支持会话管理的应用
    const hasSessionSupport = ['qwen', 'claude', 'codex', 'opencode', 'openclaw', 'gemini'].includes(activeApp);
    if (hasSessionSupport) {
      baseItems.push({ id: 'sessions', label: t('sessionManager.title', { defaultValue: '会话管理' }), icon: History });
    }

    return baseItems;
  };

  const globalMenuItems: MenuItem[] = [
    { id: 'dashboard', label: t('overview.menuTitle', { defaultValue: '概览' }), icon: LayoutDashboard },
  ];

  const settingsMenuItem: MenuItem = { 
    id: 'settings', 
    label: t('settings.title', { defaultValue: '设置' }), 
    icon: Settings 
  };

  const appMenuItems = getAppMenuItems();

  const renderMenuItem = (item: MenuItem, isGlobal = false) => {
    const isActive = currentView === item.id;
    const Icon = item.icon;

    return (
      <li key={item.id}>
        <button
          onClick={() => onViewChange(item.id)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-smooth',
            isActive
              ? 'bg-bg-tertiary text-text-primary'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
          )}
        >
          {/* Active indicator dot */}
          <span className={cn(
            'flex-shrink-0 w-1.5 h-1.5 rounded-full transition-smooth',
            isActive ? 'bg-accent' : 'bg-transparent'
          )} />
          <Icon size={16} className="flex-shrink-0" />
          <span>{item.label}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="w-64 min-h-0 bg-bg-sidebar border-r border-border-subtle flex flex-col">
      {/* Logo 区域 */}
      <div className="h-12 flex items-center px-5 border-b border-border-subtle" data-tauri-drag-region>
        <div className="flex items-center gap-2 pointer-events-none">
          {/* Claw switch wordmark */}
          {/* <svg viewBox="0 0 120 28" fill="none" className="h-[14px]" style={{ width: 'auto' }}>
            <text x="0" y="20" fontSize="20" fontWeight="700" fontFamily="Inter, -apple-system, sans-serif" fill="currentColor">Claw</text>
            <text x="32" y="20" fontSize="20" fontWeight="400" fontFamily="Inter, -apple-system, sans-serif" fill="var(--color-accent)">Switch</text>
          </svg> */}
        </div>
      </div>

      {/* 应用切换器 */}
      <div className="px-3 py-3 border-b border-border-subtle">
        <div className="space-y-1.5">
          <AppSwitcher
            activeApp={activeApp}
            onSwitch={onAppChange}
            visibleApps={visibleApps}
            compact={false}
          />
        </div>
      </div>

      {/* 功能菜单 */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        <ul className="space-y-1.5">
          {globalMenuItems.map((item) => renderMenuItem(item, true))}
          {appMenuItems.map((item) => renderMenuItem(item))}
          {renderMenuItem(settingsMenuItem, true)}
        </ul>
      </nav>

      {/* 底部状态和代理控制 */}
      <div className="p-3 border-t border-border-subtle space-y-2">
        {/* 代理控制 - 仅在非 OpenCode/OpenClaw 且启用代理时显示 */}
        {enableLocalProxy && activeApp !== 'opencode' && activeApp !== 'openclaw' && (
          <div className="flex items-center gap-2">
            <ProxyToggle activeApp={activeApp} />
            {isCurrentAppTakeoverActive && (
              <div className="transition-smooth">
                <FailoverToggle activeApp={activeApp} />
              </div>
            )}
          </div>
        )}

        {/* 状态信息 - 仅 OpenClaw 显示服务状态 */}
        {isOpenClaw && (
          <div className="px-3 py-2 bg-bg-secondary rounded-lg border border-border-subtle">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                isOpenClawRunning ? 'bg-status-success animate-pulse-soft' : 'bg-text-tertiary'
              )} />
              <span className="text-xs text-text-muted">
                {isOpenClawRunning
                  ? t('openclaw.service.running', { defaultValue: '服务运行中' })
                  : t('openclaw.service.stopped', { defaultValue: '服务未启动' })}
              </span>
            </div>
            {isOpenClawRunning && (
              <p className="text-xs text-text-tertiary mt-1 pl-4">
                {t('common.port', { defaultValue: '端口' })}: 18789
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}