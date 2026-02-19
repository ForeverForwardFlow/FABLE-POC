<template>
  <div class="tool-use-block" :class="{ 'tool-use-block--pending': toolUse.approvalStatus === 'pending' }">
    <div class="tool-header" @click="expanded = !expanded">
      <q-icon :name="expanded ? 'expand_less' : 'build'" class="tool-icon" />
      <span class="tool-name">{{ toolUse.toolName }}</span>

      <span class="tool-spacer" />

      <span v-if="toolUse.approvalStatus === 'pending'" class="tool-status pending">
        <q-icon name="shield" size="16px" />
        Approval needed
      </span>
      <span v-else-if="toolUse.approvalStatus === 'denied'" class="tool-status denied">
        <q-icon name="block" size="16px" />
        Denied
      </span>
      <span v-else-if="toolUse.result" class="tool-status done">
        <q-icon name="check_circle" size="16px" />
        Done
      </span>
      <span v-else class="tool-status running">
        <q-spinner-dots size="16px" />
        Running
      </span>

      <q-icon :name="expanded ? 'expand_less' : 'expand_more'" class="expand-icon" />
    </div>

    <!-- Approval action bar -->
    <div v-if="toolUse.approvalStatus === 'pending'" class="tool-approval">
      <div v-if="toolUse.description" class="tool-approval-desc">{{ toolUse.description }}</div>
      <div class="tool-approval-actions">
        <q-btn flat dense no-caps size="sm" color="positive" icon="check" label="Allow" @click.stop="$emit('approve', toolUse.toolName, false)" />
        <q-btn flat dense no-caps size="sm" color="primary" icon="verified" label="Always Allow" @click.stop="$emit('approve', toolUse.toolName, true)" />
        <q-btn flat dense no-caps size="sm" color="negative" icon="block" label="Deny" @click.stop="$emit('deny', toolUse.toolName)" />
      </div>
    </div>

    <div v-show="expanded" class="tool-content">
      <template v-if="toolUse.input">
        <div class="tool-section-label">Parameters</div>
        <pre class="tool-params"><code>{{ formattedInput }}</code></pre>
      </template>

      <template v-if="toolUse.result">
        <div class="tool-section-label">Result</div>
        <pre class="tool-result"><code>{{ formattedResult }}</code></pre>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ToolUse } from 'src/types';

const props = defineProps<{
  toolUse: ToolUse;
}>();

defineEmits<{
  (e: 'approve', toolName: string, always: boolean): void;
  (e: 'deny', toolName: string): void;
}>();

const expanded = ref(false);

const formattedInput = computed(() =>
  props.toolUse.input ? JSON.stringify(props.toolUse.input, null, 2) : ''
);

const formattedResult = computed(() => {
  if (!props.toolUse.result) return '';
  if (typeof props.toolUse.result === 'string') {
    try {
      return JSON.stringify(JSON.parse(props.toolUse.result), null, 2);
    } catch {
      return props.toolUse.result;
    }
  }
  return JSON.stringify(props.toolUse.result, null, 2);
});
</script>

<style lang="scss" scoped>
.tool-use-block {
  border: 1px solid var(--ff-border, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 8px;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: var(--ff-border-light, rgba(255, 255, 255, 0.12));
  }
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.2s ease;

  &:hover {
    background: rgba(168, 85, 247, 0.08);
  }
}

.tool-icon {
  color: var(--ff-purple, #a855f7);
  font-size: 18px;
}

.tool-name {
  font-weight: 600;
  color: var(--ff-text-primary, #fff);
  font-size: 0.85rem;
}

.tool-spacer {
  flex: 1;
}

.tool-use-block--pending {
  border-color: rgba(251, 191, 36, 0.3);
}

.tool-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  font-weight: 500;

  &.running {
    color: var(--ff-teal, #14b8a6);
  }

  &.done {
    color: #4caf50;
  }

  &.pending {
    color: #fbbf24;
  }

  &.denied {
    color: #ef4444;
  }
}

.tool-approval {
  padding: 10px 14px;
  border-top: 1px solid rgba(251, 191, 36, 0.15);
  background: rgba(251, 191, 36, 0.05);
}

.tool-approval-desc {
  color: var(--ff-text-secondary, #a1a1aa);
  font-size: 0.78rem;
  margin-bottom: 8px;
}

.tool-approval-actions {
  display: flex;
  gap: 8px;
}

.expand-icon {
  color: var(--ff-text-muted, #71717a);
  font-size: 18px;
}

.tool-content {
  padding: 12px 14px;
  font-size: 0.8rem;
  border-top: 1px solid var(--ff-border, rgba(255, 255, 255, 0.08));
}

.tool-section-label {
  color: var(--ff-text-muted, #71717a);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  margin-top: 8px;

  &:first-child {
    margin-top: 0;
  }
}

.tool-params,
.tool-result {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-radius: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  color: var(--ff-text-secondary, #a1a1aa);
  max-height: 300px;
  overflow-y: auto;
}
</style>
