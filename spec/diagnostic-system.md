# 需求文档

## 介绍

OpenClaw诊断系统是一个综合性的健康检查和问题诊断工具，旨在帮助用户快速识别和解决OpenClaw安装、配置、网关连接、频道集成以及运行时环境中的常见问题。该系统整合现有的 `openclaw doctor` 和 `openclaw status` 命令功能，并提供友好的UI界面展示诊断结果，支持自动修复和详细的问题报告。

## 术语表

- **Diagnostic_System**: 诊断系统，负责执行健康检查、问题识别和修复建议的核心模块
- **Check_Item**: 检查项，单个诊断检查的最小单元（如Node.js版本检查、配置文件验证等）
- **Health_Status**: 健康状态，表示检查项的结果（通过/警告/失败）
- **Gateway**: 网关服务，OpenClaw的核心服务组件，负责处理消息路由和频道连接
- **Channel**: 频道，消息传递渠道（WhatsApp、Telegram、Discord、Slack、Signal等）
- **Config_File**: 配置文件，存储OpenClaw配置的JSON文件（通常位于~/.openclaw/config.json）
- **Provider**: 供应商，AI模型提供商（Anthropic、OpenAI、Google等）
- **Repair_Action**: 修复操作，针对检测到的问题提供的自动或半自动修复方案
- **Diagnostic_Report**: 诊断报告，包含所有检查项结果和修复建议的完整报告
- **UI_Interface**: 用户界面，展示诊断结果的图形界面或命令行界面

## 需求

### 需求 1: 核心诊断检查

**用户故事:** 作为OpenClaw用户，我希望系统能自动检查所有关键组件的健康状态，以便快速了解系统是否正常运行。

#### 验收标准

1. THE Diagnostic_System SHALL 执行OpenClaw安装检查，验证可执行文件存在且版本正确
2. THE Diagnostic_System SHALL 执行Node.js环境检查，验证版本满足最低要求（Node 22+）
3. THE Diagnostic_System SHALL 执行配置文件检查，验证Config_File存在且格式有效
4. WHEN Config_File不存在或格式无效, THE Diagnostic_System SHALL 标记为失败状态并提供修复建议
5. THE Diagnostic_System SHALL 执行网关服务检查，验证Gateway进程运行状态和可达性
6. THE Diagnostic_System SHALL 执行供应商配置检查，验证至少一个Provider已正确配置API密钥
7. THE Diagnostic_System SHALL 执行频道连接检查，验证已配置的Channel连接状态
8. THE Diagnostic_System SHALL 在10秒内完成所有基础检查项（不包括深度探测）

### 需求 2: 环境依赖检查

**用户故事:** 作为OpenClaw用户，我希望系统能检查所有必需的环境依赖，以便确保系统能够正常运行。

#### 验收标准

1. THE Diagnostic_System SHALL 检查Node.js版本是否满足最低要求（22.0.0或更高）
2. THE Diagnostic_System SHALL 检查npm或pnpm包管理器是否可用
3. WHEN 检测到源码安装, THE Diagnostic_System SHALL 验证node_modules目录存在且完整
4. THE Diagnostic_System SHALL 检查必需的系统命令可用性（git、curl等）
5. WHERE Docker沙箱功能已启用, THE Diagnostic_System SHALL 验证Docker守护进程运行状态
6. THE Diagnostic_System SHALL 检查磁盘空间是否充足（至少500MB可用空间）
7. THE Diagnostic_System SHALL 检查状态目录权限是否正确（~/.openclaw可读写）

### 需求 3: 配置验证

**用户故事:** 作为OpenClaw用户，我希望系统能验证我的配置文件，以便发现配置错误和不一致。

#### 验收标准

1. THE Diagnostic_System SHALL 解析Config_File并验证JSON语法正确性
2. THE Diagnostic_System SHALL 验证必需的配置字段存在（gateway.mode等）
3. THE Diagnostic_System SHALL 验证配置值的类型和格式正确性
4. THE Diagnostic_System SHALL 检测已弃用的配置选项并提供迁移建议
5. THE Diagnostic_System SHALL 验证频道配置的完整性（账号绑定、认证信息等）
6. THE Diagnostic_System SHALL 检测配置冲突（如allowlist策略但allowFrom为空）
7. WHEN 发现配置问题, THE Diagnostic_System SHALL 提供具体的修复命令或步骤
8. THE Diagnostic_System SHALL 验证自定义工具配置的safeBinProfiles条目存在

