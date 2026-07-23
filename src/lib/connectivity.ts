import { ref } from 'vue'
import { Network } from '@capacitor/network'

// Single source of truth for connectivity. On Android, @capacitor/network reads
// the OS ConnectivityManager, which is reliable — unlike navigator.onLine, which
// the WebView often reports as `true` with no real connection (and whose
// online/offline events can fail to fire). The rest of the app reads this ref
// and registers reconnect handlers here instead of touching navigator directly.

const online = ref(true)
const reconnectHandlers = new Set<() => void>()
let started = false
let statusReady: Promise<void> | null = null

// Apply a new status, firing reconnect handlers only on a real offline→online
// edge so callers can flush queued work exactly once per reconnection.
function applyStatus(connected: boolean): void {
  const wasOffline = !online.value
  online.value = connected
  if (connected && wasOffline) {
    for (const handler of reconnectHandlers) {
      try {
        handler()
      } catch {
        // A misbehaving handler must not stop the others from running.
      }
    }
  }
}

// Begin tracking connectivity. Idempotent; safe to call from multiple mounts.
// Returns a promise that resolves once the first real status has been read, so
// the router can await a trustworthy offline/online answer on cold start.
export function startConnectivity(): Promise<void> {
  if (started) return statusReady ?? Promise.resolve()
  started = true

  try {
    void Network.addListener('networkStatusChange', (status) => {
      applyStatus(status.connected)
    })
  } catch {
    // Plugin unavailable (e.g. a bare test env): fall back to the default-online
    // ref and the window listeners below.
  }

  // Web fallback so connectivity still tracks in the browser and in tests even
  // if the plugin listener is a no-op.
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => applyStatus(true))
    window.addEventListener('offline', () => applyStatus(false))
  }

  statusReady = Network.getStatus()
    .then((status) => {
      applyStatus(status.connected)
    })
    .catch(() => {
      // Couldn't read the plugin — trust navigator as a last resort.
      if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
        applyStatus(navigator.onLine)
      }
    })

  return statusReady
}

// Await a trustworthy connectivity answer, bounded so navigation is never
// blocked if the plugin hangs. Used by the router guard on cold start.
export async function ensureOnlineStatus(timeoutMs = 1500): Promise<boolean> {
  const ready = startConnectivity()
  await Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
  return online.value
}

// Force a fresh read of the OS connectivity state rather than returning the
// cached ref. The ambient networkStatusChange listener can lag behind the real
// network returning (or never fire inside a WebView), so the offline screen's
// manual retry polls the plugin directly to get a trustworthy answer right now.
export async function refreshConnectivity(): Promise<boolean> {
  startConnectivity()
  try {
    const status = await Network.getStatus()
    applyStatus(status.connected)
  } catch {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      applyStatus(navigator.onLine)
    }
  }
  return online.value
}

export function isCurrentlyOffline(): boolean {
  return online.value === false
}

// Register a handler to run each time connectivity is restored. Returns an
// unregister function.
export function onReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler)
  return () => reconnectHandlers.delete(handler)
}

// Test seam: drive the status directly without the plugin.
export function __setOnlineForTest(connected: boolean): void {
  started = true
  applyStatus(connected)
}
