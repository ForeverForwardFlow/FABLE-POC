<template>
  <div ref="containerRef" class="log-stream">
    <div
      v-for="log in logs"
      :key="log.id"
      class="log-stream__entry"
      :class="`log-stream__entry--${log.level}`"
    >
      <span class="log-stream__time">{{ formatTime(log.timestamp) }}</span>
      <span class="log-stream__level">[{{ log.level.toUpperCase() }}]</span>
      <span class="log-stream__message">{{ log.message }}</span>
    </div>
    <div v-if="!logs.length" class="log-stream__empty">
      No logs yet
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { LogEntry } from 'src/types';

const props = defineProps<{
  logs: LogEntry[];
}>();

const containerRef = ref<HTMLElement>();

// Auto-scroll to bottom when new logs arrive
watch(
  () => props.logs.length,
  async () => {
    await nextTick();
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight;
    }
  }
);

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString();
}
</script>

<style lang="scss" scoped>
.log-stream {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 12px 16px;
  background: var(--ff-bg-primary);

  &__entry {
    display: flex;
    gap: 8px;
    padding: 2px 0;
    line-height: 1.4;

    &--info {
      color: var(--ff-text-secondary);
    }

    &--warn {
      color: #eab308;
    }

    &--error {
      color: #ef4444;
    }
  }

  &__time {
    color: var(--ff-text-muted);
    flex-shrink: 0;
  }

  &__level {
    flex-shrink: 0;
    width: 60px;
  }

  &__message {
    word-break: break-all;
  }

  &__empty {
    color: var(--ff-text-muted);
    text-align: center;
    padding: 20px;
  }
}
</style>
