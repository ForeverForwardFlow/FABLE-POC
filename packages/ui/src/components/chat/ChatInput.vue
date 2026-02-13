<template>
  <div class="chat-input">
    <textarea
      ref="textareaRef"
      v-model="message"
      class="ff-input chat-input__textarea"
      placeholder="What would you like me to build?"
      :disabled="disabled"
      @keydown="handleKeydown"
      rows="1"
    />
    <button
      class="ff-btn-primary chat-input__send"
      :disabled="disabled || !message.trim()"
      @click="send"
    >
      <q-icon name="send" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', message: string): void;
}>();

const message = ref('');
const textareaRef = ref<HTMLTextAreaElement>();

// Auto-grow textarea
watch(message, async () => {
  await nextTick();
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto';
    textareaRef.value.style.height = `${Math.min(textareaRef.value.scrollHeight, 200)}px`;
  }
});

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

function send() {
  if (message.value.trim() && !props.disabled) {
    emit('send', message.value.trim());
    message.value = '';
  }
}
</script>

<style lang="scss" scoped>
.chat-input {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 16px;
  background: var(--ff-bg-secondary);
  border-top: 1px solid var(--ff-border);

  &__textarea {
    flex: 1;
    min-height: 44px;
    max-height: 200px;
    line-height: 1.5;
  }

  &__send {
    padding: 10px 16px;
    flex-shrink: 0;
  }
}
</style>
