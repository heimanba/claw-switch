import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import {
  MessageCircle,
  Hash,
  Slack,
  MessagesSquare,
  MessageSquare,
  Check,
  X,
  Loader2,
  ChevronRight,
  Apple,
  Bell,
  Eye,
  EyeOff,
  Play,
  QrCode,
  CheckCircle,
  XCircle,
  Download,
  Package,
  AlertTriangle,
  Trash2,
  RefreshCw,
  ChevronDown,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { channelLogger } from "@/lib/logger";

interface FeishuPluginStatus {
  installed: boolean;
  version: string | null;
  plugin_name: string | null;
}

interface DingTalkPluginStatus {
  installed: boolean;
  needs_reinstall: boolean;
  spec: string | null;
  version: string | null;
}

interface ChannelConfig {
  id: string;
  channel_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

interface ChannelField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string;
  /** 仅当某字段等于指定值时才显示此字段，如 { key: 'messageType', value: 'card' } */
  showWhen?: { key: string; value: string };
}

const channelInfo: Record<
  string,
  {
    name: string;
    icon: React.ReactNode;
    color: string;
    fields: ChannelField[];
    helpText?: string;
  }
> = {
  // 国内社交软件优先：钉钉 → 飞书 → 微信
  dingtalk: {
    name: "钉钉",
    icon: <Bell size={20} />,
    color: "text-blue-700",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        type: "text" as const,
        placeholder: "钉钉应用 Client ID (如 dingxxxxxx)",
        required: true,
      },
      {
        key: "clientSecret",
        label: "Client Secret",
        type: "password" as const,
        placeholder: "钉钉应用 Client Secret",
        required: true,
      },
      {
        key: "robotCode",
        label: "Robot Code",
        type: "text" as const,
        placeholder: "机器人 Code (如 dingxxxxxx)",
      },
      {
        key: "corpId",
        label: "Corp ID",
        type: "text" as const,
        placeholder: "企业 Corp ID (如 dingxxxxxx)",
      },
      {
        key: "agentId",
        label: "Agent ID",
        type: "text" as const,
        placeholder: "应用 Agent ID (如 123456789)",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select" as const,
        defaultValue: "open",
        options: [
          { value: "open", label: "开放模式（默认）" },
          { value: "pairing", label: "配对模式" },
          { value: "allowlist", label: "白名单" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select" as const,
        defaultValue: "open",
        options: [
          { value: "open", label: "开放（默认）" },
          { value: "allowlist", label: "白名单" },
        ],
      },
      {
        key: "messageType",
        label: "消息类型",
        type: "select" as const,
        defaultValue: "markdown",
        options: [
          { value: "markdown", label: "Markdown（默认）" },
          { value: "card", label: "卡片消息" },
        ],
      },
      {
        key: "cardTemplateId",
        label: "卡片模板 ID",
        type: "text" as const,
        placeholder: "卡片消息模板 ID（格式如 xxxxx-xxxxx.schema）",
        showWhen: { key: "messageType", value: "card" },
      },
      {
        key: "cardTemplateKey",
        label: "卡片内容变量 Key",
        type: "text" as const,
        placeholder: "模板内容变量 Key（默认为 content）",
        showWhen: { key: "messageType", value: "card" },
      },
      {
        key: "allowFrom",
        label: "允许来源",
        type: "text" as const,
        placeholder: "多个用逗号分隔，留空表示全部允许",
      },
      {
        key: "mediaMaxMb",
        label: "媒体文件大小上限 (MB)",
        type: "text" as const,
        placeholder: "默认 5MB，可选填如 20",
      },
    ],
    helpText: "从钉钉开放平台获取，需先安装 @soimy/dingtalk 插件",
  },
  feishu: {
    name: "飞书",
    icon: <MessagesSquare size={20} />,
    color: "text-blue-600",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "飞书应用 App ID",
        required: true,
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "飞书应用 App Secret",
        required: true,
      },
      {
        key: "testChatId",
        label: "测试 Chat ID",
        type: "text",
        placeholder: "用于发送测试消息的群聊/用户 ID (可选)",
      },
      {
        key: "connectionMode",
        label: "连接模式",
        type: "select",
        options: [
          { value: "websocket", label: "WebSocket (推荐)" },
          { value: "webhook", label: "Webhook" },
        ],
      },
      {
        key: "domain",
        label: "部署区域",
        type: "select",
        options: [
          { value: "feishu", label: "国内 (feishu.cn)" },
          { value: "lark", label: "海外 (larksuite.com)" },
        ],
      },
      {
        key: "requireMention",
        label: "需要 @提及",
        type: "select",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
    ],
    helpText: "从飞书开放平台获取凭证，Chat ID 可从群聊设置中获取",
  },
  wechat: {
    name: "微信",
    icon: <MessageSquare size={20} />,
    color: "text-green-700",
    fields: [
      {
        key: "appId",
        label: "App ID",
        type: "text",
        placeholder: "微信开放平台 App ID",
      },
      {
        key: "appSecret",
        label: "App Secret",
        type: "password",
        placeholder: "微信开放平台 App Secret",
      },
    ],
    helpText: "微信公众号/企业微信配置",
  },
  // 国际社交软件
  telegram: {
    name: "Telegram",
    icon: <MessageCircle size={20} />,
    color: "text-blue-500",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "从 @BotFather 获取",
        required: true,
      },
      {
        key: "userId",
        label: "User ID",
        type: "text",
        placeholder: "你的 Telegram User ID",
        required: true,
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText:
      "1. 搜索 @BotFather 发送 /newbot 获取 Token  2. 搜索 @userinfobot 获取 User ID",
  },
  discord: {
    name: "Discord",
    icon: <Hash size={20} />,
    color: "text-indigo-500",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "Discord Bot Token",
        required: true,
      },
      {
        key: "testChannelId",
        label: "测试 Channel ID",
        type: "text",
        placeholder: "用于发送测试消息的频道 ID (可选)",
      },
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText: "从 Discord Developer Portal 获取，开启开发者模式可复制 Channel ID",
  },
  slack: {
    name: "Slack",
    icon: <Slack size={20} />,
    color: "text-purple-500",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        type: "password",
        placeholder: "xoxb-...",
        required: true,
      },
      {
        key: "appToken",
        label: "App Token",
        type: "password",
        placeholder: "xapp-...",
      },
      {
        key: "testChannelId",
        label: "测试 Channel ID",
        type: "text",
        placeholder: "用于发送测试消息的频道 ID (可选)",
      },
    ],
    helpText: "从 Slack API 后台获取，Channel ID 可从频道详情复制",
  },
  imessage: {
    name: "iMessage",
    icon: <Apple size={20} />,
    color: "text-green-500",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText: "仅支持 macOS，需要授权消息访问权限",
  },
  whatsapp: {
    name: "WhatsApp",
    icon: <MessageCircle size={20} />,
    color: "text-green-600",
    fields: [
      {
        key: "dmPolicy",
        label: "私聊策略",
        type: "select",
        options: [
          { value: "pairing", label: "配对模式" },
          { value: "open", label: "开放模式" },
          { value: "disabled", label: "禁用" },
        ],
      },
      {
        key: "groupPolicy",
        label: "群组策略",
        type: "select",
        options: [
          { value: "allowlist", label: "白名单" },
          { value: "open", label: "开放" },
          { value: "disabled", label: "禁用" },
        ],
      },
    ],
    helpText: "需要扫描二维码登录，运行: openclaw channels login --channel whatsapp",
  },
};

