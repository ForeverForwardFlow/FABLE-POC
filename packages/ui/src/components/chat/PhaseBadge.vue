<template>
  <span class="fable-phase" :class="`fable-phase--${status}`">
    {{ statusLabels[status] || status }}
  </span>
</template>

<script setup lang="ts">
import type { BuildStatus } from 'src/types';

defineProps<{
  status: BuildStatus;
}>();

const statusLabels: Record<BuildStatus, string> = {
  planning: 'Planning',
  building: 'Building',
  testing: 'Testing',
  deploying: 'Deploying',
  complete: 'Complete',
  error: 'Error'
};
</script>
