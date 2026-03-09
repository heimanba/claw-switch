/**
 * 聊天页面 - 对接 OpenClaw Gateway
 * 支持：流式响应、Markdown 渲染、会话管理、快捷指令
 */
import { useEffect, useRef, useState, useCallback, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { wsClient, uuid } from '@/lib/wsClient'
import { cn } from '@/lib/utils'
import { openclawApi } from '@/lib/api/openclaw'
import { extractErrorMessage } from '@/utils/errorUtils'
import type { OpenClawGatewayConfig } from '@/types'

const RENDER_THROTTLE = 30
const STORAGE_SESSION_KEY = 'cc-switch-last-session'

// ── 快捷指令 ──
const COMMANDS = [
  {
    title: '会话',
    commands: [
      { cmd: '/new', desc: '新建会话', action: 'exec' as const },
      { cmd: '/reset', desc: '重置当前会话', action: 'exec' as const },
      { cmd: '/stop', desc: '停止生成', action: 'exec' as const },
    ],
  },
  {
    title: '模型',
    commands: [
      { cmd: '/model ', desc: '切换模型（输入模型名）', action: 'fill' as const },
      { cmd: '/model list', desc: '查看可用模型', action: 'exec' as const },
    ],
  },
  {
    title: '信息',
    commands: [
      { cmd: '/help', desc: '帮助信息', action: 'exec' as const },
      { cmd: '/status', desc: '系统状态', action: 'exec' as const },
    ],
  },
]

// ── Markdown 渲染 ──
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function inlineFormat(text: string): string {
  // 先 escape 特殊 HTML 字符，再做 Markdown 转换，防止原始文本中的 <> 破坏 DOM
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:300px" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = /^https?:|^mailto:/i.test(url.trim()) ? url : '#'
      return `<a href="${safe}" target="_blank" rel="noopener">${label}</a>`
    })
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  let html = text

  // 代码块（加 copy 按钮）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const langLabel = lang ? `<span class="chat-code-lang">${escapeHtml(lang)}</span>` : ''
    const escapedCode = escapeHtml(code.trimEnd())
    const copyBtn = `<button class="chat-code-copy" onclick="(function(btn){var code=btn.closest('pre').querySelector('code');navigator.clipboard.writeText(code.innerText).then(function(){btn.classList.add('copied');btn.textContent='已复制';setTimeout(function(){btn.classList.remove('copied');btn.textContent='复制';},1500)});})(this)">复制</button>`
    return `<pre data-lang="${escapeHtml(lang)}">${langLabel}${copyBtn}<code>${escapedCode}</code></pre>`
  })

  // 行内代码
  html = html.replace(/`([^`\n]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)

  const lines = html.split('\n')
  const result: string[] = []
  let inList = false
  let listType = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('<pre')) {
      result.push(line)
      while (i < lines.length - 1 && !lines[i].includes('</pre>')) {
        i++
        result.push(lines[i])
      }
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      if (inList) { result.push(`</${listType}>`); inList = false }
      const level = headingMatch[1].length
      result.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`)
      continue
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/)
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ul>'); inList = true; listType = 'ul'
      }
      result.push(`<li>${inlineFormat(ulMatch[1])}</li>`)
      continue
    }

    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push(`</${listType}>`)
        result.push('<ol>'); inList = true; listType = 'ol'
      }
      result.push(`<li>${inlineFormat(olMatch[1])}</li>`)
      continue
    }

    if (inList) { result.push(`</${listType}>`); inList = false }
    if (line.trim() === '') { result.push(''); continue }
    // 所有普通文本行都走 inlineFormat（内部已 escape），不直接透传 HTML
    result.push(`<p>${inlineFormat(line)}</p>`)
  }

  if (inList) result.push(`</${listType}>`)
  return result.join('\n')
}

/** 安全渲染：捕获 renderMarkdown 异常，降级为转义后的纯文本 */
function safeRenderMarkdown(text: string): string {
  try {
    const html = renderMarkdown(text)
    return html
  } catch {
    // 渲染出错时，将整段文字 escape 后用 <pre> 包裹显示
    return `<pre style="white-space:pre-wrap;word-break:break-word">${escapeHtml(text)}</pre>`
  }
}

// ── Error Boundary：防止气泡渲染崩溃导致整个聊天页白屏 ──
interface BubbleErrorBoundaryState { hasError: boolean }
class BubbleErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, BubbleErrorBoundaryState> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): BubbleErrorBoundaryState {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ChatPage] 气泡渲染错误:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="chat-bubble" style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          内容渲染失败，请重试
        </div>
      )
    }
    return this.props.children
  }
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    // 处理未闭合的 <think> / <thinking> 标签（去掉标签及之后所有内容）
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*/gi, '')
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .trim()
}

function formatTime(date: Date): string {
  const now = new Date()
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return `${h}:${m}`
  const mon = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${mon}-${day} ${h}:${m}`
}

