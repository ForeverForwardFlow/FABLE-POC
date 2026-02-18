import { defineStore } from 'pinia';
import { fableWs } from '../boot/websocket';
import type { ChatMessage, ChatState, LogEntry, WsIncomingMessage } from '../types';

const CONV_ID_KEY = 'fable_conversationId';

export const useChatStore = defineStore('chat', {
  state: (): ChatState & { isStreaming: boolean; streamTick: number } => ({
    messages: [],
    isBuilding: false,
    currentBuildId: null,
    conversationId: localStorage.getItem(CONV_ID_KEY),
    logs: [],
    isStreaming: false,
    streamTick: 0,
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

      // Add thinking placeholder so user sees immediate feedback
      this.isStreaming = true;
      this.messages.push({
        id: 'pending-response',
        role: 'fable',
        content: '',
        timestamp: new Date().toISOString(),
        metadata: { isStreaming: true },
      });

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
        case 'chat_chunk': {
          // Streaming chunk — append to existing message or replace placeholder
          this.isStreaming = true;
          const last = this.messages[this.messages.length - 1];
          if (last?.role === 'fable' && last.id === msg.payload.messageId) {
            // Same message — append
            last.content += msg.payload.content;
            if (!last.metadata) last.metadata = {};
            last.metadata.isStreaming = true;
          } else if (last?.role === 'fable' && last.id === 'pending-response') {
            // Replace thinking placeholder with real message
            last.id = msg.payload.messageId;
            last.content = msg.payload.content;
            if (!last.metadata) last.metadata = {};
            last.metadata.isStreaming = true;
          } else {
            this.messages.push({
              id: msg.payload.messageId,
              role: 'fable',
              content: msg.payload.content,
              timestamp: new Date().toISOString(),
              metadata: { isStreaming: true },
            });
          }
          this.streamTick++;
          break;
        }

        case 'chat_response': {
          // Legacy: treat same as chat_chunk for backward compat
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
          // Final message — update content, clear streaming, capture conversationId
          this.isStreaming = false;
          // Find matching message or pending placeholder
          let last = this.messages.find(m => m.id === msg.payload.messageId);
          if (!last) {
            last = this.messages.find(m => m.id === 'pending-response');
            if (last) last.id = msg.payload.messageId;
          }
          if (!last) last = this.messages[this.messages.length - 1];
          if (last?.role === 'fable') {
            last.content = msg.payload.fullContent;
            if (last.metadata) last.metadata.isStreaming = false;
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
          // Replace pending placeholder if present
          const pendingIdx = this.messages.findIndex(m => m.id === 'pending-response');
          if (pendingIdx >= 0) {
            this.messages[pendingIdx].id = msg.payload.messageId;
          }
          // Attach tool use to the current fable message (or create one)
          const toolMsg = this.messages.find(m => m.id === msg.payload.messageId)
            || this.messages[this.messages.length - 1];
          if (toolMsg?.role === 'fable') {
            if (!toolMsg.metadata) toolMsg.metadata = {};
            if (!toolMsg.metadata.toolUses) toolMsg.metadata.toolUses = [];
            toolMsg.metadata.toolUses.push({
              toolName: msg.payload.toolName,
              toolId: msg.payload.toolId,
              input: msg.payload.input,
            });
          } else {
            // No fable message yet — create a placeholder
            this.messages.push({
              id: msg.payload.messageId,
              role: 'fable',
              content: '',
              timestamp: new Date().toISOString(),
              metadata: {
                toolUses: [{
                  toolName: msg.payload.toolName,
                  toolId: msg.payload.toolId,
                  input: msg.payload.input,
                }],
              },
            });
          }
          this.addLog({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Using tool: ${msg.payload.toolName}`,
          });
          break;
        }

        case 'tool_result': {
          // Find the matching tool_use and attach result
          for (const m of this.messages) {
            const tu = m.metadata?.toolUses?.find(t => t.toolId === msg.payload.toolId);
            if (tu) {
              tu.result = msg.payload.result;
              break;
            }
          }
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
          // Clear streaming state and remove pending placeholder
          this.isStreaming = false;
          const pendingErrIdx = this.messages.findIndex(m => m.id === 'pending-response');
          if (pendingErrIdx >= 0) this.messages.splice(pendingErrIdx, 1);
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
