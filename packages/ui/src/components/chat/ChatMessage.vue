<template>
  <div class="chat-message" :class="messageClass">
    <div :class="bubbleClass">
      <div
        v-if="message.metadata?.toolUses?.length"
        class="chat-message__tools"
      >
        <span
          v-for="tu in message.metadata.toolUses"
          :key="tu.toolId"
          class="tool-chip"
          :title="tu.result ? JSON.stringify(tu.result, null, 2) : 'Running...'"
        >
          <q-icon name="build" size="14px" />
          {{ tu.toolName }}
          <q-icon
            v-if="tu.result"
            name="check_circle"
            size="14px"
            class="tool-chip__done"
          />
        </span>
      </div>
      <div
        v-if="message.role === 'fable'"
        class="chat-message__content markdown-body"
        v-html="renderedContent"
      />
      <div v-else class="chat-message__content">{{ message.content }}</div>

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
import { marked } from 'marked';
import type { ChatMessage, Action, ToolUse } from 'src/types';
import ProgressBar from './ProgressBar.vue';
import PhaseBadge from './PhaseBadge.vue';
import ActionButton from './ActionButton.vue';

// Configure marked for safe, compact output
marked.setOptions({ breaks: true, gfm: true });

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

const renderedContent = computed(() => {
  if (!props.message.content) return '';
  return marked.parse(props.message.content) as string;
});
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

    &.markdown-body {
      white-space: normal;

      :deep(p) {
        margin: 0 0 0.5em;
        &:last-child { margin-bottom: 0; }
      }
      :deep(strong) { font-weight: 600; }
      :deep(ul), :deep(ol) {
        margin: 0.25em 0 0.5em;
        padding-left: 1.5em;
      }
      :deep(li) { margin-bottom: 0.15em; }
      :deep(code) {
        background: rgba(255,255,255,0.08);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.9em;
      }
      :deep(pre) {
        background: rgba(0,0,0,0.3);
        padding: 8px 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0.5em 0;
        code { background: none; padding: 0; }
      }
      :deep(h1), :deep(h2), :deep(h3) {
        margin: 0.5em 0 0.25em;
        font-size: 1em;
        font-weight: 600;
      }
    }
  }

  &__progress {
    margin-top: 12px;
  }

  &__badge {
    margin-top: 8px;
  }

  &__tools {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  &__actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
}

.tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  background: rgba(var(--q-primary-rgb, 25, 118, 210), 0.12);
  color: var(--q-primary, #1976d2);
  font-weight: 500;

  &__done {
    color: #4caf50;
  }
}
</style>
