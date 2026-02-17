<template>
  <div class="result-renderer">
    <!-- Cards display -->
    <div v-if="displayType === 'cards' && cardDefs.length" class="result-renderer__cards">
      <div v-for="card in cardDefs" :key="card.field" class="result-renderer__card">
        <q-icon v-if="card.icon" :name="card.icon" size="24px" color="purple" class="result-renderer__card-icon" />
        <div class="result-renderer__card-label">{{ card.label }}</div>
        <div class="result-renderer__card-value">{{ formatValue(getField(card.field), card.format) }}</div>
      </div>
    </div>

    <!-- Table display -->
    <q-table
      v-else-if="displayType === 'table' && tableColumns.length"
      :rows="tableRows"
      :columns="tableColumns"
      dark
      flat
      bordered
      dense
      class="result-renderer__table"
      hide-bottom
    />

    <!-- Text display -->
    <div v-else-if="displayType === 'text'" class="result-renderer__text">
      {{ typeof result === 'string' ? result : JSON.stringify(result, null, 2) }}
    </div>

    <!-- JSON fallback -->
    <pre v-else class="result-renderer__json">{{ JSON.stringify(result, null, 2) }}</pre>

    <!-- Summary template -->
    <div v-if="summary" class="result-renderer__summary">{{ summary }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolUIDefinition } from 'src/types';

const props = defineProps<{
  result: unknown;
  uiDefinition?: ToolUIDefinition;
}>();

const displayType = computed(() => props.uiDefinition?.resultDisplay?.type || 'json');

const cardDefs = computed(() => props.uiDefinition?.resultDisplay?.cards || []);

const tableColumns = computed(() => {
  const cols = props.uiDefinition?.resultDisplay?.columns || [];
  return cols.map(c => ({
    name: c.key,
    label: c.label,
    field: c.key,
    align: 'left' as const,
    sortable: true,
  }));
});

const tableRows = computed(() => {
  if (Array.isArray(props.result)) return props.result;
  if (typeof props.result === 'object' && props.result !== null) return [props.result];
  return [];
});

const summary = computed(() => {
  const template = props.uiDefinition?.resultDisplay?.summaryTemplate;
  if (!template || typeof props.result !== 'object' || !props.result) return '';
  let text = template;
  const obj = props.result as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    text = text.replace(`{{${key}}}`, String(val));
  }
  return text;
});

function getField(field: string): unknown {
  if (typeof props.result !== 'object' || !props.result) return undefined;
  return (props.result as Record<string, unknown>)[field];
}

function formatValue(val: unknown, format?: string): string {
  if (val === null || val === undefined) return '-';
  switch (format) {
    case 'number':
      return typeof val === 'number' ? val.toLocaleString() : String(val);
    case 'percent':
      return typeof val === 'number' ? `${val}%` : String(val);
    case 'badge':
      return String(val).toUpperCase();
    default:
      return String(val);
  }
}
</script>

<style lang="scss" scoped>
.result-renderer {
  &__cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }

  &__card {
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-md);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__card-icon {
    margin-bottom: 4px;
  }

  &__card-label {
    font-size: 12px;
    color: var(--ff-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  &__card-value {
    font-size: 24px;
    font-weight: 600;
    color: var(--ff-text-primary);
  }

  &__table {
    background: var(--ff-bg-card);
  }

  &__text {
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-md);
    padding: 16px;
    white-space: pre-wrap;
    font-size: 14px;
    color: var(--ff-text-primary);
    line-height: 1.6;
  }

  &__json {
    background: var(--ff-bg-card);
    border: 1px solid var(--ff-border);
    border-radius: var(--ff-radius-md);
    padding: 16px;
    overflow-x: auto;
    font-size: 13px;
    color: var(--ff-teal);
    line-height: 1.5;
  }

  &__summary {
    margin-top: 12px;
    font-size: 14px;
    color: var(--ff-text-secondary);
    font-style: italic;
  }
}
</style>