interface TestResult {
  success: boolean;
  message: string;
  error: string | null;
}

// 钉钉插件卡片组件
interface DingTalkPluginCardProps {
  status: DingTalkPluginStatus | null;
  loading: boolean;
  installing: boolean;
  onInstall: () => void;
  onRefresh: () => void;
}

const DingTalkPluginCard: React.FC<DingTalkPluginCardProps> = ({
  status,
  loading,
  installing,
  onInstall,
  onRefresh,
}) => {
  const [showManual, setShowManual] = useState(false);
  const [copied, setCopied] = useState(false);

  const installCommand = "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @soimy/dingtalk";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  }, []);

  if (loading) {
    return (
      <div className="mb-4 px-5">
        <div className="p-4 bg-bg-secondary rounded-xl border border-border flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-text-muted" />
          <span className="text-sm text-text-muted">正在检查钉钉插件状态...</span>
        </div>
      </div>
    );
  }

  if (status?.installed) {
    return (
      <div className="mb-4 px-5">
        <div className="p-4 bg-green-50 rounded-xl border border-green-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800">钉钉插件已安装</p>
            <p className="text-xs text-green-600 mt-0.5">
              @soimy/dingtalk{status.version && ` v${status.version}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            disabled={installing}
            className="border-green-300 text-green-800 hover:bg-green-100"
          >
            {installing ? (
              <Loader2 size={14} className="animate-spin mr-2" />
            ) : (
              <RefreshCw size={14} className="mr-2" />
            )}
            {installing ? "安装中..." : "重新安装"}
          </Button>
        </div>
      </div>
    );
  }

  const isReinstall = status?.needs_reinstall;
  const title = isReinstall ? "插件规格不匹配" : "钉钉插件未安装";
  const description = isReinstall
    ? `当前规格: ${status?.spec || "未知"}，需要重新安装`
    : "安装插件后即可配置钉钉消息通知";

  return (
    <div className="mb-4 px-5">
      <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
        {/* 状态头部 */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-amber-900">{title}</h4>
            <p className="text-xs text-amber-700 mt-0.5">{description}</p>
          </div>
        </div>

        {/* 主要操作 */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <Loader2 size={14} className="animate-spin mr-2" />
            ) : (
              <Download size={14} className="mr-2" />
            )}
            {installing ? "安装中..." : isReinstall ? "重新安装插件" : "一键安装插件"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={14} className="mr-2" />
            刷新状态
          </Button>
        </div>

        {/* 手动安装折叠区 */}
        <div className="mt-3">
          <button
            onClick={() => setShowManual(!showManual)}
            className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 transition-colors"
          >
            <span>手动安装</span>
            <ChevronDown
              size={14}
              className={cn("transition-transform", showManual && "rotate-180")}
            />
          </button>

          {showManual && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3"
            >
              {/* 命令复制区 */}
              <div className="relative">
                <div className="p-3 bg-stone-100 rounded-lg border border-stone-200">
                  <code className="text-xs text-stone-700 font-mono break-all leading-relaxed block pr-8">
                    {installCommand}
                  </code>
                </div>
                <button
                  onClick={handleCopy}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-stone-200 transition-colors"
                  title="复制命令"
                >
                  {copied ? (
                    <Check size={14} className="text-green-600" />
                  ) : (
                    <Copy size={14} className="text-stone-500" />
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* 文档链接 */}
        <div className="mt-4 pt-3 border-t border-amber-200/60">
          <a
            href="https://github.com/soimy/openclaw-channel-dingtalk"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 transition-colors"
          >
            <span>查看完整安装文档</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};

const ChannelsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [feishuPluginStatus, setFeishuPluginStatus] =
    useState<FeishuPluginStatus | null>(null);
  const [feishuPluginLoading, setFeishuPluginLoading] = useState(false);
  const [feishuPluginInstalling, setFeishuPluginInstalling] = useState(false);

  const [dingtalkPluginStatus, setDingtalkPluginStatus] =
    useState<DingTalkPluginStatus | null>(null);
  const [dingtalkPluginLoading, setDingtalkPluginLoading] = useState(false);
  const [dingtalkPluginInstalling, setDingtalkPluginInstalling] = useState(false);
  const [restartingGateway, setRestartingGateway] = useState(false);

  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );

  const togglePasswordVisibility = (fieldKey: string) => {
    setVisiblePasswords((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const checkFeishuPlugin = async () => {
    setFeishuPluginLoading(true);
    try {
      const status = await invoke<FeishuPluginStatus>(
        "check_openclaw_feishu_plugin",
      );
      setFeishuPluginStatus(status);
    } catch (e) {
      console.error("检查飞书插件失败:", e);
      setFeishuPluginStatus({ installed: false, version: null, plugin_name: null });
    } finally {
      setFeishuPluginLoading(false);
    }
  };

  const handleInstallFeishuPlugin = async () => {
    setFeishuPluginInstalling(true);
    try {
      const result = await invoke<string>("install_openclaw_feishu_plugin");
      toast.success(result);
      await checkFeishuPlugin();
    } catch (e) {
      toast.error("安装失败: " + e);
    } finally {
      setFeishuPluginInstalling(false);
    }
  };

  const checkDingtalkPlugin = async () => {
    setDingtalkPluginLoading(true);
    try {
      const status = await invoke<DingTalkPluginStatus>(
        "check_openclaw_dingtalk_plugin",
      );
      setDingtalkPluginStatus(status);
    } catch (e) {
      console.error("检查钉钉插件失败:", e);
      setDingtalkPluginStatus({ installed: false, needs_reinstall: false, spec: null, version: null });
    } finally {
      setDingtalkPluginLoading(false);
    }
  };

  const handleInstallDingtalkPlugin = async () => {
    setDingtalkPluginInstalling(true);
    try {
      const result = await invoke<string>("install_openclaw_dingtalk_plugin");
      toast.success(result);
      await checkDingtalkPlugin();
    } catch (e) {
      toast.error("安装失败: " + e);
    } finally {
      setDingtalkPluginInstalling(false);
    }
  };

  const handleRestartGateway = async () => {
    setRestartingGateway(true);
    try {
      const result = await invoke<string>("restart_openclaw_service");
      toast.success(result || "Gateway 已重启");
    } catch (e) {
      toast.error("重启 Gateway 失败: " + e);
    } finally {
      setRestartingGateway(false);
    }
  };

  const handleShowClearConfirm = () => {
    if (!selectedChannel) return;
    setShowClearConfirm(true);
  };

  const handleClearConfig = async () => {
    if (!selectedChannel) return;

    const channel = channels.find((c) => c.id === selectedChannel);
    const channelName = channel
      ? channelInfo[channel.channel_type]?.name || channel.channel_type
      : selectedChannel;

    setShowClearConfirm(false);
    setClearing(true);
    try {
      await invoke("clear_openclaw_channel_config", {
        channelId: selectedChannel,
      });
      setConfigForm({});
      await fetchChannels();
      setTestResult({
        success: true,
        message: `${channelName} 配置已清空`,
        error: null,
      });
    } catch (e) {
      setTestResult({
        success: false,
        message: "清空失败",
        error: String(e),
      });
    } finally {
      setClearing(false);
    }
  };

  const handleQuickTest = async () => {
    if (!selectedChannel) return;

    setTesting(true);
    setTestResult(null);

    try {
      const result = await invoke<{
        success: boolean;
        channel: string;
        message: string;
        error: string | null;
      }>("test_openclaw_channel", { channelType: selectedChannel });

      setTestResult({
        success: result.success,
        message: result.message,
        error: result.error,
      });
    } catch (e) {
      setTestResult({
        success: false,
        message: "测试失败",
        error: String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleWhatsAppLogin = async () => {
    setLoginLoading(true);
    try {
      await invoke("start_openclaw_channel_login", { channelType: "whatsapp" });

      const pollInterval = setInterval(async () => {
        try {
          const result = await invoke<{
            success: boolean;
            message: string;
          }>("test_openclaw_channel", { channelType: "whatsapp" });

          if (result.success) {
            clearInterval(pollInterval);
            setLoginLoading(false);
            await fetchChannels();
            setTestResult({
              success: true,
              message: "WhatsApp 登录成功！",
              error: null,
            });
          }
        } catch {
          // 继续轮询
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setLoginLoading(false);
      }, 60000);

      toast.info("请在弹出的终端窗口中扫描二维码完成登录，登录成功后界面会自动更新");
    } catch (e) {
      toast.error("启动登录失败: " + e);
      setLoginLoading(false);
    }
  };

  const fetchChannels = async () => {
    try {
      const result = await invoke<ChannelConfig[]>("get_openclaw_channels_config");
      channelLogger.debug("加载渠道配置", { count: result.length });
      setChannels(result);
      return result;
    } catch (e) {
      channelLogger.error("获取渠道配置失败", e);
      return [];
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const result = await fetchChannels();
        const configured = result.find((c) => c.enabled);
        if (configured) {
          handleChannelSelect(configured.id, result);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleChannelSelect = (
    channelId: string,
    channelList?: ChannelConfig[],
  ) => {
    setSelectedChannel(channelId);
    setTestResult(null);

    const list = channelList || channels;
    const channel = list.find((c) => c.id === channelId);

    if (channel) {
      const form: Record<string, string> = {};
      // allowFrom 后端存的是 string[]，表单显示时转为逗号分隔字符串
      const arrayFields = new Set(["allowFrom"]);
      Object.entries(channel.config).forEach(([key, value]) => {
        if (typeof value === "boolean") {
          form[key] = value ? "true" : "false";
        } else if (arrayFields.has(key) && Array.isArray(value)) {
          form[key] = value.join(", ");
        } else {
          form[key] = String(value ?? "");
        }
      });

      // 对有默认值的字段，若后端未返回则填入默认值，方便新用户看到预设选项
      if (channel.channel_type === "dingtalk") {
        if (!form["dmPolicy"]) form["dmPolicy"] = "open";
        if (!form["groupPolicy"]) form["groupPolicy"] = "open";
        if (!form["messageType"]) form["messageType"] = "markdown";
      }

      setConfigForm(form);

      if (channel.channel_type === "feishu") {
        checkFeishuPlugin();
      }
      if (channel.channel_type === "dingtalk") {
        checkDingtalkPlugin();
      }
    } else {
      setConfigForm({});
    }
  };

  const handleSave = async () => {
    if (!selectedChannel) return;

    channelLogger.action(`保存渠道配置: ${selectedChannel}`);
    setSaving(true);
    try {
      const channel = channels.find((c) => c.id === selectedChannel);
      if (!channel) return;

      const config: Record<string, unknown> = {};
      // allowFrom 字段需要按逗号拆分为数组（后端期望 string[]）
      const arrayFields = new Set(["allowFrom"]);
      Object.entries(configForm).forEach(([key, value]) => {
        if (value === "true") {
          config[key] = true;
        } else if (value === "false") {
          config[key] = false;
        } else if (value) {
          if (arrayFields.has(key)) {
            config[key] = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            config[key] = value;
          }
        }
      });
      // allowFrom 为空时默认允许所有来源
      if (channel.channel_type === "dingtalk" && !config["allowFrom"]) {
        config["allowFrom"] = ["*"];
      }

      await invoke("save_openclaw_channel_config", {
        channel: {
          ...channel,
          config,
        },
      });

      channelLogger.info(`✅ 渠道配置已保存: ${selectedChannel}`);
      await fetchChannels();
      toast.success("渠道配置已保存！");
    } catch (e) {
      channelLogger.error(`❌ 保存渠道配置失败: ${selectedChannel}`, e);
      toast.error("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  };

  const currentChannel = channels.find((c) => c.id === selectedChannel);
  const currentInfo = currentChannel
    ? channelInfo[currentChannel.channel_type]
    : null;

  const hasValidConfig = (channel: ChannelConfig) => {
    const info = channelInfo[channel.channel_type];
    if (!info) return channel.enabled;

    const requiredFields = info.fields.filter((f) => f.required);
    if (requiredFields.length === 0) return channel.enabled;

    return requiredFields.some((field) => {
      const value = channel.config[field.key];
      return value !== undefined && value !== null && value !== "";
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="px-6 pt-4 h-full flex flex-col">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl flex-1 min-h-0">
        {/* 渠道列表 */}
        <div className="md:col-span-1 space-y-2 overflow-y-auto pr-1">
          <h3 className="text-xs font-medium text-text-muted mb-3 px-1 uppercase tracking-wide">
            {t('common.channelTitle', { defaultValue: '消息渠道' })}
          </h3>
          {[...channels].sort((a, b) => {
            const order = ['dingtalk', 'feishu', 'wechat', 'telegram', 'discord', 'slack', 'whatsapp', 'imessage'];
            const ai = order.indexOf(a.channel_type);
            const bi = order.indexOf(b.channel_type);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          }).map((channel) => {
            const info = channelInfo[channel.channel_type] || {
              name: channel.channel_type,
              icon: <MessageSquare size={20} />,
              color: "text-text-muted",
              fields: [],
            };
            const isSelected = selectedChannel === channel.id;
            const isConfigured = hasValidConfig(channel);

            return (
              <button
                key={channel.id}
                onClick={() => handleChannelSelect(channel.id)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                  isSelected
                    ? "bg-bg-secondary border-accent"
                    : "bg-bg-card border-border-subtle hover:border-border",
                )}
              >
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                    isConfigured ? "bg-bg-tertiary" : "bg-bg-secondary",
                  )}
                >
                  <span className={info.color}>{info.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium truncate",
                      isSelected ? "text-text-primary" : "text-text-secondary",
                    )}
                  >
                    {info.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {isConfigured ? (
                      <>
                        <Check size={11} className="text-green-500" />
                        <span className="text-xs text-green-600">已配置</span>
                      </>
                    ) : (
                      <>
                        <X size={11} className="text-text-tertiary" />
                        <span className="text-xs text-text-tertiary">
                          未配置
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <ChevronRight
                  size={14}
                  className={
                    isSelected ? "text-accent" : "text-text-tertiary"
                  }
                />
              </button>
            );
          })}
        </div>

        {/* 配置面板 */}
        <div className="md:col-span-2 overflow-y-auto">
          {currentChannel && currentInfo ? (
            <motion.div
              key={selectedChannel}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-bg-card rounded-xl border border-border flex flex-col"
            >
              <div className="flex items-center gap-3 mb-5 px-5 pt-5">
                <div
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center bg-bg-secondary flex-shrink-0",
                    currentInfo.color,
                  )}
                >
                  {currentInfo.icon}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    配置 {currentInfo.name}
                  </h3>
                  {currentInfo.helpText && (
                    <p className="text-xs text-text-muted mt-0.5">
                      {currentInfo.helpText}
                    </p>
                  )}
                </div>
              </div>

              {/* 飞书插件状态提示 */}
              {currentChannel.channel_type === "feishu" && (
                <div className="mb-4 px-5">
                  {feishuPluginLoading ? (
                    <div className="p-3 bg-bg-secondary rounded-lg border border-border flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-text-muted" />
                      <span className="text-sm text-text-muted">
                        正在检查飞书插件状态...
                      </span>
                    </div>
                  ) : feishuPluginStatus?.installed ? (
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200 flex items-center gap-2">
                      <Package size={16} className="text-green-600" />
                      <div className="flex-1">
                        <p className="text-sm text-green-700 font-medium">
                          飞书插件已安装
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">
                          {feishuPluginStatus.plugin_name ||
                            "@m1heng-clawd/feishu"}
                          {feishuPluginStatus.version &&
                            ` v${feishuPluginStatus.version}`}
                        </p>
                      </div>
                      <CheckCircle size={14} className="text-green-500" />
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          size={16}
                          className="text-amber-600 mt-0.5 flex-shrink-0"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-800">
                            需要安装飞书插件
                          </p>
                          <p className="text-xs text-amber-700 mt-1">
                            飞书渠道需要先安装 @m1heng-clawd/feishu 插件才能使用。
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={handleInstallFeishuPlugin}
                              disabled={feishuPluginInstalling}
                            >
                              {feishuPluginInstalling ? (
                                <Loader2 size={13} className="animate-spin mr-1" />
                              ) : (
                                <Download size={13} className="mr-1" />
                              )}
                              {feishuPluginInstalling
                                ? "安装中..."
                                : "一键安装插件"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={checkFeishuPlugin}
                              disabled={feishuPluginLoading}
                            >
                              刷新状态
                            </Button>
                          </div>
                          <p className="text-xs text-amber-600 mt-2">
                            或手动执行:{" "}
                            <code className="px-1.5 py-0.5 bg-amber-100 rounded text-amber-800 font-mono">
                              openclaw plugins install @m1heng-clawd/feishu
                            </code>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 钉钉插件状态提示 */}
              {currentChannel.channel_type === "dingtalk" && (
                <DingTalkPluginCard
                  status={dingtalkPluginStatus}
                  loading={dingtalkPluginLoading}
                  installing={dingtalkPluginInstalling}
                  onInstall={handleInstallDingtalkPlugin}
                  onRefresh={checkDingtalkPlugin}
                />
              )}

              <div className="space-y-4 flex-1 overflow-y-auto px-5 pb-4">
                {currentInfo.fields.map((field) => {
                  // 联动隐藏：showWhen 条件不满足时不渲染
                  if (field.showWhen) {
                    const watchValue = configForm[field.showWhen.key] || (currentInfo.fields.find(f => f.key === field.showWhen!.key)?.defaultValue ?? "");
                    if (watchValue !== field.showWhen.value) return null;
                  }
                  return (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                      {field.label}
                      {field.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                      {configForm[field.key] && (
                        <span className="ml-2 text-green-500 text-xs">✓</span>
                      )}
                    </label>

                    {field.type === "select" ? (
                      <select
                        value={configForm[field.key] || field.defaultValue || ""}
                        onChange={(e) =>
                          setConfigForm({
                            ...configForm,
                            [field.key]: e.target.value,
                          })
                        }
                        className="w-full h-9 px-3 py-1.5 text-sm rounded-md border border-input bg-bg-card text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {!field.defaultValue && <option value="">请选择...</option>}
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "password" ? (
                      <div className="relative">
                        <Input
                          type={
                            visiblePasswords.has(field.key) ? "text" : "password"
                          }
                          value={configForm[field.key] || ""}
                          onChange={(e) =>
                            setConfigForm({
                              ...configForm,
                              [field.key]: e.target.value,
                            })
                          }
                          placeholder={field.placeholder}
                          className="pr-9 font-mono text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(field.key)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                        >
                          {visiblePasswords.has(field.key) ? (
                            <EyeOff size={15} />
                          ) : (
                            <Eye size={15} />
                          )}
                        </button>
                      </div>
                    ) : (
                      <Input
                        type={field.type}
                        value={configForm[field.key] || ""}
                        onChange={(e) =>
                          setConfigForm({
                            ...configForm,
                            [field.key]: e.target.value,
                          })
                        }
                        placeholder={field.placeholder}
                        className="text-sm"
                      />
                    )}
                  </div>
                );
                })}

                {/* WhatsApp 扫码登录 */}
                {currentChannel.channel_type === "whatsapp" && (
                  <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2 mb-2">
                      <QrCode size={18} className="text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-800">
                          扫码登录
                        </p>
                        <p className="text-xs text-green-700">
                          WhatsApp 需要扫描二维码登录
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleWhatsAppLogin}
                        disabled={loginLoading}
                        className="flex-1"
                      >
                        {loginLoading ? (
                          <Loader2 size={13} className="animate-spin mr-1" />
                        ) : (
                          <QrCode size={13} className="mr-1" />
                        )}
                        {loginLoading ? "等待登录..." : "启动扫码登录"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await fetchChannels();
                          handleQuickTest();
                        }}
                        disabled={testing}
                        title="刷新状态"
                      >
                        {testing ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-green-600 mt-1.5">
                      登录成功后点击右侧按钮刷新状态
                    </p>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="pt-4 border-t border-border flex flex-wrap items-center gap-2 sticky bottom-0 bg-bg-card pb-1">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 size={13} className="animate-spin mr-1.5" />
                    ) : (
                      <Check size={13} className="mr-1.5" />
                    )}
                    {t('common.saveConfig', { defaultValue: '保存配置' })}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleQuickTest}
                    disabled={testing}
                  >
                    {testing ? (
                      <Loader2 size={13} className="animate-spin mr-1.5" />
                    ) : (
                      <Play size={13} className="mr-1.5" />
                    )}
                    快速测试
                  </Button>

                  {currentChannel.channel_type === "dingtalk" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRestartGateway}
                      disabled={restartingGateway}
                    >
                      {restartingGateway ? (
                        <Loader2 size={13} className="animate-spin mr-1.5" />
                      ) : (
                        <RefreshCw size={13} className="mr-1.5" />
                      )}
                      重启 Gateway
                    </Button>
                  )}

                  {!showClearConfirm ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleShowClearConfirm}
                      disabled={clearing}
                      className="text-destructive hover:text-destructive bg-destructive/10 hover:bg-destructive/20"
                    >
                      {clearing ? (
                        <Loader2 size={13} className="animate-spin mr-1.5" />
                      ) : (
                        <Trash2 size={13} className="mr-1.5" />
                      )}
                      清空配置
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-red-50 rounded-lg border border-red-200">
                      <span className="text-xs text-red-700">确定清空？</span>
                      <button
                        onClick={handleClearConfig}
                        className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                      >
                        确定
                      </button>
                      <button
                        onClick={() => setShowClearConfirm(false)}
                        className="px-2 py-0.5 text-xs bg-bg-secondary text-text-secondary rounded hover:bg-bg-tertiary transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                {/* 测试结果 */}
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "p-3 rounded-lg flex items-start gap-2.5",
                      testResult.success
                        ? "bg-green-50 border border-green-200"
                        : "bg-red-50 border border-red-200",
                    )}
                  >
                    {testResult.success ? (
                      <CheckCircle
                        size={16}
                        className="text-green-500 mt-0.5 flex-shrink-0"
                      />
                    ) : (
                      <XCircle
                        size={16}
                        className="text-red-500 mt-0.5 flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          testResult.success
                            ? "text-green-700"
                            : "text-red-700",
                        )}
                      >
                        {testResult.success ? "测试成功" : "测试失败"}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {testResult.message}
                      </p>
                      {testResult.error && (
                        <p className="text-xs text-red-500 mt-1.5 whitespace-pre-wrap font-mono">
                          {testResult.error}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center min-h-[200px] text-text-muted text-sm">
              选择左侧渠道进行配置
            </div>
          )}
        </div>
      </div>
    </div>
  
  );
};

export default ChannelsPanel;
