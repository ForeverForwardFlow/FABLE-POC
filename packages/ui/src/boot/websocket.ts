import { boot } from 'quasar/wrappers';
import { ref } from 'vue';
import type { WsIncomingMessage } from '../types';

// WebSocket endpoint — configurable via env or defaults to deployed endpoint
const WS_URL = import.meta.env.VITE_WS_URL || 'wss://f9qynczzkj.execute-api.us-west-2.amazonaws.com/dev';

const connected = ref(false);
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const messageHandlers: Array<(msg: WsIncomingMessage) => void> = [];

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  console.log('[FABLE] Connecting to', WS_URL);
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[FABLE] WebSocket connected');
    connected.value = true;
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
    connected.value = false;
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
  ws?.close();
  ws = null;
  connected.value = false;
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
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    console.log('[FABLE] Reconnecting...');
    connect();
  }, 3000);
}

export const fableWs = {
  connected,
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
