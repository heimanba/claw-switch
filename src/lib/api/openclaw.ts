import { invoke } from "@tauri-apps/api/core";
import type {
  OpenClawDefaultModel,
  OpenClawModelCatalogEntry,
  OpenClawAgentsDefaults,
  OpenClawEnvConfig,
  OpenClawToolsConfig,
  OpenClawAgentInfo,
  OpenClawGatewayConfig,
  OpenClawSkillItem,
  OpenClawSkillsListResult,
  ClawHubSkillItem,
} from "@/types";

/**
 * OpenClaw configuration API
 *
 * Manages ~/.openclaw/openclaw.json sections:
 * - agents.defaults (model, catalog)
 * - env (environment variables)
 * - tools (permissions)
 */
export const openclawApi = {
  // ============================================================
  // Agents Configuration
  // ============================================================

  /**
   * Get all available model IDs from models.providers.${provider}/models[*].id
   * Returns a list of "provider/model-id" strings.
   */
  async getProviderModels(): Promise<string[]> {
    return await invoke("get_openclaw_provider_models");
  },

  /**
   * Get default model configuration (agents.defaults.model)
   */
  async getDefaultModel(): Promise<OpenClawDefaultModel | null> {
    return await invoke("get_openclaw_default_model");
  },

  /**
   * Set default model configuration (agents.defaults.model)
   */
  async setDefaultModel(model: OpenClawDefaultModel): Promise<void> {
    return await invoke("set_openclaw_default_model", { model });
  },

  /**
   * Get model catalog/allowlist (agents.defaults.models)
   */
  async getModelCatalog(): Promise<Record<
    string,
    OpenClawModelCatalogEntry
  > | null> {
    return await invoke("get_openclaw_model_catalog");
  },

  /**
   * Set model catalog/allowlist (agents.defaults.models)
   */
  async setModelCatalog(
    catalog: Record<string, OpenClawModelCatalogEntry>,
  ): Promise<void> {
    return await invoke("set_openclaw_model_catalog", { catalog });
  },

  /**
   * Get full agents.defaults config (all fields)
   */
  async getAgentsDefaults(): Promise<OpenClawAgentsDefaults | null> {
    return await invoke("get_openclaw_agents_defaults");
  },

  /**
   * Set full agents.defaults config (all fields)
   */
  async setAgentsDefaults(defaults: OpenClawAgentsDefaults): Promise<void> {
    return await invoke("set_openclaw_agents_defaults", { defaults });
  },

  // ============================================================
  // Agent Instance Management
  // ============================================================

  /**
   * 列出所有 Agent 实例
   */
  async listAgents(): Promise<OpenClawAgentInfo[]> {
    return await invoke("list_agents");
  },

  /**
   * 创建新 Agent 实例
   */
  async addAgent(name: string, model?: string, workspace?: string): Promise<void> {
    return await invoke("add_agent", {
      name,
      model: model || null,
      workspace: workspace || null,
    });
  },

  /**
   * 删除 Agent 实例
   */
  async deleteAgent(id: string): Promise<void> {
    return await invoke("delete_agent", { id });
  },

  /**
   * 更新 Agent 身份信息（名称和 emoji）
   */
  async updateAgentIdentity(
    id: string,
    name: string | null,
    emoji: string | null,
  ): Promise<void> {
    return await invoke("update_agent_identity", { id, name, emoji });
  },

  /**
   * 更新 Agent 默认模型
   */
  async updateAgentModel(id: string, model: string): Promise<void> {
    return await invoke("update_agent_model", { id, model });
  },

  /**
   * 备份 Agent（返回 zip 文件路径）
   */
  async backupAgent(id: string): Promise<string> {
    return await invoke("backup_agent", { id });
  },

  // ============================================================
  // Env Configuration
  // ============================================================

  /**
   * Get env config (env section of openclaw.json)
   */
  async getEnv(): Promise<OpenClawEnvConfig> {
    return await invoke("get_openclaw_env");
  },

  /**
   * Set env config (env section of openclaw.json)
   */
  async setEnv(env: OpenClawEnvConfig): Promise<void> {
    return await invoke("set_openclaw_env", { env });
  },

  // ============================================================
  // Tools Configuration
  // ============================================================

  /**
   * Get tools config (tools section of openclaw.json)
   */
  async getTools(): Promise<OpenClawToolsConfig> {
    return await invoke("get_openclaw_tools");
  },

  /**
   * Set tools config (tools section of openclaw.json)
   */
  async setTools(tools: OpenClawToolsConfig): Promise<void> {
    return await invoke("set_openclaw_tools", { tools });
  },

  // ============================================================
  // Service Status
  // ============================================================

  /**
   * Check whether the OpenClaw gateway service is running (port 18789).
   */
  async getServiceStatus(): Promise<boolean> {
    return await invoke("get_openclaw_service_status");
  },

  /**
   * Get detailed OpenClaw gateway service status (running, pid, port, gateway_installed).
   */
  async getServiceDetail(): Promise<{
    running: boolean;
    pid: number | null;
    port: number;
    /** Whether the gateway system service (launchd/systemd) is installed. null = unknown. */
    gateway_installed: boolean | null;
  }> {
    return await invoke("get_openclaw_service_detail");
  },

  /**
   * Install the openclaw gateway system service via `openclaw gateway install`.
   */
  async installGateway(): Promise<string> {
    return await invoke("install_openclaw_gateway");
  },

  /**
   * Start the OpenClaw gateway service in the background.
   */
  async startService(): Promise<string> {
    return await invoke("start_openclaw_service");
  },

  /**
   * Stop the OpenClaw gateway service.
   */
  async stopService(): Promise<string> {
    return await invoke("stop_openclaw_service");
  },

  /**
   * Restart the OpenClaw gateway service.
   */
  async restartService(): Promise<string> {
    return await invoke("restart_openclaw_service");
  },

  /**
   * Run system diagnostic (config existence, gateway service). Aligned with openclaw-manager.
   */
  async runDiagnostic(): Promise<{
    config_exists: boolean;
    config_path: string;
    service_running: boolean;
    port: number;
  }> {
    return await invoke("run_openclaw_diagnostic");
  },

  /**
   * 运行完整系统诊断，返回逐项结果（与 openclaw-manager run_doctor 对齐）
   */
  async runDoctor(): Promise<Array<{
    name: string;
    passed: boolean;
    message: string;
    suggestion: string | null;
  }>> {
    return await invoke("run_doctor");
  },

  /**
   * 执行 `openclaw doctor --repair --yes`，自动修复已知问题（非交互式）。
   * 修复完成后应重启网关服务并重新诊断。
   */
  async runDoctorFix(): Promise<{ success: boolean; output: string }> {
    return await invoke("run_doctor_fix");
  },

  /**
   * 执行 `openclaw onboard`，在浏览器中打开 OpenClaw Web 管理界面。
   */
  async openOnboard(): Promise<string> {
    return await invoke("openclaw_onboard");
  },

  /**
   * 获取所有渠道配置状态（读取 openclaw.json channels 节）
   */
  async getChannelsConfig(): Promise<Array<{
    id: string;
    channel_type: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>> {
    return await invoke("get_openclaw_channels_config");
  },

  // ============================================================
  // Log Files (aligned with openclaw-manager)
  // ============================================================

  /**
   * 列出可用的 OpenClaw 日志文件
   */
  async listLogs(): Promise<Array<{
    name: string;
    path: string;
    size: number;
    modified: string | null;
  }>> {
    return await invoke("list_openclaw_logs");
  },

  /**
   * 读取日志文件内容
   */
  async readLog(path: string, limit?: number): Promise<string> {
    return await invoke("read_openclaw_log", { path, limit });
  },

  /**
   * 清空日志文件
   */
  async clearLog(path: string): Promise<void> {
    return await invoke("clear_openclaw_log", { path });
  },

  // ============================================================
  // Gateway Configuration
  // ============================================================

  /**
   * 获取 gateway 配置（gateway section of openclaw.json）
   */
  async getGatewayConfig(): Promise<OpenClawGatewayConfig> {
    return await invoke("get_openclaw_gateway");
  },

  /**
   * 保存 gateway 配置（gateway section of openclaw.json）
   */
  async setGatewayConfig(gateway: OpenClawGatewayConfig): Promise<void> {
    return await invoke("set_openclaw_gateway", { gateway });
  },

  /**
   * 重载 Gateway 服务（热应用配置，不需要完整重启）
   */
  async reloadGateway(): Promise<string> {
    return await invoke("reload_openclaw_gateway");
  },

  // ============================================================
  // OpenClaw Skills（CLI skills 管理）
  // ============================================================

  /**
   * 列出所有 OpenClaw Skills 及其依赖/可用状态。
   * 调用 `openclaw skills list --json`。
   * CLI 不可用时返回 { skills: [], cliAvailable: false }。
   */
  async skillsList(): Promise<OpenClawSkillsListResult> {
    return await invoke("openclaw_skills_list");
  },

  /**
   * 获取单个 OpenClaw Skill 的详细信息。
   * 调用 `openclaw skills info <name> --json`。
   */
  async skillsInfo(name: string): Promise<OpenClawSkillItem> {
    return await invoke("openclaw_skills_info", { name });
  },

  /**
   * 获取 ClawHub 元数据：分类列表与推荐 slug。
   */
  async clawHubSkillsMeta(): Promise<{
    categories: Record<string, string[]>;
    featured: string[];
  }> {
    return await invoke("openclaw_clawhub_skills_meta", {});
  },

  /**
   * 搜索 ClawHub 社区 Skills（本地 JSON）。
   * category: 分类名，如 "AI 智能"；不传则不过滤分类。
   * query: 关键词；与 category 都为空时返回推荐列表。
   */
  async clawHubSearch(
    query: string,
    category?: string
  ): Promise<ClawHubSkillItem[]> {
    return await invoke("openclaw_clawhub_search", {
      query: query ?? "",
      category: category ?? null,
    });
  },

  /**
   * 从 ClawHub 安装 Skill（通过 slug）。
   * 调用 `openclaw skills install <slug>`。
   */
  async clawHubInstall(slug: string): Promise<void> {
    return await invoke("openclaw_clawhub_install", { slug });
  },

  /**
   * 从 ZIP 文件安装 Skills 到 ~/.openclaw/skills/（直接安装，不走 SSOT/数据库）。
   * 这是专门为 OpenClaw 设计的，因为 OpenClaw 不识别 symlink。
   * 返回安装的 skill 目录名列表。
   */
  async installSkillsFromZip(filePath: string): Promise<string[]> {
    return await invoke("openclaw_install_skills_from_zip", { filePath });
  },
};
