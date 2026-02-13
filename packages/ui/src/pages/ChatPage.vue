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
import { useChatStore } from 'src/stores/chat-store';
import { fableWs } from 'src/boot/websocket';
import ChatMessage from 'src/components/chat/ChatMessage.vue';
import ChatInput from 'src/components/chat/ChatInput.vue';
import DetailsPanel from 'src/components/details/DetailsPanel.vue';
import type { Action } from 'src/types';

const chatStore = useChatStore();
const messagesRef = ref<HTMLElement>();

// Wire WebSocket messages to chat store
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = fableWs.onMessage((msg) => {
    chatStore.handleWsMessage(msg);
  });
});

onUnmounted(() => {
  unsubscribe?.();
});

// Auto-scroll to bottom when messages change
watch(
  () => chatStore.messages.length,
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
  console.log('Action clicked:', action);
  if (action.action.startsWith('http')) {
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
