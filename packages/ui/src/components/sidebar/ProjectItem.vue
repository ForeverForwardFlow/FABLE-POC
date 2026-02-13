<template>
  <div class="project-item" @click="$emit('click')">
    <q-icon :name="statusIcon" :color="statusColor" size="18px" />
    <span class="project-item__name">{{ project.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Project, BuildStatus } from 'src/types';

const props = defineProps<{
  project: Project;
}>();

defineEmits<{
  (e: 'click'): void;
}>();

const statusIcons: Record<BuildStatus, string> = {
  planning: 'hourglass_empty',
  building: 'sync',
  testing: 'science',
  deploying: 'cloud_upload',
  complete: 'check_circle',
  error: 'error'
};

const statusColors: Record<BuildStatus, string> = {
  planning: 'blue',
  building: 'purple',
  testing: 'teal',
  deploying: 'orange',
  complete: 'green',
  error: 'red'
};

const statusIcon = computed(() => statusIcons[props.project.status] || 'help');
const statusColor = computed(() => statusColors[props.project.status] || 'grey');
</script>

<style lang="scss" scoped>
.project-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--ff-radius-sm);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--ff-bg-tertiary);
  }

  &__name {
    font-size: 14px;
    color: var(--ff-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
