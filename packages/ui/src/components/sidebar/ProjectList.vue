<template>
  <div class="project-list">
    <div class="project-list__header">
      <span>Projects</span>
      <q-btn flat dense round icon="add" size="sm" />
    </div>
    <div class="project-list__items">
      <ProjectItem
        v-for="project in projects"
        :key="project.id"
        :project="project"
        @click="$emit('select', project)"
      />
      <div v-if="!projects.length" class="project-list__empty">
        No projects yet
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Project } from 'src/types';
import ProjectItem from './ProjectItem.vue';

defineEmits<{
  (e: 'select', project: Project): void;
}>();

// Mock projects for demo
const projects = ref<Project[]>([
  {
    id: '1',
    name: 'Tip Calculator',
    status: 'complete',
    createdAt: new Date().toISOString()
  },
  {
    id: '2',
    name: 'Weather App',
    status: 'building',
    createdAt: new Date().toISOString()
  }
]);
</script>

<style lang="scss" scoped>
.project-list {
  padding: 16px;

  &__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    font-weight: 500;
    color: var(--ff-text-secondary);
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__empty {
    color: var(--ff-text-muted);
    font-size: 14px;
    text-align: center;
    padding: 20px;
  }
}
</style>