### 需求 4: 网关健康检查

**用户故事:** 作为OpenClaw用户，我希望系统能检查网关服务的健康状态，以便确保消息路由正常工作。

#### 验收标准

1. THE Diagnostic_System SHALL 检查Gateway进程是否正在运行
2. WHEN gateway.mode为local, THE Diagnostic_System SHALL 验证本地网关端口可达
3. WHEN gateway.mode为remote, THE Diagnostic_System SHALL 验证远程网关URL可达
4. THE Diagnostic_System SHALL 执行网关健康端点探测（/health或等效接口）
5. THE Diagnostic_System SHALL 验证网关认证配置正确性（token、password或off模式）
6. THE Diagnostic_System SHALL 检查网关内存搜索功能状态
7. WHEN 网关不可达, THE Diagnostic_System SHALL 提供重启或重新配置的建议
8. THE Diagnostic_System SHALL 在3秒内完成网关健康检查（非交互模式）

### 需求 5: 频道状态探测

**用户故事:** 作为OpenClaw用户，我希望系统能探测所有已配置频道的连接状态，以便了解哪些频道可以正常使用。

#### 验收标准

1. THE Diagnostic_System SHALL 列出所有已配置的Channel
2. WHERE 深度探测已启用, THE Diagnostic_System SHALL 对每个Channel执行连接测试
3. THE Diagnostic_System SHALL 报告每个Channel的连接状态（已连接/已断开/未配置）
4. WHEN Channel已配置但未连接, THE Diagnostic_System SHALL 提供重新登录或重新链接的建议
5. THE Diagnostic_System SHALL 检测WhatsApp Web会话状态和重连尝试次数
6. THE Diagnostic_System SHALL 检测Telegram bot token有效性
7. THE Diagnostic_System SHALL 检测Discord bot token和权限配置
8. THE Diagnostic_System SHALL 在用户请求时执行深度探测（默认不执行以节省时间）

### 需求 6: 供应商和模型配置检查

**用户故事:** 作为OpenClaw用户，我希望系统能验证AI供应商配置，以便确保模型调用能够成功。

#### 验收标准

1. THE Diagnostic_System SHALL 检查至少一个Provider已配置
2. THE Diagnostic_System SHALL 验证默认Provider和默认模型已设置
3. THE Diagnostic_System SHALL 检查API密钥是否存在（不验证有效性，除非深度探测）
4. WHERE 深度探测已启用, THE Diagnostic_System SHALL 执行模型可用性测试
5. THE Diagnostic_System SHALL 检测OAuth认证配置的完整性（Anthropic、GitHub Copilot等）
6. THE Diagnostic_System SHALL 验证模型allowlist配置正确性
7. WHEN 未配置任何Provider, THE Diagnostic_System SHALL 提供配置向导链接或命令
8. THE Diagnostic_System SHALL 检查hooks.gmail.model配置是否在catalog和allowlist中

### 需求 7: 安全和认证检查

**用户故事:** 作为OpenClaw用户，我希望系统能检查安全配置，以便确保系统安全运行。

#### 验收标准

1. THE Diagnostic_System SHALL 检查网关认证模式配置（token/password/off）
2. WHEN 网关认证为off且非loopback绑定, THE Diagnostic_System SHALL 发出安全警告
3. THE Diagnostic_System SHALL 检查会话锁文件的完整性和过期状态
4. THE Diagnostic_System SHALL 检测已弃用的CLI认证配置文件
5. THE Diagnostic_System SHALL 验证OAuth TLS前置条件（用于OpenAI OAuth等）
6. THE Diagnostic_System SHALL 检查状态目录是否位于云同步路径（可能导致冲突）
7. WHEN 发现安全问题, THE Diagnostic_System SHALL 提供具体的修复建议和命令

