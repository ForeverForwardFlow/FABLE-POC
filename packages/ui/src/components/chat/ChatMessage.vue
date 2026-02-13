<template>
  <div class="chat-message" :class="messageClass">
    <div :class="bubbleClass">
      <div class="chat-message__content">{{ message.content }}</div>

      <ProgressBar
        v-if="message.metadata?.progress !== undefined"
        :progress="message.metadata.progress"
        class="chat-message__progress"
      />

      <PhaseBadge
        v-if="message.metadata?.status"
        :status="message.metadata.status"
        class="chat-message__badge"
      />

      <ul v-if="message.metadata?.checkmarks?.length" class="fable-checklist">
        <li
          v-for="(item, index) in message.metadata.checkmarks"
          :key="index"
          class="fable-checklist__item fable-checklist__item--checked"
        >
          <q-icon name="check_circle" size="16px" />
          {{ item }}
        </li>
      </ul>

      <div v-if="message.metadata?.actions?.length" class="chat-message__actions">
        <ActionButton
          v-for="action in message.metadata.actions"
          :key="action.action"
          :action="action"
          @click="$emit('action', action)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage, Action } from 'src/types';
import ProgressBar from './ProgressBar.vue';
import PhaseBadge from './PhaseBadge.vue';
import ActionButton from './ActionButton.vue';

const props = defineProps<{
  message: ChatMessage;
}>();

defineEmits<{
  (e: 'action', action: Action): void;
}>();

const messageClass = computed(() => ({
  'chat-message--user': props.message.role === 'user',
  'chat-message--fable': props.message.role === 'fable'
}));

const bubbleClass = computed(() =>
  props.message.role === 'user' ? 'user-message' : 'assistant-message'
);
</script>

<style lang="scss" scoped>
.chat-message {
  display: flex;
  margin-bottom: 16px;

  &--user {
    justify-content: flex-end;
  }

  &--fable {
    justify-content: flex-start;
  }

  &__content {
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__progress {
    margin-top: 12px;
  }

  &__badge {
    margin-top: 8px;
  }

  &__actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
}
</style>
