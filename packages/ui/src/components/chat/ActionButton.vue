<template>
  <button :class="buttonClass" @click="$emit('click', action)">
    {{ action.label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Action } from 'src/types';

const props = defineProps<{
  action: Action;
}>();

defineEmits<{
  (e: 'click', action: Action): void;
}>();

const buttonClass = computed(() => {
  switch (props.action.type) {
    case 'primary':
      return 'ff-btn-primary';
    case 'secondary':
      return 'ff-btn-secondary';
    case 'link':
      return 'action-link';
    default:
      return 'ff-btn-secondary';
  }
});
</script>

<style lang="scss" scoped>
.action-link {
  background: none;
  border: none;
  color: var(--ff-purple);
  cursor: pointer;
  padding: 8px 12px;
  font-weight: 500;

  &:hover {
    text-decoration: underline;
  }
}
</style>
