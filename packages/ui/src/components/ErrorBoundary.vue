<template>
  <div v-if="error" class="error-boundary">
    <q-icon name="warning" size="32px" color="amber" />
    <p class="error-boundary__message">Something went wrong</p>
    <p class="error-boundary__detail">{{ error.message }}</p>
    <q-btn flat dense color="purple" label="Try again" @click="reset" />
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';

const error = ref<Error | null>(null);

onErrorCaptured((err: Error) => {
  console.error('[ErrorBoundary] Caught error:', err);
  error.value = err;
  return false; // Prevent propagation
});

function reset() {
  error.value = null;
}
</script>

<style lang="scss" scoped>
.error-boundary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  gap: 8px;
  min-height: 120px;

  &__message {
    font-size: 16px;
    font-weight: 500;
    color: var(--ff-text-primary);
    margin: 0;
  }

  &__detail {
    font-size: 13px;
    color: var(--ff-text-secondary);
    margin: 0;
    max-width: 400px;
    text-align: center;
  }
}
</style>
