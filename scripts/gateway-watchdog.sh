#!/bin/bash
#
# OpenClaw Gateway Watchdog
# 自动监控并重启异常退出的 Gateway 服务
#
# 安装: launchctl load ~/Library/LaunchAgents/ai.openclaw.watchdog.plist
# 卸载: launchctl unload ~/Library/LaunchAgents/ai.openclaw.watchdog.plist
#

# 配置
CHECK_INTERVAL=60                                    # 检查间隔（秒）
HEALTH_URL="${OPENCLAW_HEALTH_URL:-http://127.0.0.1:18789/health}"         # 健康检查 URL
LOCK_FILE="/tmp/openclaw-restart.lock"              # 重启锁文件
INSTANCE_LOCK_DIR="/tmp/openclaw-watchdog.lockdir"  # Watchdog 单实例锁目录
INSTANCE_PID_FILE="$INSTANCE_LOCK_DIR/pid"          # Watchdog 单实例 PID 文件
LOG_FILE="$HOME/.openclaw/logs/watchdog.log"        # 日志文件
MAX_LOG_SIZE=1048576                                # 日志最大 1MB
MAX_RETRY=3                                         # 连续失败多少次后触发重启

# 从 Gateway 的 LaunchAgent plist 获取启动方式：Node 发行版为 node + index.js，否则为 openclaw 二进制
GATEWAY_PLIST="$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"
OPENCLAW_FROM_PLIST=
if [[ -f "$GATEWAY_PLIST" ]]; then
    OPENCLAW_NODE=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:0" "$GATEWAY_PLIST" 2>/dev/null)
    OPENCLAW_INDEX=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:1" "$GATEWAY_PLIST" 2>/dev/null)
    OPENCLAW_PORT=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:4" "$GATEWAY_PLIST" 2>/dev/null)
    if [[ -n "${OPENCLAW_NODE:-}" ]] && [[ -n "${OPENCLAW_INDEX:-}" ]]; then
        OPENCLAW_FROM_PLIST=1
        OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
    fi
fi
if [[ -z "$OPENCLAW_FROM_PLIST" ]]; then
    OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
fi

# 确保日志目录存在
mkdir -p "$(dirname "$LOG_FILE")"

# 获取文件大小（兼容 macOS 和 Linux）
file_size() {
    stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

# 获取文件修改时间戳（兼容 macOS 和 Linux）
file_mtime() {
    stat -f%m "$1" 2>/dev/null || stat -c%Y "$1" 2>/dev/null || echo 0
}

# 日志函数（带轮转）
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 检查日志大小，超过则轮转（保留最多 3 份旧日志）
    if [[ -f "$LOG_FILE" ]] && [[ $(file_size "$LOG_FILE") -gt $MAX_LOG_SIZE ]]; then
        [[ -f "${LOG_FILE}.2" ]] && mv "${LOG_FILE}.2" "${LOG_FILE}.3"
        [[ -f "${LOG_FILE}.1" ]] && mv "${LOG_FILE}.1" "${LOG_FILE}.2"
        mv "$LOG_FILE" "${LOG_FILE}.1"
    fi
    
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

# 清理锁文件
cleanup_locks() {
    rm -f "$LOCK_FILE"

    if [[ -d "$INSTANCE_LOCK_DIR" ]]; then
        if [[ -f "$INSTANCE_PID_FILE" ]]; then
            local lock_pid
            read -r lock_pid < "$INSTANCE_PID_FILE"
            if [[ "$lock_pid" == "$$" ]]; then
                rm -rf "$INSTANCE_LOCK_DIR"
            fi
        else
            rm -rf "$INSTANCE_LOCK_DIR"
        fi
    fi
}

# 获取单实例锁（防止误启动多个 watchdog）
acquire_instance_lock() {
    if mkdir "$INSTANCE_LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$INSTANCE_PID_FILE"
        return 0
    fi

    # 已存在锁，检查是否陈旧
    if [[ -f "$INSTANCE_PID_FILE" ]]; then
        local existing_pid
        read -r existing_pid < "$INSTANCE_PID_FILE"
        if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
            log "ERROR" "Another watchdog is already running (pid: $existing_pid), exiting"
            return 1
        fi
        log "WARN" "Found stale instance lock (pid: ${existing_pid:-unknown}), recreating"
    else
        log "WARN" "Found broken instance lock, recreating"
    fi

    rm -rf "$INSTANCE_LOCK_DIR"
    if mkdir "$INSTANCE_LOCK_DIR" 2>/dev/null; then
        echo "$$" > "$INSTANCE_PID_FILE"
        return 0
    fi

    log "ERROR" "Failed to acquire instance lock at $INSTANCE_LOCK_DIR"
    return 1
}

# 信号处理（防止意外终止时锁文件残留）
trap 'cleanup_locks; log "INFO" "Watchdog stopped by signal"; exit 0' SIGTERM SIGINT
trap 'cleanup_locks' EXIT

# 检查 Gateway 健康状态
check_health() {
    local response
    response=$(curl -sS -m 5 -w $'\n%{http_code}' "$HEALTH_URL" 2>/dev/null) || return 1

    local http_code
    http_code="${response##*$'\n'}"

    [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]] || return 1

    return 0
}

