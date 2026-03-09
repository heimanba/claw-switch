import {
  LayoutDashboard,
  Settings,
  Wrench,
  History,
  FolderOpen,
  KeyRound,
  Shield,
  Users,
  FlaskConical,
  MessageCircle,
  Terminal,
  ChevronDown,
  Moon,
  Sun,
  Bot,
  Network,
  MessagesSquare,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AppId } from '@/lib/api';
import type { VisibleApps } from '@/types';
import { ProxyToggle } from '@/components/proxy/ProxyToggle';
import { FailoverToggle } from '@/components/proxy/FailoverToggle';
import { useProxyStatus } from '@/hooks/useProxyStatus';
import { useOpenClawServiceStatus } from '@/hooks/useOpenClaw';
import { ProviderIcon } from '@/components/ProviderIcon';
import { APP_IDS } from '@/config/appConfig';
import { useTheme } from '@/components/theme-provider';
import { getCurrentVersion } from '@/lib/updater';
import appIconUrl from '@/assets/icons/app-icon.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

interface SidebarProps {
  currentView: View;
  activeApp: AppId;
  visibleApps: VisibleApps;
  onViewChange: (view: View) => void;
  onAppChange: (app: AppId) => void;
  enableLocalProxy?: boolean;
  dragBarHeight?: number;
}

interface MenuItem {
  id: View;
  label: string;
  icon: React.ElementType;
  visible?: boolean;
}

interface MenuGroup {
  label?: string;
  items: MenuItem[];
}