### 需求 8: 自动修复功能

**用户故事:** 作为OpenClaw用户，我希望系统能自动修复常见问题，以便快速恢复正常运行。

#### 验收标准

1. WHERE --fix标志已提供, THE Diagnostic_System SHALL 自动执行所有可修复的Repair_Action
2. THE Diagnostic_System SHALL 在执行修复前备份Config_File
3. THE Diagnostic_System SHALL 自动生成缺失的网关认证token
4. THE Diagnostic_System SHALL 自动迁移已弃用的配置选项到新格式
5. THE Diagnostic_System SHALL 自动清理过期的会话锁文件
6. THE Diagnostic_System SHALL 自动修复Docker沙箱镜像问题
7. THE Diagnostic_System SHALL 自动添加缺失的allowFrom通配符
8. WHEN 修复需要用户输入, THE Diagnostic_System SHALL 在交互模式下提示用户确认
9. THE Diagnostic_System SHALL 记录所有执行的修复操作到日志
10. WHEN 修复失败, THE Diagnostic_System SHALL 回滚更改并报告错误

### 需求 9: 诊断报告生成

**用户故事:** 作为OpenClaw用户，我希望获得详细的诊断报告，以便分享给支持团队或自行排查问题。

#### 验收标准

1. THE Diagnostic_System SHALL 生成包含所有Check_Item结果的Diagnostic_Report
2. THE Diagnostic_System SHALL 在报告中包含系统信息（操作系统、Node版本、OpenClaw版本）
3. THE Diagnostic_System SHALL 在报告中包含配置摘要（已脱敏的关键配置项）
4. THE Diagnostic_System SHALL 在报告中列出所有通过的检查项
5. THE Diagnostic_System SHALL 在报告中突出显示失败和警告的检查项
6. THE Diagnostic_System SHALL 为每个问题提供修复建议或文档链接
7. WHERE --json标志已提供, THE Diagnostic_System SHALL 输出机器可读的JSON格式报告
8. THE Diagnostic_System SHALL 在报告中包含下一步操作建议（如运行status --deep、查看日志等）
9. THE Diagnostic_System SHALL 自动脱敏报告中的敏感信息（API密钥、token、电话号码等）

### 需求 10: UI界面展示

**用户故事:** 作为OpenClaw用户，我希望通过友好的界面查看诊断结果，以便快速理解系统状态。

#### 验收标准

1. THE UI_Interface SHALL 显示诊断进度指示器（加载动画或进度条）
2. THE UI_Interface SHALL 显示检查项总数和通过数量的摘要（如"6/7项检查通过"）
3. THE UI_Interface SHALL 使用视觉标识区分通过、警告和失败状态（颜色、图标等）
4. THE UI_Interface SHALL 默认折叠通过的检查项列表，允许用户展开查看
5. THE UI_Interface SHALL 默认展开失败和警告的检查项，显示详细信息
6. THE UI_Interface SHALL 为每个失败项提供操作按钮（如"前往配置"、"重试"、"查看文档"）
7. THE UI_Interface SHALL 支持一键复制诊断报告到剪贴板
8. THE UI_Interface SHALL 在命令行界面使用表格和颜色格式化输出
9. THE UI_Interface SHALL 在Web界面提供响应式布局适配不同屏幕尺寸
10. THE UI_Interface SHALL 提供刷新按钮重新执行诊断检查

### 需求 11: 命令行接口

**用户故事:** 作为OpenClaw用户，我希望通过命令行快速执行诊断，以便在脚本或CI环境中使用。

#### 验收标准

1. THE Diagnostic_System SHALL 通过 `openclaw doctor` 命令启动诊断
2. THE Diagnostic_System SHALL 支持 --fix 标志启用自动修复模式
3. THE Diagnostic_System SHALL 支持 --deep 标志启用深度探测（包括网络调用）
4. THE Diagnostic_System SHALL 支持 --json 标志输出JSON格式结果
5. THE Diagnostic_System SHALL 支持 --non-interactive 标志禁用所有交互提示
6. THE Diagnostic_System SHALL 在非交互模式下使用合理的默认值
7. THE Diagnostic_System SHALL 返回适当的退出码（0=成功，1=发现问题，2=严重错误）
8. THE Diagnostic_System SHALL 支持 --timeout 参数自定义探测超时时间
9. THE Diagnostic_System SHALL 在标准输出打印诊断结果，在标准错误打印错误信息

