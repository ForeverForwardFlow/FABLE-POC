import { boot } from 'quasar/wrappers';
import { ref, computed } from 'vue';
import type { WsIncomingMessage } from '../types';
import { useAuthStore } from 'src/stores/auth-store';

// WebSocket endpoint — configurable via env or defaults to deployed endpoint
const WS_URL = import.meta.env.VITE_WS_URL || 'wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev';

// Connection state: 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
const connectionState = ref<'connected' | 'connecting' | 'disconnected' | 'reconnecting'>('disconnected');
const connected = computed(() => connectionState.value === 'connected');

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const messageHandlers: Array<(msg: WsIncomingMessage) => void> = [];

// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

function getReconnectDelay(): number {
  const exponential = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempt), MAX_DELAY);
  // Add jitter: 0-50% of the delay
  const jitter = Math.random() * exponential * 0.5;
  return exponential + jitter;
}

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  connectionState.value = reconnectAttempt > 0 ? 'reconnecting' : 'connecting';

  // Append ID token as query param if authenticated
  let url = WS_URL;
  try {
    const authStore = useAuthStore();
    if (authStore.idToken) {
      url = `${WS_URL}?token=${authStore.idToken}`;
    }
  } catch {
    // Auth store may not be initialized yet during boot
  }

  console.log(`[FABLE] ${reconnectAttempt > 0 ? 'Reconnecting' : 'Connecting'} to WebSocket (attempt ${reconnectAttempt + 1})`);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[FABLE] WebSocket connected');
    connectionState.value = 'connected';
    reconnectAttempt = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WsIncomingMessage;
      for (const handler of messageHandlers) {
        handler(msg);
      }
    } catch (err) {
      console.warn('[FABLE] Failed to parse message:', event.data);
    }
  };

  ws.onclose = () => {
    console.log('[FABLE] WebSocket disconnected');
    connectionState.value = 'disconnected';
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[FABLE] WebSocket error:', err);
  };
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  ws?.close();
  ws = null;
  connectionState.value = 'disconnected';
}

function send(data: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[FABLE] Cannot send — not connected');
    return;
  }
  ws.send(JSON.stringify(data));
}

function onMessage(handler: (msg: WsIncomingMessage) => void) {
  messageHandlers.push(handler);
  return () => {
    const idx = messageHandlers.indexOf(handler);
    if (idx >= 0) messageHandlers.splice(idx, 1);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = getReconnectDelay();
  console.log(`[FABLE] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempt + 1})`);
  connectionState.value = 'reconnecting';
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectAttempt++;
    connect();
  }, delay);
}

export const fableWs = {
  connected,
  connectionState,
  connect,
  disconnect,
  send,
  onMessage,
};

export default boot(({ app }) => {
  app.config.globalProperties.$ws = fableWs;
  connect();
});

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $ws: typeof fableWs;
  }
}