function parseSessionLabel(key: string): string {
  const parts = (key || '').split(':')
  if (parts.length < 3) return key || '未知'
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return '主会话'
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

// ── 内容提取 ──
interface ContentBlock {
  type?: string
  text?: string
  data?: string
  mimeType?: string
  url?: string
  source?: { type?: string; data?: string; media_type?: string; url?: string }
  omitted?: boolean
  image_url?: { url: string }
  mediaType?: string
}

interface ExtractedContent {
  text: string
  images: ImageItem[]
}

interface ImageItem {
  data?: string
  mediaType?: string
  url?: string
  source?: { data: string; media_type?: string }
  image_url?: { url: string }
}

type ChatMessage = Record<string, unknown>

function extractContent(msg: ChatMessage): ExtractedContent {
  const content = msg.content
  if (typeof content === 'string') return { text: stripThinkingTags(content), images: [] }
  if (Array.isArray(content)) {
    const texts: string[] = []
    const images: ImageItem[] = []
    for (const block of content as ContentBlock[]) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && !block.omitted) {
        if (block.data) images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data)
          images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url)
          images.push({ url: block.url || block.source?.url, mediaType: block.mimeType || 'image/png' })
      } else if (block.type === 'image_url' && block.image_url?.url) {
        images.push({ url: block.image_url.url, mediaType: 'image/png' })
      }
    }
    const text = texts.length ? stripThinkingTags(texts.join('\n')) : ''
    return { text, images }
  }
  const textStr =
    typeof msg.text === 'string'
      ? msg.text
      : typeof msg.content === 'string'
        ? (msg.content as string)
        : ''
  return { text: stripThinkingTags(textStr), images: [] }
}

// ── 消息类型定义 ──
interface MessageItem {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  images?: ImageItem[]
  time: Date
  durationMs?: number
  tokenUsage?: { input: number; output: number }
}

interface SessionItem {
  sessionKey: string
  updatedAt?: number
  lastActivity?: number
}

