<template>
  <q-card
    class="tool-card cursor-pointer"
    flat
    bordered
    @click="$router.push({ name: 'tool', params: { name: tool.name } })"
  >
    <q-card-section>
      <div class="tool-card__header">
        <q-icon
          :name="iconName"
          size="32px"
          color="purple"
          class="tool-card__icon"
        />
        <div class="tool-card__info">
          <div class="tool-card__title">{{ displayTitle }}</div>
          <div class="tool-card__description">{{ tool.description }}</div>
        </div>
        <q-btn
          flat dense round
          icon="delete_outline"
          size="sm"
          color="grey-6"
          class="tool-card__delete"
          @click.stop="$emit('delete', tool.name)"
        />
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FableTool } from 'src/types';

const props = defineProps<{
  tool: FableTool;
}>();

defineEmits<{
  delete: [name: string];
}>();

const iconName = computed(() => props.tool.uiDefinition?.icon || 'build');
const displayTitle = computed(() => props.tool.uiDefinition?.title || formatName(props.tool.name));

function formatName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
</script>

<style lang="scss" scoped>
.tool-card {
  background: var(--ff-bg-card);
  border-color: var(--ff-border);
  border-radius: var(--ff-radius-md);
  transition: border-color 0.2s, box-shadow 0.2s;

  &:hover {
    border-color: var(--ff-purple);
    box-shadow: var(--ff-glow-purple);
  }

  &__header {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  &__icon {
    flex-shrink: 0;
    margin-top: 2px;
  }

  &__info {
    flex: 1;
    min-width: 0;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin-bottom: 4px;
  }

  &__description {
    font-size: 13px;
    color: var(--ff-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__delete {
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover .tool-card__delete {
    opacity: 1;
  }
}
</style>
