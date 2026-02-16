import { defineStore } from 'pinia';
import { fableWs } from '../boot/websocket';
import type { ChatMessage, ChatState, LogEntry, WsIncomingMessage } from '../types';

const CONV_ID_KEY = 'fable_conversationId';

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    messages: [],
    isBuilding: false,
    currentBuildId: null,
    conversationId: localStorage.getItem(CONV_ID_KEY),
    logs: []
  }),

  getters: {
    lastMessage: (state): ChatMessage | undefined => {
      return state.messages[state.messages.length - 1];
    },

    messageCount: (state): number => {
      return state.messages.length;
    },

    hasMessages: (state): boolean => {
      return state.messages.length > 0;
    }
  },

  actions: {
    sendMessage(content: string): void {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date().toISOString()
      };
      this.messages.push(message);

      // Send via WebSocket
      fableWs.send({
        type: 'message',
        payload: {
          content: content.trim(),
          ...(this.conversationId ? { conversationId: this.conversationId } : {}),
        },
      });
    },

    handleWsMessage(msg: WsIncomingMessage): void {
      switch (msg.type) {
        case 'chat_response': {
          // Streaming response — update or create FABLE message
          const last = this.messages[this.messages.length - 1];
          if (last?.role === 'fable' && last.id === msg.payload.messageId) {
            last.content = msg.payload.content;
          } else {
            this.messages.push({
              id: msg.payload.messageId,
              role: 'fable',
              content: msg.payload.content,
              timestamp: new Date().toISOString(),
            });
          }
          break;
        }

        case 'chat_complete': {
          // Final message — update content and capture conversationId
          const last = this.messages[this.messages.length - 1];
          if (last?.role === 'fable' && last.id === msg.payload.messageId) {
            last.content = msg.payload.fullContent;
          } else {
            this.messages.push({
              id: msg.payload.messageId,
              role: 'fable',
              content: msg.payload.fullContent,
              timestamp: new Date().toISOString(),
            });
          }
          if (msg.payload.conversationId) {
            this.conversationId = msg.payload.conversationId;
            localStorage.setItem(CONV_ID_KEY, msg.payload.conversationId);
          }
          break;
        }

        case 'build_started': {
          this.isBuilding = true;
          this.currentBuildId = msg.payload.buildId;
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Build started: ${msg.payload.toolName} (${msg.payload.buildId})`,
          });
          break;
        }

        case 'build_completed': {
          this.isBuilding = false;
          const tools = msg.payload.tools || [];
          const toolNames = tools.map(t => t.toolName).join(', ');
          this.messages.push({
            id: crypto.randomUUID(),
            role: 'fable',
            content: `Your ${toolNames} tool is ready!`,
            timestamp: new Date().toISOString(),
            metadata: {
              status: 'complete',
              progress: 100,
              checkmarks: ['Build complete', 'Deployed'],
              actions: tools.map(t => ({
                label: `Try ${t.toolName}`,
                type: 'primary' as const,
                action: `navigate:/tools/${t.toolName}`,
              })),
            },
          });
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Build completed: ${toolNames}`,
          });
          break;
        }

        case 'build_failed': {
          this.isBuilding = false;
          this.messages.push({
            id: crypto.randomUUID(),
            role: 'fable',
            content: `Build failed: ${msg.payload.error}`,
            timestamp: new Date().toISOString(),
            metadata: { status: 'error' },
          });
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'error',
            message: `Build failed: ${msg.payload.error}`,
          });
          break;
        }

        case 'build_needs_help': {
          this.isBuilding = false;
          this.messages.push({
            id: crypto.randomUUID(),
            role: 'fable',
            content: msg.payload.message,
            timestamp: new Date().toISOString(),
            metadata: { status: 'error' },
          });
          break;
        }

        case 'tool_use': {
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Using tool: ${msg.payload.toolName}`,
          });
          break;
        }

        case 'conversation_loaded': {
          // Replace current chat with loaded conversation
          this.conversationId = msg.payload.conversationId;
          localStorage.setItem(CONV_ID_KEY, msg.payload.conversationId);
          this.messages = msg.payload.messages.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role === 'user' ? 'user' as const : 'fable' as const,
            content: m.content,
            timestamp: m.timestamp,
          }));
          this.isBuilding = false;
          this.currentBuildId = msg.payload.activeBuildId;
          this.logs = [];
          break;
        }

        case 'error': {
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'error',
            message: msg.message,
          });
          break;
        }
      }
    },

    addFableMessage(partial: Partial<ChatMessage>): void {
      const message: ChatMessage = {
        id: partial.id || crypto.randomUUID(),
        role: 'fable',
        content: partial.content || '',
        timestamp: partial.timestamp || new Date().toISOString(),
        metadata: partial.metadata
      };
      this.messages.push(message);
    },

    updateLastMessage(updates: Partial<ChatMessage>): void {
      if (this.messages.length === 0) return;

      const lastIndex = this.messages.length - 1;
      const lastMessage = this.messages[lastIndex];

      this.messages[lastIndex] = {
        ...lastMessage,
        ...updates,
        metadata: {
          ...lastMessage.metadata,
          ...updates.metadata
        }
      };
    },

    setBuilding(building: boolean): void {
      this.isBuilding = building;
    },

    setBuildId(buildId: string | null): void {
      this.currentBuildId = buildId;
    },

    addLog(log: LogEntry): void {
      this.logs.push(log);
    },

    clearLogs(): void {
      this.logs = [];
    },

    clearChat(): void {
      this.messages = [];
      this.isBuilding = false;
      this.currentBuildId = null;
      this.conversationId = null;
      this.logs = [];
      localStorage.removeItem(CONV_ID_KEY);
    },

    newConversation(): void {
      this.clearChat();
    },

    loadConversation(conversationId: string): void {
      fableWs.send({
        type: 'load_conversation',
        payload: { conversationId },
      });
    },

    restoreFromLocalStorage(): void {
      const savedId = localStorage.getItem(CONV_ID_KEY);
      if (savedId && !this.messages.length) {
        this.conversationId = savedId;
        this.loadConversation(savedId);
      }
    },

    loadDemoConversation(): void {
      this.messages = [
        {
          id: '1',
          role: 'user',
          content: 'Build me a tip calculator',
          timestamp: new Date().toISOString()
        },
        {
          id: '2',
          role: 'fable',
          content: "Got it! I'm designing your tip calculator...",
          timestamp: new Date().toISOString(),
          metadata: { status: 'planning', progress: 15 }
        },
        {
          id: '3',
          role: 'fable',
          content: 'Design complete - 3 components to build',
          timestamp: new Date().toISOString(),
          metadata: {
            status: 'building',
            progress: 45,
            checkmarks: ['Design complete']
          }
        },
        {
          id: '4',
          role: 'fable',
          content: 'Done! Your tip calculator is ready.',
          timestamp: new Date().toISOString(),
          metadata: {
            status: 'complete',
            progress: 100,
            checkmarks: ['Design complete', 'Build complete', 'Tests passed'],
            actions: [
              { label: 'Try it', type: 'primary', action: 'open_tool' },
              { label: 'View Code', type: 'secondary', action: 'view_code' }
            ]
          }
        }
      ];
    }
  }
});