# 检查是否存在重启锁
check_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        # 检查锁文件是否超过 5 分钟（防止锁文件残留）
        local lock_age=$(( $(date +%s) - $(file_mtime "$LOCK_FILE") ))
        if [[ $lock_age -gt 300 ]]; then
            log "WARN" "Lock file stale (${lock_age}s), removing"
            rm -f "$LOCK_FILE"
            return 1
        fi
        return 0
    fi
    return 1
}

# 重启 Gateway
restart_gateway() {
    log "INFO" "Attempting to start/restart gateway..."

    if [[ -n "$OPENCLAW_FROM_PLIST" ]]; then
        # Node 发行版：node + index.js，与 plist 中 ProgramArguments 一致
        if [[ ! -x "${OPENCLAW_NODE:-}" ]]; then
            log "ERROR" "Node not found or not executable: $OPENCLAW_NODE"
            return 1
        fi
        if [[ ! -f "${OPENCLAW_INDEX:-}" ]]; then
            log "ERROR" "OpenClaw index not found: $OPENCLAW_INDEX"
            return 1
        fi
        local node_bin="$OPENCLAW_NODE"
        local index_js="$OPENCLAW_INDEX"
        local port="${OPENCLAW_PORT:-18789}"
        touch "$LOCK_FILE"
        local cmd_output cmd_exit
        cmd_output=$("$node_bin" "$index_js" gateway restart 2>&1)
        cmd_exit=$?
        if [[ -n "$cmd_output" ]]; then
            log "INFO" "Restart output: $cmd_output"
        fi
        if [[ $cmd_exit -ne 0 ]]; then
            log "WARN" "Restart command failed (exit: $cmd_exit), fallback to start"
            cmd_output=$("$node_bin" "$index_js" gateway start --port "$port" 2>&1)
            cmd_exit=$?
            if [[ -n "$cmd_output" ]]; then
                log "INFO" "Start output: $cmd_output"
            fi
        fi
    else
        # 独立二进制：openclaw
        if [[ ! -x "${OPENCLAW_BIN:-}" ]]; then
            log "ERROR" "Binary not found or not executable: $OPENCLAW_BIN"
            return 1
        fi
        touch "$LOCK_FILE"
        local cmd_output cmd_exit
        cmd_output=$("$OPENCLAW_BIN" gateway restart 2>&1)
        cmd_exit=$?
        if [[ -n "$cmd_output" ]]; then
            log "INFO" "Restart output: $cmd_output"
        fi
        if [[ $cmd_exit -ne 0 ]]; then
            log "WARN" "Restart command failed (exit: $cmd_exit), fallback to start"
            cmd_output=$("$OPENCLAW_BIN" gateway start 2>&1)
            cmd_exit=$?
            if [[ -n "$cmd_output" ]]; then
                log "INFO" "Start output: $cmd_output"
            fi
        fi
    fi

    # 注意：此处不使用命令返回值判断是否成功，因为 start/restart
    # 通常立即返回 0，不能反映服务是否真正就绪
    # 等待服务启动（最多等 30 秒，每 5 秒探测一次，共探测 6 次）
    local attempts=0
    while [[ $attempts -lt 6 ]]; do
        sleep 5
        attempts=$((attempts + 1))
        if check_health; then
            rm -f "$LOCK_FILE"
            return 0
        fi
    done
    
    # 删除锁文件
    rm -f "$LOCK_FILE"
    
    return 1
}

# 主循环
main() {
    if ! acquire_instance_lock; then
        exit 1
    fi

    log "INFO" "Watchdog started (interval: ${CHECK_INTERVAL}s)"
    
    local consecutive_failures=0
    local last_healthy_log=$(date +%s)
    
    while true; do
        sleep "$CHECK_INTERVAL"
        
        # 检查锁文件
        if check_lock; then
            log "INFO" "Lock file present, skipping check"
            continue
        fi
        
        # 健康检查
        if check_health; then
            # 健康 - 每小时记录一次
            local now=$(date +%s)
            if [[ $((now - last_healthy_log)) -ge 3600 ]]; then
                log "OK" "Gateway healthy"
                last_healthy_log=$now
            fi
            consecutive_failures=0
        else
            # 不健康 - 尝试重启
            consecutive_failures=$((consecutive_failures + 1))
            log "WARN" "Gateway unhealthy (failure $consecutive_failures/$MAX_RETRY)"
            
            if [[ $consecutive_failures -ge $MAX_RETRY ]]; then
                log "ERROR" "Gateway unreachable after $consecutive_failures checks, attempting restart..."
                
                if restart_gateway; then
                    log "OK" "Gateway restart successful"
                    consecutive_failures=0
                else
                    log "ERROR" "Gateway restart FAILED, cooling down for 300s"
                    # 重置失败计数，避免冷却后立即再次触发重启，让其重新积累失败次数
                    consecutive_failures=0
                    # 失败后等待更长时间再试（使用 wait $! 以便能及时响应 SIGTERM）
                    sleep 300 &
                    wait $!
                fi
            fi
        fi
    done
}

# 运行
main