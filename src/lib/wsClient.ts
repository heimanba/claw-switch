/**
 * WebSocket 客户端 - 直连 OpenClaw Gateway
 *
 * 协议流程（Ed25519 签名认证）：
 * 1. 连接 ws://host/ws?token=xxx
 * 2. Gateway 发 connect.challenge（带 nonce）
 * 3. 客户端调用 Tauri 后端生成 Ed25519 签名的 connect frame
 * 4. Gateway 返回 connect 响应（带 snapshot）
 * 5. 从 snapshot.sessionDefaults.mainSessionKey 获取 sessionKey
 */
import { invoke } from '@tauri-apps/api/core'

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const REQUEST_TIMEOUT = 30000
const MAX_RECONNECT_DELAY = 30000
const PING_INTERVAL = 25000
const CHALLENGE_TIMEOUT = 5000

type StatusType =
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'auth_failed'

type StatusCallback = (status: StatusType, errorMsg?: string) => void
type ReadyCallback = (
  hello: unknown,
  sessionKey: string,
  err?: { error: true; message: string }
) => void
type EventCallback = (msg: { event: string; payload: unknown }) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WsClient {
  private _ws: WebSocket | null = null
  private _url = ''
  private _token = ''
  private _pending = new Map<string, PendingRequest>()
  private _eventListeners: EventCallback[] = []
  private _statusListeners: StatusCallback[] = []
  private _readyCallbacks: ReadyCallback[] = []
  private _reconnectAttempts = 0
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private _gatewayReady = false
  private _handshaking = false
  private _intentionalClose = false
  private _snapshot: unknown = null
  private _hello: unknown = null
  private _sessionKey: string | null = null
  private _pingTimer: ReturnType<typeof setInterval> | null = null
  private _challengeTimer: ReturnType<typeof setTimeout> | null = null
  private _wsId = 0
  private _autoPairAttempts = 0

  get connected() { return this._connected }
  get gatewayReady() { return this._gatewayReady }
  get snapshot() { return this._snapshot }
  get hello() { return this._hello }
  get sessionKey() { return this._sessionKey }

  onStatusChange(fn: StatusCallback): () => void {
    this._statusListeners.push(fn)
    return () => {
      this._statusListeners = this._statusListeners.filter((cb) => cb !== fn)
    }
  }

  onReady(fn: ReadyCallback): () => void {
    this._readyCallbacks.push(fn)
    return () => {
      this._readyCallbacks = this._readyCallbacks.filter((cb) => cb !== fn)
    }
  }

  onEvent(callback: EventCallback): () => void {
    this._eventListeners.push(callback)
    return () => {
      this._eventListeners = this._eventListeners.filter((fn) => fn !== callback)
    }
  }

  connect(host: string, token: string): void {
    this._intentionalClose = false
    this._autoPairAttempts = 0
    this._token = token || ''
    this._url = `ws://${host}/ws?token=${encodeURIComponent(this._token)}`
    this._doConnect()
  }

  disconnect(): void {
    this._intentionalClose = true
    this._stopPing()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._flushPending()
    this._closeWs()
    this._setConnected(false)
    this._gatewayReady = false
    this._handshaking = false
  }

  reconnect(): void {
    if (!this._url) return
    this._intentionalClose = false
    this._reconnectAttempts = 0
    this._autoPairAttempts = 0
    this._stopPing()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._flushPending()
    this._closeWs()
    this._doConnect()
  }

  private _doConnect(): void {
    this._closeWs()
    this._gatewayReady = false
    this._handshaking = false
    this._setConnected(false, 'connecting')
    const wsId = ++this._wsId
    let ws: WebSocket
    try {
      ws = new WebSocket(this._url)
    } catch {
      this._scheduleReconnect()
      return
    }
    this._ws = ws

    ws.onopen = () => {
      if (wsId !== this._wsId) return
      this._reconnectAttempts = 0
      this._setConnected(true)
      this._startPing()
      // 等 Gateway 发 connect.challenge，超时则主动发
      this._challengeTimer = setTimeout(() => {
        if (!this._handshaking && !this._gatewayReady) {
          console.log('[ws] 未收到 challenge，主动发 connect')
          this._sendConnectFrame('')
        }
      }, CHALLENGE_TIMEOUT)
    }

    ws.onmessage = (evt: MessageEvent) => {
      if (wsId !== this._wsId) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(evt.data as string)
      } catch {
        return
      }
      this._handleMessage(msg)
    }

    ws.onclose = (e: CloseEvent) => {
      if (wsId !== this._wsId) return
      this._ws = null
      this._clearChallengeTimer()
      if (e.code === 4001) {
        this._setConnected(false, 'auth_failed', 'Token 认证失败')
        this._intentionalClose = true
        this._flushPending()
        return
      }
      if (e.code === 1008 && !this._intentionalClose) {
        if (this._autoPairAttempts < 1) {
          console.log('[ws] origin not allowed (1008)，尝试自动修复...')
          this._setConnected(false, 'reconnecting', 'origin not allowed，修复中...')
          this._autoPairAndReconnect()
          return
        }
        console.warn('[ws] origin 1008 自动修复已尝试过，显示错误')
        this._setConnected(false, 'error', e.reason || 'origin not allowed，请重新配置')
        return
      }
      this._setConnected(false)
      this._gatewayReady = false
      this._handshaking = false
      this._stopPing()
      this._flushPending()
      if (!this._intentionalClose) this._scheduleReconnect()
    }

    ws.onerror = () => {}
  }

  private _handleMessage(msg: Record<string, unknown>): void {
    // 握手阶段：connect.challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('[ws] 收到 connect.challenge')
      this._clearChallengeTimer()
      const payload = msg.payload as Record<string, unknown> | null
      const nonce = (payload?.nonce as string) || ''
      this._sendConnectFrame(nonce)
      return
    }

    // 握手响应
    if (msg.type === 'res' && typeof msg.id === 'string' && msg.id.startsWith('connect-')) {
      this._clearChallengeTimer()
      this._handshaking = false
      if (!msg.ok || msg.error) {
        const error = msg.error as Record<string, unknown> | null
        const errCode = (error?.code as string) || ''
        const errMsg = (error?.message as string) || 'Gateway 握手失败'
        console.error('[ws] connect 失败:', errCode, errMsg)

        // 设备未配对时自动配对并重连（仅尝试一次）
        if (
          (errCode === 'pairing_required' ||
            errCode === 'not_paired' ||
            errCode === 'device_not_found') &&
          this._autoPairAttempts < 1
        ) {
          console.log('[ws] 设备未配对，尝试自动配对...')
          this._setConnected(false, 'reconnecting', '设备未配对，正在自动配对...')
          this._autoPairAndReconnect()
          return
        }

        this._setConnected(false, 'error', errMsg)
        this._readyCallbacks.forEach((fn) => {
          try {
            fn(null, '', { error: true, message: errMsg })
          } catch {}
        })
        return
      }
      this._handleConnectSuccess(msg.payload)
      return
    }

    // RPC 响应
    if (msg.type === 'res') {
      const id = msg.id as string
      const cb = this._pending.get(id)
      if (cb) {
        this._pending.delete(id)
        clearTimeout(cb.timer)
        if (msg.ok) {
          cb.resolve(msg.payload)
        } else {
          const error = msg.error as Record<string, unknown> | null
          cb.reject(
            new Error((error?.message as string) || (error?.code as string) || 'request failed')
          )
        }
      }
      return
    }

    // 事件转发
    if (msg.type === 'event') {
      this._eventListeners.forEach((fn) => {
        try {
          fn(msg as unknown as { event: string; payload: unknown })
        } catch (e) {
          console.error('[ws] handler error:', e)
        }
      })
    }
  }

  private async _sendConnectFrame(nonce: string): Promise<void> {
    this._handshaking = true
    try {
      // 调用 Tauri 后端生成 Ed25519 签名的 connect frame
      const frame = await invoke<Record<string, unknown>>('create_connect_frame', {
        nonce,
        gatewayToken: this._token,
      })
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        console.log('[ws] 发送 connect frame (Ed25519 签名)')
        this._ws.send(JSON.stringify(frame))
      }
    } catch (e) {
      console.error('[ws] 生成 connect frame 失败:', e)
      this._handshaking = false
    }
  }

  private async _autoPairAndReconnect(): Promise<void> {
    this._autoPairAttempts++
    try {
      console.log('[ws] 执行自动配对（第', this._autoPairAttempts, '次）...')
      const result = await invoke<string>('auto_pair_device')
      console.log('[ws] 配对结果:', result)

      // 配对后需要 reload Gateway 使 allowedOrigins 生效
      try {
        await invoke('reload_openclaw_gateway')
        console.log('[ws] Gateway 已重载')
      } catch (e) {
        console.warn('[ws] reloadGateway 失败（非致命）:', e)
      }

      console.log('[ws] 配对成功，2秒后重新连接...')
      setTimeout(() => {
        if (!this._intentionalClose) {
          this.reconnect()
        }
      }, 2000)
    } catch (e) {
      console.error('[ws] 自动配对失败:', e)
      this._setConnected(false, 'error', `配对失败: ${e}`)
    }
  }

  private _handleConnectSuccess(payload: unknown): void {
    this._hello = payload || null
    const p = payload as Record<string, unknown> | null
    this._snapshot = p?.snapshot || null
    const snap = this._snapshot as Record<string, unknown> | null
    const defaults = snap?.sessionDefaults as Record<string, unknown> | null
    if (defaults?.mainSessionKey) {
      this._sessionKey = defaults.mainSessionKey as string
    } else {
      const agentId = (defaults?.defaultAgentId as string) || 'main'
      this._sessionKey = `agent:${agentId}:main`
    }
    this._gatewayReady = true
    console.log('[ws] Gateway 就绪, sessionKey:', this._sessionKey)
    this._setConnected(true, 'ready')
    this._readyCallbacks.forEach((fn) => {
      try {
        fn(this._hello, this._sessionKey!)
      } catch (e) {
        console.error('[ws] ready cb error:', e)
      }
    })
  }

  private _setConnected(val: boolean, status?: string, errorMsg?: string): void {
    this._connected = val
    const s = (status || (val ? 'connected' : 'disconnected')) as StatusType
    this._statusListeners.forEach((fn) => {
      try {
        fn(s, errorMsg)
      } catch (e) {
        console.error('[ws] status listener error:', e)
      }
    })
  }

  private _closeWs(): void {
    if (this._ws) {
      const old = this._ws
      this._ws = null
      this._wsId++
      try {
        old.close()
      } catch {}
    }
  }

  private _flushPending(): void {
    for (const [, cb] of this._pending) {
      clearTimeout(cb.timer)
      cb.reject(new Error('连接已断开'))
    }
    this._pending.clear()
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  private _clearChallengeTimer(): void {
    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer)
      this._challengeTimer = null
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnectTimer()
    const delay =
      this._reconnectAttempts < 3
        ? 1000
        : Math.min(1000 * Math.pow(2, this._reconnectAttempts - 2), MAX_RECONNECT_DELAY)
    this._reconnectAttempts++
    this._setConnected(false, 'reconnecting')
    this._reconnectTimer = setTimeout(() => this._doConnect(), delay)
  }

  private _startPing(): void {
    this._stopPing()
    this._pingTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try {
          this._ws.send('{"type":"ping"}')
        } catch {}
      }
    }, PING_INTERVAL)
  }

  private _stopPing(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._gatewayReady) {
        if (!this._intentionalClose && (this._reconnectAttempts > 0 || !this._gatewayReady)) {
          const waitTimeout = setTimeout(
            () => {
              unsub()
              reject(new Error('等待重连超时'))
            },
            15000
          )
          const unsub = this.onReady((_hello, _sessionKey, err) => {
            clearTimeout(waitTimeout)
            unsub()
            if (err?.error) {
              reject(new Error(err.message || 'Gateway 握手失败'))
              return
            }
            this.request(method, params).then(resolve, reject)
          })
          return
        }
        return reject(new Error('WebSocket 未连接'))
      }
      const id = uuid()
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error('请求超时'))
      }, REQUEST_TIMEOUT)
      this._pending.set(id, { resolve, reject, timer })
      this._ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  chatSend(
    sessionKey: string,
    message: string,
    attachments?: Array<{ type: string; mimeType: string; fileName: string; content: string }>
  ): Promise<unknown> {
    const params: Record<string, unknown> = {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: uuid(),
    }
    if (attachments && attachments.length > 0) {
      params.attachments = attachments
    }
    return this.request('chat.send', params)
  }

  chatHistory(sessionKey: string, limit = 200): Promise<unknown> {
    return this.request('chat.history', { sessionKey, limit })
  }

  chatAbort(sessionKey: string, runId?: string): Promise<unknown> {
    const params: Record<string, unknown> = { sessionKey }
    if (runId) params.runId = runId
    return this.request('chat.abort', params)
  }

  sessionsList(limit = 50): Promise<unknown> {
    return this.request('sessions.list', { limit })
  }

  sessionsDelete(key: string): Promise<unknown> {
    return this.request('sessions.delete', { key })
  }

  sessionsReset(key: string): Promise<unknown> {
    return this.request('sessions.reset', { key })
  }
}

// 全局单例
export const wsClient = new WsClient()
