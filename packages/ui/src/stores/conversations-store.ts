import { defineStore } from 'pinia';
import { fableWs } from '../boot/websocket';
import type { ConversationSummary } from '../types';

interface ConversationsState {
  conversations: ConversationSummary[];
  loading: boolean;
}

export const useConversationsStore = defineStore('conversations', {
  state: (): ConversationsState => ({
    conversations: [],
    loading: false,
  }),

  actions: {
    fetchConversations(): void {
      this.loading = true;
      fableWs.send({ type: 'list_conversations' });
    },

    handleConversationsList(conversations: ConversationSummary[]): void {
      this.conversations = conversations;
      this.loading = false;
    },

    handleConversationDeleted(conversationId: string): void {
      this.conversations = this.conversations.filter(
        (c) => c.conversationId !== conversationId
      );
    },

    deleteConversation(conversationId: string): void {
      fableWs.send({
        type: 'delete_conversation',
        payload: { conversationId },
      });
    },
  },
});
