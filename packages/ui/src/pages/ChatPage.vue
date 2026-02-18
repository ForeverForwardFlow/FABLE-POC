<template>
  <q-page class="chat-page">
    <!-- Messages Area -->
    <div ref="messagesRef" class="chat-page__messages">
      <!-- Welcome message if empty -->
      <div v-if="!chatStore.messages.length" class="chat-page__welcome">
        <div class="chat-page__welcome-icon">
          <q-icon name="auto_awesome" size="48px" color="purple" />
        </div>
        <h2>Welcome to FABLE</h2>
        <p>Describe what you'd like to build, and I'll create it for you.</p>
      </div>

      <!-- Message list -->
      <ChatMessage
        v-for="message in chatStore.messages"
        :key="message.id"
        :message="message"
        @action="handleAction"
      />
    </div>

    <!-- Details Panel -->
    <DetailsPanel />

    <!-- Input Area -->
    <ChatInput :disabled="chatStore.isBuilding" @send="handleSend" />
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useChatStore } from 'src/stores/chat-store';
import { useConversationsStore } from 'src/stores/conversations-store';
import { fableWs } from 'src/boot/websocket';
import ChatMessage from 'src/components/chat/ChatMessage.vue';
import ChatInput from 'src/components/chat/ChatInput.vue';
import DetailsPanel from 'src/components/details/DetailsPanel.vue';
import type { Action, WsIncomingMessage } from 'src/types';

const router = useRouter();
const route = useRoute();
const chatStore = useChatStore();
const conversationsStore = useConversationsStore();
const messagesRef = ref<HTMLElement>();

// Wire WebSocket messages to chat store and conversations store
let unsubscribe: (() => void) | null = null;

function initAfterConnect() {
  // Load specific conversation from route param, or restore from localStorage
  const convId = route.params.conversationId as string | undefined;
  if (convId) {
    chatStore.loadConversation(convId);
  } else {
    chatStore.restoreFromLocalStorage();
  }

  // Fetch conversation list for sidebar
  conversationsStore.fetchConversations();
}

let unwatchConnected: (() => void) | null = null;

onMounted(() => {
  unsubscribe = fableWs.onMessage((msg: WsIncomingMessage) => {
    // Route conversation management messages to conversations store
    if (msg.type === 'conversations_list') {
      conversationsStore.handleConversationsList(msg.payload.conversations);
      return;
    }
    if (msg.type === 'conversation_deleted') {
      conversationsStore.handleConversationDeleted(msg.payload.conversationId);
      return;
    }
    // Everything else goes to chat store
    chatStore.handleWsMessage(msg);
  });

  // Wait for WebSocket connection before sending messages
  if (fableWs.connected.value) {
    initAfterConnect();
  } else {
    unwatchConnected = watch(fableWs.connected, (isConnected) => {
      if (isConnected) {
        initAfterConnect();
        unwatchConnected?.();
        unwatchConnected = null;
      }
    });
  }
});

onUnmounted(() => {
  unsubscribe?.();
  unwatchConnected?.();
});

// Auto-scroll to bottom when messages change or streaming updates arrive
watch(
  () => [chatStore.messages.length, chatStore.streamTick],
  async () => {
    await nextTick();
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
  }
);

function handleSend(content: string) {
  chatStore.sendMessage(content);
}

function handleAction(action: Action) {
  if (action.action.startsWith('navigate:')) {
    const path = action.action.slice(9);
    router.push(path);
  } else if (action.action.startsWith('try:')) {
    const toolName = action.action.slice(4);
    chatStore.sendMessage(`Try the ${toolName} tool with a sample input.`);
  } else if (action.action.startsWith('http')) {
    window.open(action.action, '_blank');
  }
}
</script>

<style lang="scss" scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;

  &__messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  &__welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    color: var(--ff-text-secondary);

    h2 {
      margin: 16px 0 8px;
      color: var(--ff-text-primary);
      font-size: 24px;
      font-weight: 600;
    }

    p {
      font-size: 16px;
      max-width: 400px;
    }
  }

  &__welcome-icon {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ff-bg-card);
    border-radius: 50%;
  }
}
</style>
