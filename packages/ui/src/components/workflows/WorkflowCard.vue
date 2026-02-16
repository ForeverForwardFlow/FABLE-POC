<template>
  <q-card class="workflow-card" flat bordered>
    <q-card-section>
      <div class="workflow-card__header">
        <div class="workflow-card__info">
          <div class="workflow-card__name">{{ workflow.name }}</div>
          <div class="workflow-card__description">{{ workflow.description }}</div>
        </div>
        <q-badge
          :color="statusColor"
          :label="workflow.status"
          class="workflow-card__badge"
        />
      </div>

      <div class="workflow-card__meta">
        <div class="workflow-card__trigger">
          <q-icon :name="workflow.trigger.type === 'cron' ? 'schedule' : 'play_arrow'" size="16px" />
          <span>{{ triggerLabel }}</span>
        </div>
        <div v-if="workflow.tools?.length" class="workflow-card__tools">
          <q-icon name="build" size="16px" />
          <span>{{ workflow.tools.join(', ') }}</span>
        </div>
        <div v-if="workflow.executionCount" class="workflow-card__executions">
          <q-icon name="loop" size="16px" />
          <span>{{ workflow.executionCount }} runs</span>
        </div>
      </div>
    </q-card-section>

    <q-separator dark />

    <q-card-actions align="right">
      <q-btn
        flat
        no-caps
        size="sm"
        icon="delete_outline"
        color="grey"
        @click="$emit('delete', workflow)"
      >
        <q-tooltip>Delete workflow</q-tooltip>
      </q-btn>
      <q-btn
        flat
        no-caps
        size="sm"
        :label="workflow.status === 'active' ? 'Pause' : 'Resume'"
        :icon="workflow.status === 'active' ? 'pause' : 'play_arrow'"
        color="grey"
        @click="$emit('toggle-pause', workflow)"
      />
      <q-btn
        flat
        no-caps
        size="sm"
        label="Run Now"
        icon="play_circle"
        color="purple"
        :disable="workflow.status === 'paused'"
        @click="$emit('run', workflow)"
      />
    </q-card-actions>
  </q-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { WorkflowDefinition } from 'src/types';

const props = defineProps<{
  workflow: WorkflowDefinition;
}>();

defineEmits<{
  run: [workflow: WorkflowDefinition];
  'toggle-pause': [workflow: WorkflowDefinition];
  delete: [workflow: WorkflowDefinition];
}>();

const statusColor = computed(() => {
  switch (props.workflow.status) {
    case 'active': return 'positive';
    case 'paused': return 'warning';
    default: return 'grey';
  }
});

const triggerLabel = computed(() => {
  if (props.workflow.trigger.type === 'cron') {
    return `Scheduled: ${props.workflow.trigger.schedule || 'custom'}`;
  }
  return 'Manual trigger';
});
</script>

<style lang="scss" scoped>
.workflow-card {
  background: var(--ff-bg-card);
  border-color: var(--ff-border);
  border-radius: var(--ff-radius-md);

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  &__info {
    flex: 1;
  }

  &__name {
    font-size: 16px;
    font-weight: 600;
    color: var(--ff-text-primary);
    margin-bottom: 4px;
  }

  &__description {
    font-size: 13px;
    color: var(--ff-text-secondary);
  }

  &__badge {
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  &__meta {
    display: flex;
    gap: 16px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  &__trigger,
  &__tools,
  &__executions {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--ff-text-muted);
  }
}
</style>