// ── 主组件 ──
export function ChatPage() {
  const { t: _t } = useTranslation()
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [sessionKey, setSessionKey] = useState<string>(() => localStorage.getItem(STORAGE_SESSION_KEY) || '')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'ready' | 'error' | 'reconnecting' | 'disconnected'>('connecting')
  const [showSidebar, setShowSidebar] = useState(false)
  const [showCmdPanel, setShowCmdPanel] = useState(false)
  const [showDisconnectBar, setShowDisconnectBar] = useState(false)
  const [gatewayStarting, setGatewayStarting] = useState(false)
  const [attachments, setAttachments] = useState<Array<{ type: string; mimeType: string; fileName: string; content: string }>>([])
  const [hasEverConnected, setHasEverConnected] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 流式状态 ref（避免 stale closure）
  const streamingBubbleRef = useRef<HTMLDivElement | null>(null)
  const currentAiTextRef = useRef('')
  const currentAiImagesRef = useRef<ImageItem[]>([])
  const currentRunIdRef = useRef<string | null>(null)
  const streamStartTimeRef = useRef(0)
  const streamSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastRenderTimeRef = useRef(0)
  const renderPendingRef = useRef(false)
  const messageQueueRef = useRef<Array<{ text: string; attachments: typeof attachments }>>([])
  const isStreamingRef = useRef(false)
  const isSendingRef = useRef(false)
  const sessionKeyRef = useRef(sessionKey)
  const lastErrorMsgRef = useRef<string | null>(null)
  const errorTimerRef = useRef<number | null>(null)
  const lastHistoryHashRef = useRef('')
  const pageActiveRef = useRef(true)

  useEffect(() => { sessionKeyRef.current = sessionKey }, [sessionKey])
  useEffect(() => { isStreamingRef.current = isStreaming }, [isStreaming])
  useEffect(() => { isSendingRef.current = isSending }, [isSending])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  const appendSystemMsg = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: uuid(), role: 'system', text, time: new Date() },
    ])
    setTimeout(scrollToBottom, 50)
  }, [scrollToBottom])

  const resetStreamState = useCallback(() => {
    if (streamSafetyTimerRef.current) {
      clearTimeout(streamSafetyTimerRef.current)
      streamSafetyTimerRef.current = null
    }
    // finalize streaming bubble
    if (streamingBubbleRef.current && currentAiTextRef.current) {
      streamingBubbleRef.current.innerHTML = safeRenderMarkdown(currentAiTextRef.current)
    }
    renderPendingRef.current = false
    lastRenderTimeRef.current = 0
    streamingBubbleRef.current = null
    currentAiTextRef.current = ''
    currentAiImagesRef.current = []
    currentRunIdRef.current = null
    isStreamingRef.current = false
    streamStartTimeRef.current = 0
    lastErrorMsgRef.current = null
    errorTimerRef.current = null
    setIsStreaming(false)
  }, [])

  const processMessageQueue = useCallback(() => {
    if (messageQueueRef.current.length === 0 || isSendingRef.current || isStreamingRef.current) return
    const msg = messageQueueRef.current.shift()
    if (msg) {
      doSend(msg.text, msg.attachments)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 事件处理 ──
  const handleChatEvent = useCallback((payload: Record<string, unknown>) => {
    const sk = sessionKeyRef.current
    if (payload.sessionKey && payload.sessionKey !== sk && sk) return

    const state = payload.state as string

    if (state === 'delta') {
      const msgObj = payload.message as ChatMessage | null
      const c = msgObj ? extractContent(msgObj) : null
      if (c?.images?.length) currentAiImagesRef.current = c.images

      const newText = (c?.text || '') as string
      if (newText && newText.length > currentAiTextRef.current.length) {
        currentAiTextRef.current = newText

        if (!streamingBubbleRef.current) {
          currentRunIdRef.current = payload.runId as string || null
          isStreamingRef.current = true
          streamStartTimeRef.current = Date.now()
          setIsStreaming(true)

          // 创建流式气泡并追加到 messages
          const msgId = uuid()
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: 'assistant',
              text: '',
              time: new Date(),
              _streaming: true,
              _streamId: msgId,
            } as MessageItem & { _streaming: boolean; _streamId: string },
          ])
          setTimeout(scrollToBottom, 50)

          // 通过 ref 找到对应 DOM 气泡元素（延迟查找）
          setTimeout(() => {
            const el = document.querySelector(`[data-stream-id="${msgId}"] .chat-bubble`) as HTMLDivElement | null
            if (el) streamingBubbleRef.current = el
          }, 30)
        }

        // 安全超时
        if (streamSafetyTimerRef.current) clearTimeout(streamSafetyTimerRef.current)
        streamSafetyTimerRef.current = setTimeout(() => {
          if (isStreamingRef.current) {
            console.warn('[chat] 流式超时，强制结束')
            appendSystemMsg('输出超时，已自动结束')
            resetStreamState()
            processMessageQueue()
          }
        }, 90000)

        // 节流渲染
        const now = performance.now()
        if (!renderPendingRef.current) {
          if (now - lastRenderTimeRef.current >= RENDER_THROTTLE) {
            lastRenderTimeRef.current = now
            if (streamingBubbleRef.current) {
              streamingBubbleRef.current.innerHTML = safeRenderMarkdown(currentAiTextRef.current)
              scrollToBottom()
            }
          } else {
            renderPendingRef.current = true
            requestAnimationFrame(() => {
              renderPendingRef.current = false
              lastRenderTimeRef.current = performance.now()
              if (streamingBubbleRef.current) {
                streamingBubbleRef.current.innerHTML = safeRenderMarkdown(currentAiTextRef.current)
                scrollToBottom()
              }
            })
          }
        }
      }
      return
    }

    if (state === 'final') {
      const msgObj = payload.message as ChatMessage | null
      const c = msgObj ? extractContent(msgObj) : null
      // 优先用 final message 中的文本，fallback 到流式累积文本
      const finalText = (c?.text || '') || currentAiTextRef.current || ''
      const finalImages = c?.images?.length ? c.images : currentAiImagesRef.current

      if (!streamingBubbleRef.current && !finalText && !finalImages.length) return

      const durationMs = (payload.durationMs as number) || (streamStartTimeRef.current ? Date.now() - streamStartTimeRef.current : 0)
      const usageRaw = payload.usage as Record<string, number> | null
      const tokenUsage = usageRaw
        ? {
            input: usageRaw.input_tokens || usageRaw.prompt_tokens || 0,
            output: usageRaw.output_tokens || usageRaw.completion_tokens || 0,
          }
        : undefined

      // 先渲染 DOM，再更新 React 状态，避免 React 接管 DOM 时清空内容
      if (streamingBubbleRef.current) {
        streamingBubbleRef.current.innerHTML = safeRenderMarkdown(finalText)
      }

      // 更新最后一条 assistant 消息为最终内容
      setMessages((prev) => {
        const last = [...prev]
        for (let i = last.length - 1; i >= 0; i--) {
          if (last[i].role === 'assistant') {
            // 如果 finalText 为空，保留已有的 text（防止覆盖为空）
            const resolvedText = finalText || last[i].text || ''
            last[i] = {
              ...last[i],
              text: resolvedText,
              images: finalImages.length ? finalImages : undefined,
              durationMs,
              tokenUsage,
              _streaming: false,
            } as MessageItem & { _streaming: boolean }
            break
          }
        }
        return last
      })

      resetStreamState()
      setTimeout(scrollToBottom, 50)
      processMessageQueue()
      return
    }

    if (state === 'aborted') {
      if (streamingBubbleRef.current && currentAiTextRef.current) {
        streamingBubbleRef.current.innerHTML = safeRenderMarkdown(currentAiTextRef.current)
      }
      appendSystemMsg('生成已停止')
      resetStreamState()
      processMessageQueue()
      return
    }

    if (state === 'error') {
      const errMsg = (payload.errorMessage as string) || (payload.error as Record<string, string>)?.message || '未知错误'
      if (/origin not allowed|NOT_PAIRED|PAIRING_REQUIRED|auth.*fail/i.test(errMsg)) {
        return
      }
      const now = Date.now()
      if (lastErrorMsgRef.current === errMsg && errorTimerRef.current && (now - errorTimerRef.current < 2000)) return
      lastErrorMsgRef.current = errMsg
      errorTimerRef.current = now

      if (isStreamingRef.current || streamingBubbleRef.current) return

      appendSystemMsg('错误: ' + errMsg)
      resetStreamState()
      processMessageQueue()
      return
    }
  }, [appendSystemMsg, resetStreamState, processMessageQueue, scrollToBottom])

  // ── 历史记录 ──
  const loadHistory = useCallback(async (sk: string) => {
    if (!sk || !wsClient.gatewayReady) return
    try {
      const result = await wsClient.chatHistory(sk, 200) as { messages?: ChatMessage[] } | null
      if (!result?.messages?.length) {
        setMessages((prev) => {
          if (prev.length === 0) {
            return [{ id: uuid(), role: 'system', text: '还没有消息，开始聊天吧', time: new Date() }]
          }
          return prev
        })
        return
      }

      const deduped: Array<{ role: string; text: string; images: ImageItem[]; timestamp?: number }> = []
      for (const msg of result.messages) {
        if (msg.role === 'toolResult') continue
        const c = extractContent(msg)
        if (!c.text && !c.images.length) continue
        const last = deduped[deduped.length - 1]
        if (last && last.role === msg.role) {
          if (msg.role === 'user' && last.text === c.text) continue
          if (msg.role === 'assistant') {
            if (c.text && last.text === c.text) continue
            last.text = [last.text, c.text].filter(Boolean).join('\n')
            last.images = [...(last.images || []), ...c.images]
            continue
          }
        }
        deduped.push({ role: msg.role as string, text: c.text, images: c.images, timestamp: msg.timestamp as number })
      }

      const hash = deduped.map((m) => `${m.role}:${m.text.length}`).join('|')
      if (hash === lastHistoryHashRef.current) return
      lastHistoryHashRef.current = hash

      const newMessages: MessageItem[] = deduped
        .filter((m) => m.text || m.images?.length)
        .map((m) => ({
          id: uuid(),
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          text: m.text,
          images: m.images?.length ? m.images : undefined,
          time: m.timestamp ? new Date(m.timestamp) : new Date(),
        }))

      setMessages(newMessages)
      setTimeout(scrollToBottom, 100)
    } catch (e) {
      console.error('[chat] loadHistory error:', e)
    }
  }, [scrollToBottom])

  // ── 会话列表 ──
  const refreshSessionList = useCallback(async () => {
    if (!wsClient.gatewayReady) return
    try {
      const result = await wsClient.sessionsList(50) as { sessions?: unknown[] } | unknown[] | null
      const rawList = (result as { sessions?: unknown[] })?.sessions || (result as unknown[]) || []
      // 兼容不同字段名：sessionKey / key
      const list: SessionItem[] = rawList.map((s) => {
        const obj = s as Record<string, unknown>
        const sk = (obj.sessionKey || obj.key || '') as string
        return {
          sessionKey: sk,
          updatedAt: obj.updatedAt as number | undefined,
          lastActivity: obj.lastActivity as number | undefined,
        }
      }).filter((s) => s.sessionKey)
      setSessions(list)
    } catch (e) {
      console.error('[chat] refreshSessionList error:', e)
    }
  }, [])

  // ── Gateway 连接 ──
  const connectGateway = useCallback(async () => {
    try {
      if (wsClient.connected && wsClient.gatewayReady) {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY)
        const sk = saved || wsClient.sessionKey || ''
        setSessionKey(sk)
        sessionKeyRef.current = sk
        setWsStatus('ready')
        setShowDisconnectBar(false)
        setHasEverConnected(true)
        await loadHistory(sk)
        await refreshSessionList()
        return
      }

      if (wsClient.connected) return

      const config = await invoke<OpenClawGatewayConfig>('get_openclaw_gateway')
      const port = config?.port || 18789
      const token = config?.auth?.token || ''
      wsClient.connect(`127.0.0.1:${port}`, token)
    } catch (e) {
      console.error('[chat] connectGateway error:', e)
    }
  }, [loadHistory, refreshSessionList])

  const handleStartGateway = useCallback(async () => {
    if (gatewayStarting) return
    setGatewayStarting(true)
    try {
      const detail = await openclawApi.getServiceDetail()
      if (detail.gateway_installed === false) {
        await openclawApi.installGateway()
      }
      await openclawApi.startService()
      toast.success(_t('openclaw.testing.gatewayStarted', { defaultValue: '网关服务已启动' }))
      setTimeout(() => wsClient.reconnect(), 800)
    } catch (e) {
      toast.error(_t('openclaw.testing.gatewayStartFailed', { defaultValue: '启动网关失败' }), {
        description: extractErrorMessage(e) || undefined,
      })
    } finally {
      setGatewayStarting(false)
    }
  }, [gatewayStarting, _t])

  // ── 初始化 ──
  useEffect(() => {
    pageActiveRef.current = true

    const unsubStatus = wsClient.onStatusChange((status, errorMsg) => {
      if (!pageActiveRef.current) return
      setWsStatus(status as typeof wsStatus)
      if (status === 'ready' || status === 'connected') {
        setHasEverConnected(true)
        setShowDisconnectBar(false)
      } else if (status === 'error') {
        setShowDisconnectBar(false)
      } else if (status === 'reconnecting' || status === 'disconnected') {
        setShowDisconnectBar(hasEverConnected)
      }
    })

    const unsubReady = wsClient.onReady((_hello, sk, err) => {
      if (!pageActiveRef.current) return
      if (err?.error) return
      setHasEverConnected(true)
      if (!sessionKeyRef.current) {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY)
        const newSk = saved || sk || ''
        setSessionKey(newSk)
        sessionKeyRef.current = newSk
        lastHistoryHashRef.current = ''
        loadHistory(newSk)
      }
      refreshSessionList()
    })

    const unsubEvent = wsClient.onEvent((msg) => {
      if (!pageActiveRef.current) return
      if (msg.event === 'chat') {
        handleChatEvent(msg.payload as Record<string, unknown>)
      }
    })

    connectGateway()

    return () => {
      pageActiveRef.current = false
      unsubStatus()
      unsubReady()
      unsubEvent()
      resetStreamState()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 发送消息 ──
  async function doSend(text: string, atts: typeof attachments = []) {
    const sk = sessionKeyRef.current
    const userMsg: MessageItem = {
      id: uuid(),
      role: 'user',
      text,
      images: atts.length
        ? atts.map((a) => ({ data: a.content, mediaType: a.mimeType }))
        : undefined,
      time: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setTimeout(scrollToBottom, 50)

    isSendingRef.current = true
    setIsSending(true)
    try {
      await wsClient.chatSend(sk, text, atts.length ? atts : undefined)
    } catch (err) {
      appendSystemMsg('发送失败: ' + (err as Error).message)
    } finally {
      isSendingRef.current = false
      setIsSending(false)
    }
  }

  const sendMessage = () => {
    const text = inputValue.trim()
    if (!text && !attachments.length) return
    setShowCmdPanel(false)
    setInputValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    const atts = [...attachments]
    setAttachments([])

    if (isSendingRef.current || isStreamingRef.current) {
      messageQueueRef.current.push({ text, attachments: atts })
      return
    }
    doSend(text, atts)
  }

  const stopGeneration = () => {
    if (currentRunIdRef.current) {
      wsClient.chatAbort(sessionKeyRef.current, currentRunIdRef.current).catch(() => {})
    }
  }

  // ── 切换会话 ──
  const switchSession = (newKey: string) => {
    if (newKey === sessionKeyRef.current) return
    setSessionKey(newKey)
    sessionKeyRef.current = newKey
    localStorage.setItem(STORAGE_SESSION_KEY, newKey)
    lastHistoryHashRef.current = ''
    resetStreamState()
    setMessages([])
    loadHistory(newKey)
    refreshSessionList()
  }

  const resetCurrentSession = async () => {
    const sk = sessionKeyRef.current
    if (!sk) return
    try {
      await wsClient.sessionsReset(sk)
      setMessages([])
      lastHistoryHashRef.current = ''
      appendSystemMsg('会话已重置')
    } catch (e) {
      appendSystemMsg('重置失败: ' + (e as Error).message)
    }
  }

  const deleteSession = async (key: string) => {
    const snapshot = wsClient.snapshot as Record<string, unknown> | null
    const defaults = snapshot?.sessionDefaults as Record<string, unknown> | null
    const mainKey = (defaults?.mainSessionKey as string) || 'agent:main:main'
    if (key === mainKey) return
    try {
      await wsClient.sessionsDelete(key)
      if (key === sessionKeyRef.current) switchSession(mainKey)
      else refreshSessionList()
    } catch (e) {
      appendSystemMsg('删除失败: ' + (e as Error).message)
    }
  }

  // ── 文件上传 ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > 5 * 1024 * 1024) continue
      try {
        const base64 = await fileToBase64(file)
        setAttachments((prev) => [
          ...prev,
          { type: 'image', mimeType: file.type, fileName: file.name, content: base64 },
        ])
      } catch {}
    }
    e.target.value = ''
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (!imageItems.length) return
    e.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file || file.size > 5 * 1024 * 1024) continue
      try {
        const base64 = await fileToBase64(file)
        setAttachments((prev) => [
          ...prev,
          { type: 'image', mimeType: file.type || 'image/png', fileName: `paste-${Date.now()}.png`, content: base64 },
        ])
      } catch {}
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl)
        if (!match) { reject(new Error('无效的数据 URL')); return }
        resolve(match[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // ── 快捷指令 ──
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputValue(val)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px'
    }
    if (val === '/') setShowCmdPanel(true)
    else if (!val.startsWith('/')) setShowCmdPanel(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    if (e.key === 'Escape') setShowCmdPanel(false)
  }

  const execCmd = (cmd: string, action: 'exec' | 'fill') => {
    setShowCmdPanel(false)
    if (action === 'fill') {
      setInputValue(cmd)
      textareaRef.current?.focus()
    } else {
      setInputValue(cmd)
      setTimeout(() => sendMessage(), 0)
    }
  }

  // ── 渲染单条消息气泡 ──
  const renderMessageBubble = (msg: MessageItem & { _streaming?: boolean; _streamId?: string }, isLast: boolean) => {
    if (msg.role === 'system') {
      return (
        <div key={msg.id} className="chat-msg-system">
          {msg.text}
        </div>
      )
    }

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="chat-msg chat-msg-user">
          <div className="chat-bubble">
            {msg.images?.map((img, idx) => {
              const src = img.data
                ? `data:${img.mediaType || 'image/png'};base64,${img.data}`
                : img.url || ''
              return src ? (
                <img key={idx} src={src} className="chat-msg-img" alt="attachment" />
              ) : null
            })}
            {msg.text && <div>{msg.text}</div>}
          </div>
          {/* 只在组最后一条显示时间 */}
          {isLast && (
            <div className="chat-msg-meta">
              <span>{formatTime(msg.time)}</span>
            </div>
          )}
        </div>
      )
    }

    // assistant
    return (
      <BubbleErrorBoundary key={msg.id}>
        <div
          className="chat-msg chat-msg-ai"
          data-stream-id={msg._streaming ? msg._streamId : undefined}
        >
          {msg._streaming ? (
            <div className="chat-bubble">
              <span className="chat-stream-cursor" />
            </div>
          ) : (
            <div
              className="chat-bubble"
              dangerouslySetInnerHTML={{ __html: safeRenderMarkdown(msg.text) }}
            />
          )}
          {/* 只在组最后一条显示 meta */}
          {!msg._streaming && isLast && (
            <div className="chat-msg-meta">
              <span>{formatTime(msg.time)}</span>
              {msg.durationMs && msg.durationMs > 0 && (
                <>
                  <span className="chat-meta-sep">·</span>
                  <span>⏱ {(msg.durationMs / 1000).toFixed(1)}s</span>
                </>
              )}
              {msg.tokenUsage && (msg.tokenUsage.input + msg.tokenUsage.output) > 0 && (
                <>
                  <span className="chat-meta-sep">·</span>
                  <span>↑{msg.tokenUsage.input} ↓{msg.tokenUsage.output}</span>
                </>
              )}
            </div>
          )}
        </div>
      </BubbleErrorBoundary>
    )
  }

  // ── 消息列表聚合成组 ──
  interface MsgGroup {
    role: 'user' | 'assistant' | 'system'
    msgs: Array<MessageItem & { _streaming?: boolean; _streamId?: string }>
    groupTime: Date
  }

  const buildMessageGroups = (
    msgList: Array<MessageItem & { _streaming?: boolean; _streamId?: string }>
  ): MsgGroup[] => {
    const groups: MsgGroup[] = []
    for (const msg of msgList) {
      const last = groups[groups.length - 1]
      // system 消息单独成组；同角色连续消息合入同一组
      if (last && last.role === msg.role && msg.role !== 'system') {
        last.msgs.push(msg)
        last.groupTime = msg.time
      } else {
        groups.push({ role: msg.role as MsgGroup['role'], msgs: [msg], groupTime: msg.time })
      }
    }
    return groups
  }

  // 渲染消息组，含时间分隔线
  const renderMessageGroups = () => {
    type ExtMsg = MessageItem & { _streaming?: boolean; _streamId?: string }
    const allMsgs = messages as ExtMsg[]
    const groups = buildMessageGroups(allMsgs)
    const result: React.ReactNode[] = []
    let lastMinute = ''

    groups.forEach((group, gi) => {
      // 时间分隔：每隔 5 分钟或首条显示
      const minute = `${group.groupTime.getFullYear()}-${group.groupTime.getMonth()}-${group.groupTime.getDate()}-${group.groupTime.getHours()}-${Math.floor(group.groupTime.getMinutes() / 5)}`
      if (minute !== lastMinute) {
        lastMinute = minute
        result.push(
          <div key={`divider-${gi}`} className="chat-time-divider">
            {formatTime(group.groupTime)}
          </div>
        )
      }
      // 消息组容器
      result.push(
        <div key={`group-${gi}`} className="chat-msg-group">
          {group.msgs.map((msg, mi) =>
            renderMessageBubble(msg, mi === group.msgs.length - 1)
          )}
        </div>
      )
    })
    return result
  }

  const canSend = (inputValue.trim().length > 0 || attachments.length > 0) && !isSending
  const sortedSessions = [...sessions].sort(
    (a, b) => (b.updatedAt || b.lastActivity || 0) - (a.updatedAt || a.lastActivity || 0)
  )

  return (
    <div className="chat-root">
      {/* 左侧会话列表 */}
      <div className={cn('chat-sidebar', showSidebar && 'chat-sidebar-open')}>
        <div className="chat-sidebar-header">
          <span>会话列表</span>
          <button
            className="chat-sidebar-btn"
            onClick={() => {
              // 新建会话：弹出简单 prompt
              const name = window.prompt('会话名称')
              if (name?.trim()) {
                switchSession(`agent:main:${name.trim()}`)
              }
            }}
            title="新建会话"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <div className="chat-session-list">
          {sortedSessions.length === 0 ? (
            <div className="chat-session-empty">暂无会话</div>
          ) : (
            sortedSessions.map((s) => (
              <div
                key={s.sessionKey}
                className={cn('chat-session-item', s.sessionKey === sessionKey && 'chat-session-item-active')}
                onClick={() => switchSession(s.sessionKey)}
              >
                <span className="chat-session-label">{parseSessionLabel(s.sessionKey)}</span>
                <button
                  className="chat-session-del"
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.sessionKey) }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 主聊天区 */}
      <div className="chat-main">
        {/* 顶部栏 */}
        <div className="chat-topbar">
          <div className="chat-topbar-left">
            <button
              className="chat-icon-btn"
              onClick={() => setShowSidebar((v) => !v)}
              title="会话列表"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span
              className={cn(
                'chat-status-dot',
                wsStatus === 'ready' && 'chat-status-online',
                (wsStatus === 'connecting' || wsStatus === 'reconnecting') && 'chat-status-connecting',
                (wsStatus === 'error' || wsStatus === 'disconnected') && 'chat-status-offline'
              )}
            />
            <span className="chat-session-title">{sessionKey ? parseSessionLabel(sessionKey) : '聊天'}</span>
          </div>
          <div className="chat-topbar-actions">
            <button
              className="chat-icon-btn"
              onClick={() => {
                if (inputValue.startsWith('/')) setShowCmdPanel((v) => !v)
                else { setInputValue('/'); setShowCmdPanel(true); textareaRef.current?.focus() }
              }}
              title="快捷指令"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
                <path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z" />
              </svg>
            </button>
            <button
              className="chat-icon-btn"
              onClick={resetCurrentSession}
              title="重置会话"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
              </svg>
            </button>
          </div>
        </div>

        {/* 断线提示条 */}
        {showDisconnectBar && (
          <div className="chat-disconnect-bar">连接已断开，正在重连...</div>
        )}

        {/* 消息区域 */}
        <div className="chat-messages" onClick={() => setShowCmdPanel(false)}>
          {wsStatus === 'ready' ? (
            <>
              {renderMessageGroups()}
              {isSending && !isStreaming && (
                <div className="chat-typing">
                  <span /><span /><span />
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          ) : (wsStatus === 'connecting' || wsStatus === 'reconnecting') ? (
            <div className="chat-gateway-empty">
              <div className="chat-gateway-empty-title" style={{ fontSize: '1rem', fontWeight: 400, opacity: 0.6 }}>
                {_t('openclaw.chat.connecting', { defaultValue: '正在连接 Gateway…' })}
              </div>
            </div>
          ) : (
            <div className="chat-gateway-empty">
              <div className="chat-gateway-empty-illus">
                <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <defs>
                    <linearGradient id="chat-gw-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.9" />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.6" />
                    </linearGradient>
                  </defs>
                  <rect x="35" y="28" width="50" height="44" rx="6" stroke="var(--color-accent)" strokeWidth="2.5" fill="var(--color-bg-secondary)" />
                  <circle cx="60" cy="50" r="8" fill="url(#chat-gw-grad)" />
                  <path d="M60 18 L60 28 M45 50 L35 50 M85 50 L75 50 M60 72 L60 82" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
                  <path d="M28 50 L18 50 M92 50 L102 50" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 3" opacity="0.8" />
                </svg>
              </div>
              <div className="chat-gateway-empty-title">{_t('openclaw.gateway.startButton', { defaultValue: '启动 Gateway' })}</div>
              <div className="chat-gateway-empty-desc">
                {_t('openclaw.chat.gatewayEmptyHint', { defaultValue: '连接 OpenClaw Gateway 后即可开始对话' })}
              </div>
              <button
                type="button"
                className="chat-gateway-empty-btn"
                onClick={(e) => { e.stopPropagation(); handleStartGateway() }}
                disabled={gatewayStarting}
              >
                {gatewayStarting
                  ? _t('overview.openclaw.serviceStarting', { defaultValue: '启动中…' })
                  : _t('openclaw.gateway.startButton', { defaultValue: '启动 Gateway' })}
              </button>
            </div>
          )}
        </div>

        {/* 快捷指令面板 */}
        {showCmdPanel && (
          <div className="chat-cmd-panel">
            {COMMANDS.map((group) => (
              <div key={group.title}>
                <div className="chat-cmd-group-title">{group.title}</div>
                {group.commands.map((c) => (
                  <div
                    key={c.cmd}
                    className="chat-cmd-item"
                    onClick={() => execCmd(c.cmd, c.action)}
                  >
                    <span className="chat-cmd-name">{c.cmd}</span>
                    <span className="chat-cmd-desc">{c.desc}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* 附件预览 */}
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((att, idx) => (
              <div key={idx} className="chat-attachment-item">
                <img
                  src={`data:${att.mimeType};base64,${att.content}`}
                  alt={att.fileName}
                />
                <button
                  className="chat-attachment-del"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div className="chat-input-area">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <button
            className="chat-icon-btn"
            onClick={() => fileInputRef.current?.click()}
            title="上传图片"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <div className="chat-input-wrap">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="输入消息，Enter 发送，/ 打开指令"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className="chat-textarea"
            />
          </div>
          <button
            className={cn('chat-send-btn', (canSend || isStreaming) && 'chat-send-btn-active')}
            disabled={!canSend && !isStreaming}
            onClick={() => {
              if (isStreaming) stopGeneration()
              else sendMessage()
            }}
            title={isStreaming ? '停止生成' : '发送'}
          >
            {isStreaming ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20}>
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={20} height={20}>
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
