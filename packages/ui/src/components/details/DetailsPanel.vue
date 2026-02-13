<template>
  <div class="details-panel">
    <button class="details-panel__header" @click="uiStore.toggleDetails">
      <span>Build Details</span>
      <q-icon :name="uiStore.detailsExpanded ? 'expand_less' : 'expand_more'" />
    </button>
    <div v-show="uiStore.detailsExpanded" class="details-panel__content">
      <div class="details-panel__tabs">
        <button class="details-panel__tab details-panel__tab--active">Logs</button>
      </div>
      <LogStream :logs="chatStore.logs" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from 'src/stores/ui-store';
import { useChatStore } from 'src/stores/chat-store';
import LogStream from './LogStream.vue';

const uiStore = useUIStore();
const chatStore = useChatStore();
</script>

<style lang="scss" scoped>
.details-panel {
  border-top: 1px solid var(--ff-border);
  background: var(--ff-bg-secondary);

  &__header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: none;
    border: none;
    color: var(--ff-text-secondary);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;

    &:hover {
      color: var(--ff-text-primary);
    }
  }

  &__content {
    border-top: 1px solid var(--ff-border);
  }

  &__tabs {
    display: flex;
    padding: 8px 16px;
    gap: 8px;
  }

  &__tab {
    background: none;
    border: none;
    padding: 6px 12px;
    color: var(--ff-text-muted);
    cursor: pointer;
    border-radius: var(--ff-radius-sm);

    &--active {
      background: var(--ff-bg-tertiary);
      color: var(--ff-text-primary);
    }
  }
}
</style>