export function Sidebar({
  currentView,
  activeApp,
  visibleApps,
  onViewChange,
  onAppChange,
  enableLocalProxy = false,
  dragBarHeight = 0,
}: SidebarProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    getCurrentVersion().then(setAppVersion).catch(() => {});
  }, []);

  const toggleTheme = (e: React.MouseEvent) => {
    setTheme(theme === 'dark' ? 'light' : 'dark', e);
  };

  const {
    takeoverStatus,
  } = useProxyStatus();

  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;

  const isOpenClaw = activeApp === 'openclaw';
  const { data: isOpenClawRunning } = useOpenClawServiceStatus(isOpenClaw);

  // 根据当前应用决定功能菜单分组
  const getMenuGroups = (): MenuGroup[] => {
    if (activeApp === 'openclaw') {
      return [
        {
          // 无标签，概览单独一项
          items: [
            { id: 'dashboard', label: t('overview.menuTitle', { defaultValue: '概览' }), icon: LayoutDashboard },
          ],
        },
        {
          // 无标签，高频入口紧跟概览
          items: [
            { id: 'chat', label: t('chat.title', { defaultValue: '聊天' }), icon: MessagesSquare },
            { id: 'sessions', label: t('sessionManager.title', { defaultValue: '会话管理' }), icon: History },
          ],
        },
        {
          label: t('sidebar.group.config', { defaultValue: '配置' }),
          items: [
            { id: 'providers', label: t('openclaw.providers.title', { defaultValue: '模型配置' }), icon: Users },
            { id: 'openclawGateway', label: t('openclaw.gateway.title', { defaultValue: 'Gateway 配置' }), icon: Network },
            { id: 'openclawChannels', label: t('openclaw.channels.title', { defaultValue: '消息渠道' }), icon: MessageCircle },
            { id: 'openclawTools', label: t('openclaw.tools.title', { defaultValue: '工具权限' }), icon: Shield },
            { id: 'openclawEnv', label: t('openclaw.env.title', { defaultValue: '环境变量' }), icon: KeyRound },
            { id: 'openclawSkills', label: t('openclaw.skills.title', { defaultValue: 'Skills 管理' }), icon: Wrench },
          ],
        },
        {
          label: t('sidebar.group.ops', { defaultValue: '运维' }),
          items: [
            { id: 'agents', label: t('agentsPanel.menuTitle', { defaultValue: 'Agent 管理' }), icon: Bot },
            { id: 'openclawTesting', label: t('openclaw.testing.title', { defaultValue: '系统体检' }), icon: FlaskConical },
            { id: 'openclawLogs', label: t('openclaw.logs.title', { defaultValue: '服务日志' }), icon: Terminal },
          ],
        },
        {
          items: [
            { id: 'workspace', label: t('workspace.title', { defaultValue: '文件管理' }), icon: FolderOpen },
            { id: 'settings', label: t('settings.title', { defaultValue: '设置' }), icon: Settings },
          ],
        },
      ];
    }

    // 常规应用：保留原有扁平结构，仅做简单分组
    const configItems: MenuItem[] = [
      { id: 'providers', label: t('providers.title', { defaultValue: '供应商配置' }), icon: Users },
      { id: 'skills', label: t('skills.title', { defaultValue: '技能管理' }), icon: Wrench },
    ];

    const hasSessionSupport = ['qwen', 'claude', 'codex', 'opencode', 'openclaw', 'gemini'].includes(activeApp);
    if (hasSessionSupport) {
      configItems.push({ id: 'sessions', label: t('sessionManager.title', { defaultValue: '会话管理' }), icon: History });
    }

    return [
      {
        items: [
          { id: 'dashboard', label: t('overview.menuTitle', { defaultValue: '概览' }), icon: LayoutDashboard },
        ],
      },
      {
        items: configItems,
      },
      {
        items: [
          { id: 'settings', label: t('settings.title', { defaultValue: '设置' }), icon: Settings },
        ],
      },
    ];
  };

  const menuGroups = getMenuGroups();

  const renderMenuItem = (item: MenuItem) => {
    const isActive = currentView === item.id;
    const Icon = item.icon;

    return (
      <li key={item.id}>
        <button
          onClick={() => onViewChange(item.id)}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-[color,background-color,opacity] duration-150 ease-out',
            isActive
              ? 'bg-bg-tertiary text-accent font-medium'
              : 'text-text-muted font-normal hover:text-text-primary hover:bg-bg-tertiary'
          )}
        >
          <Icon
            size={16}
            className={cn(
              'flex-shrink-0 transition-colors duration-150',
              isActive ? 'text-accent' : 'text-text-tertiary group-hover:text-text-primary'
            )}
          />
          <span className="truncate">{item.label}</span>
          {isActive && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0 opacity-80" />
          )}
        </button>
      </li>
    );
  };

  const appsToShow = APP_IDS.filter((app) => {
    if (!visibleApps) return true;
    return visibleApps[app];
  });

  const appIconName: Record<AppId, string> = {
    claude: 'claude',
    codex: 'openai',
    gemini: 'gemini',
    opencode: 'opencode',
    openclaw: 'openclaw',
    qwen: 'qwen',
    cline: 'cline',
  };

  const appDisplayName: Record<AppId, string> = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode',
    openclaw: 'OpenClaw',
    qwen: 'Qwen Code',
    cline: 'Cline',
  };

  return (
    <aside className="w-56 min-h-0 bg-bg-sidebar border-r border-border-subtle flex flex-col" style={{ paddingTop: dragBarHeight }}>
      {/* ── 品牌区：Claw Switch Logo + 版本 + 主题切换 ── */}
      <div
        className="flex items-center gap-2.5 px-4 border-b border-border-subtle"
        style={{ height: 48, paddingTop: 0 }}
        data-tauri-drag-region
      >
        <img
          src={appIconUrl}
          alt="Claw Switch"
          className="w-5 h-5 rounded flex-shrink-0 select-none"
          draggable={false}
        />
        <span className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate tracking-tight select-none">
          Claw Switch
        </span>
        {appVersion && (
          <span className="text-[10px] font-medium text-text-tertiary tabular-nums select-none flex-shrink-0">
            v{appVersion}
          </span>
        )}
        <button
          onClick={toggleTheme}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
        >
          {theme === 'dark'
            ? <Sun className="w-3.5 h-3.5" />
            : <Moon className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ── App Chip 切换区 ── */}
      <div className="px-3 py-2.5 border-b border-border-subtle" data-tauri-drag-region>
        <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-widest px-1 mb-1.5 select-none">
          {t('sidebar.managedApp', { defaultValue: '管理对象' })}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors group w-full"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <ProviderIcon
                icon={appIconName[activeApp]}
                name={appDisplayName[activeApp]}
                size={16}
              />
              <span className="text-xs font-medium text-text-primary truncate flex-1 min-w-0 text-left">
                {appDisplayName[activeApp]}
              </span>
              <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0 group-hover:text-text-primary transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="w-52">
            {appsToShow.map((app) => (
              <DropdownMenuItem
                key={app}
                onClick={() => onAppChange(app)}
                className={cn(
                  'flex items-center gap-2.5 cursor-pointer',
                  app === activeApp && 'bg-accent/10 text-accent'
                )}
              >
                <ProviderIcon
                  icon={appIconName[app]}
                  name={appDisplayName[app]}
                  size={18}
                />
                <span className="font-medium">{appDisplayName[app]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 功能菜单 */}
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        <div className="space-y-3">
          {menuGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.label && (
                <p className="text-[10px] font-medium text-text-tertiary uppercase tracking-widest px-2 mb-1 select-none">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => renderMenuItem(item))}
              </ul>
            </div>
          ))}
        </div>
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
                isOpenClawRunning ? 'bg-status-success animate-pulse-soft' : 'bg-orange-400'
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