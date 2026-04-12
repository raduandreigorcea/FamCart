type DebugLevel = 'log' | 'info' | 'warn' | 'error'

export interface DebugLogEntry {
  id: number
  ts: string
  level: DebugLevel
  message: string
}

type DebugSubscriber = (entries: DebugLogEntry[]) => void

const MAX_LOGS = 200
const entries: DebugLogEntry[] = []
const subscribers = new Set<DebugSubscriber>()

let nextId = 1
let installed = false

export const debugOverlayEnabled = import.meta.env.VITE_DEBUG_OVERLAY === '1'

function notifySubscribers() {
  const snapshot = entries.slice()
  subscribers.forEach((subscriber) => subscriber(snapshot))
}

function toMessage(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack ? `\n${value.stack}` : ''
    return `${value.name}: ${value.message}${stack}`
  }

  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function addDebugLog(level: DebugLevel, ...args: unknown[]) {
  if (!debugOverlayEnabled) return

  const message = args.map((arg) => toMessage(arg)).join(' ')
  const entry: DebugLogEntry = {
    id: nextId++,
    ts: new Date().toISOString().slice(11, 19),
    level,
    message,
  }

  entries.push(entry)

  if (entries.length > MAX_LOGS) {
    entries.splice(0, entries.length - MAX_LOGS)
  }

  notifySubscribers()
}

export function getDebugLogs(): DebugLogEntry[] {
  return entries.slice()
}

export function subscribeDebugLogs(subscriber: DebugSubscriber): () => void {
  subscribers.add(subscriber)
  subscriber(entries.slice())

  return () => {
    subscribers.delete(subscriber)
  }
}

export function installDebugLogCapture() {
  if (!debugOverlayEnabled || installed) return
  installed = true

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  console.log = (...args: unknown[]) => {
    addDebugLog('log', ...args)
    original.log(...args)
  }

  console.info = (...args: unknown[]) => {
    addDebugLog('info', ...args)
    original.info(...args)
  }

  console.warn = (...args: unknown[]) => {
    addDebugLog('warn', ...args)
    original.warn(...args)
  }

  console.error = (...args: unknown[]) => {
    addDebugLog('error', ...args)
    original.error(...args)
  }

  window.addEventListener('error', (event) => {
    addDebugLog('error', 'window.error', event.message, event.error)
  })

  window.addEventListener('unhandledrejection', (event) => {
    addDebugLog('error', 'unhandledrejection', event.reason)
  })
}

export function renderBootstrapFailure(error: unknown) {
  if (!debugOverlayEnabled || typeof document === 'undefined') return

  const body = document.body
  if (!body) return

  const message = toMessage(error)
  body.innerHTML = `
    <div style="position:fixed;inset:0;z-index:2147483647;background:#111827;color:#f9fafb;padding:16px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
      <h2 style="margin:0 0 8px 0;font-size:16px;">Startup Error</h2>
      <p style="margin:0 0 12px 0;font-size:12px;color:#d1d5db;">Debug overlay is enabled for this build.</p>
      <pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;">${message.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
    </div>
  `
}
