<template>
  <div class="fable-progress">
    <div class="fable-progress__fill" :style="{ width: `${progress}%` }" />
  </div>
  <div class="progress-text">{{ progress }}%</div>
</template>

<script setup lang="ts">
defineProps<{
  progress: number;
}>();
</script>

<style lang="scss" scoped>
.progress-text {
  font-size: 12px;
  color: var(--ff-text-muted);
  margin-top: 4px;
  text-align: right;
}
</style>