### 需求 12: 集成现有工具

**用户故事:** 作为OpenClaw开发者，我希望诊断系统能复用现有的doctor和status命令逻辑，以便保持代码一致性。

#### 验收标准

1. THE Diagnostic_System SHALL 复用现有的doctor命令检查逻辑（doctor-*.ts模块）
2. THE Diagnostic_System SHALL 复用现有的status命令探测逻辑（status.*.ts模块）
3. THE Diagnostic_System SHALL 复用现有的配置验证逻辑（config-validation.ts）
4. THE Diagnostic_System SHALL 复用现有的网关健康检查逻辑（doctor-gateway-health.ts）
5. THE Diagnostic_System SHALL 复用现有的频道状态检查逻辑（channels/status.ts）
6. THE Diagnostic_System SHALL 保持与现有命令的输出格式兼容性
7. THE Diagnostic_System SHALL 使用统一的主题和格式化工具（terminal/palette.ts）
8. THE Diagnostic_System SHALL 在UI界面中调用相同的底层检查函数

### 需求 13: 性能和可靠性

**用户故事:** 作为OpenClaw用户，我希望诊断系统快速可靠，以便不影响正常使用。

#### 验收标准

1. THE Diagnostic_System SHALL 在5秒内完成基础检查（不包括深度探测）
2. THE Diagnostic_System SHALL 并行执行独立的检查项以提高速度
3. THE Diagnostic_System SHALL 为每个检查项设置合理的超时时间
4. WHEN 单个检查项超时, THE Diagnostic_System SHALL 标记为失败并继续其他检查
5. THE Diagnostic_System SHALL 缓存可复用的检查结果（如版本信息）
6. THE Diagnostic_System SHALL 优雅处理网络错误和文件系统错误
7. THE Diagnostic_System SHALL 在低内存环境下正常运行
8. THE Diagnostic_System SHALL 记录详细的调试日志用于问题排查

### 需求 14: 文档和帮助

**用户故事:** 作为OpenClaw用户，我希望获得清晰的文档和帮助信息，以便理解诊断结果和修复步骤。

#### 验收标准

1. THE Diagnostic_System SHALL 为每个检查项提供简短的描述
2. THE Diagnostic_System SHALL 为每个失败项提供详细的错误信息
3. THE Diagnostic_System SHALL 为每个问题提供文档链接（docs.openclaw.ai）
4. THE Diagnostic_System SHALL 提供常见问题的修复命令示例
5. THE Diagnostic_System SHALL 在 --help 输出中列出所有可用选项和示例
6. THE Diagnostic_System SHALL 在文档中说明每个检查项的目的和修复方法
7. THE Diagnostic_System SHALL 提供故障排除流程图或决策树
8. THE Diagnostic_System SHALL 在UI界面提供上下文帮助和工具提示

### 需求 15: 扩展性和维护性

**用户故事:** 作为OpenClaw开发者，我希望诊断系统易于扩展，以便添加新的检查项和修复逻辑。

#### 验收标准

1. THE Diagnostic_System SHALL 使用插件化架构支持添加新的Check_Item
2. THE Diagnostic_System SHALL 为每个检查项定义标准接口（execute、repair、format）
3. THE Diagnostic_System SHALL 支持检查项的依赖关系声明（如配置检查依赖文件存在检查）
4. THE Diagnostic_System SHALL 支持检查项的条件执行（如仅在特定平台或配置下执行）
5. THE Diagnostic_System SHALL 提供测试工具验证新检查项的正确性
6. THE Diagnostic_System SHALL 使用TypeScript类型确保类型安全
7. THE Diagnostic_System SHALL 在代码中添加清晰的注释说明检查逻辑
8. THE Diagnostic_System SHALL 遵循现有的代码风格和命名约定
