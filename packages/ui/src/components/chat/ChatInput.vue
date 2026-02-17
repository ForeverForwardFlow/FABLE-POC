<template>
  <div class="chat-input">
    <div class="chat-input__row">
      <q-input
        ref="inputRef"
        v-model="message"
        :disable="disabled"
        placeholder="What would you like me to build?"
        outlined
        autogrow
        dark
        class="chat-input__field"
        @keydown.enter.exact.prevent="send"
      >
        <template #append>
          <q-btn
            v-if="!disabled"
            round
            flat
            icon="send"
            class="chat-input__send-btn"
            :disable="!message.trim()"
            @click="send"
          >
            <q-tooltip>Send (Enter)</q-tooltip>
          </q-btn>
          <q-btn
            v-else
            round
            flat
            icon="stop"
            class="chat-input__stop-btn"
            @click="$emit('cancel')"
          >
            <q-tooltip>Stop</q-tooltip>
          </q-btn>
        </template>
      </q-input>
    </div>
    <div class="chat-input__hint">
      <span v-if="!disabled">Enter to send, Shift+Enter for new line</span>
      <span v-else class="chat-input__hint--building">
        <q-spinner-dots size="12px" />
        Processing...
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { QInput } from 'quasar';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', message: string): void;
  (e: 'cancel'): void;
}>();

const message = ref('');
const inputRef = ref<QInput | null>(null);

function send() {
  if (message.value.trim()) {
    emit('send', message.value.trim());
    message.value = '';
    inputRef.value?.focus();
  }
}

onMounted(() => {
  inputRef.value?.focus();
});

defineExpose({
  focus: () => inputRef.value?.focus(),
});
</script>

<style lang="scss" scoped>
.chat-input {
  padding: 12px 16px;
  background: var(--ff-bg-secondary, #1a1a1a);
  border-top: 1px solid var(--ff-border, rgba(255, 255, 255, 0.08));

  &__row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  &__field {
    flex: 1;

    :deep(.q-field__control) {
      background: var(--ff-bg-tertiary, #252525) !important;
      border: 1px solid var(--ff-border, rgba(255, 255, 255, 0.08)) !important;
      border-radius: 16px !important;
      min-height: 44px;
      max-height: 200px;
      padding: 4px 8px;

      &:hover {
        border-color: var(--ff-border-light, rgba(255, 255, 255, 0.12)) !important;
      }

      &::before,
      &::after {
        display: none !important;
      }
    }

    :deep(.q-field__native) {
      color: var(--ff-text-primary, #fff) !important;
      padding: 8px 4px !important;
      line-height: 1.5;

      &::placeholder {
        color: var(--ff-text-muted, #71717a) !important;
      }
    }

    &:deep(.q-field--focused .q-field__control) {
      border-color: var(--ff-purple, #a855f7) !important;
      box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.15);
    }
  }

  &__send-btn {
    color: var(--ff-purple, #a855f7) !important;
    transition: all 0.2s ease;

    &:hover:not(:disabled) {
      color: var(--ff-purple-light, #c084fc) !important;
      background: rgba(168, 85, 247, 0.1) !important;
    }

    &:disabled {
      color: var(--ff-text-muted, #71717a) !important;
      opacity: 0.5;
    }
  }

  &__stop-btn {
    color: #ef4444 !important;
    background: rgba(239, 68, 68, 0.15) !important;

    &:hover {
      background: rgba(239, 68, 68, 0.25) !important;
    }
  }

  &__hint {
    padding: 4px 12px 0;
    font-size: 0.7rem;
    color: var(--ff-text-muted, #71717a);

    &--building {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--ff-teal, #14b8a6);
    }
  }
}
</style>
