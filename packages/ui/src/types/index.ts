// Build status types
export type BuildStatus = 'planning' | 'building' | 'testing' | 'deploying' | 'complete' | 'error';

// Action button type
export interface Action {
  label: string;
  type: 'primary' | 'secondary' | 'link';
  action: string;
}

// Chat message type
export interface ChatMessage {
  id: string;
  role: 'user' | 'fable';
  content: string;
  timestamp: string;
  metadata?: {
    status?: BuildStatus;
    progress?: number;
    checkmarks?: string[];
    actions?: Action[];
  };
}

// Log entry type
export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

// Project type
export interface Project {
  id: string;
  name: string;
  status: BuildStatus;
  createdAt: string;
}

// Chat state type
export interface ChatState {
  messages: ChatMessage[];
  isBuilding: boolean;
  currentBuildId: string | null;
  conversationId: string | null;
  logs: LogEntry[];
}

// UI state type
export interface UIState {
  sidebarOpen: boolean;
  detailsExpanded: boolean;
}

// WebSocket message types (outgoing to server)
export interface WsOutgoingMessage {
  type: 'message' | 'ping';
  payload?: {
    content: string;
    conversationId?: string;
  };
}

// WebSocket message types (incoming from server)
export type WsIncomingMessage =
  | { type: 'chat_response'; payload: { messageId: string; content: string } }
  | { type: 'chat_complete'; payload: { messageId: string; fullContent: string; conversationId: string } }
  | { type: 'build_started'; payload: { buildId: string; toolName: string } }
  | { type: 'build_completed'; payload: { buildId: string; tools: Array<{ toolName: string; functionUrl: string; schema: unknown }> } }
  | { type: 'build_failed'; payload: { buildId: string; error: string } }
  | { type: 'tool_use'; payload: { toolName: string; toolId: string } }
  | { type: 'tool_result'; payload: { toolId: string; result: unknown } }
  | { type: 'pong'; timestamp: string }
  | { type: 'error'; message: string };
