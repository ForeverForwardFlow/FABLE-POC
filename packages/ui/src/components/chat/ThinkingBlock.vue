<template>
  <div class="thinking-block">
    <div class="thinking-block__dots">
      <span class="thinking-block__dot" />
      <span class="thinking-block__dot" />
      <span class="thinking-block__dot" />
    </div>
    <span class="thinking-block__label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label?: string;
}>(), {
  label: 'Thinking...',
});
</script>

<style lang="scss" scoped>
.thinking-block {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;

  &__dots {
    display: flex;
    gap: 4px;
  }

  &__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ff-purple, #a855f7);
    animation: thinking-pulse 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: 0s; }
    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }

  &__label {
    font-size: 13px;
    color: var(--ff-text-muted);
    font-style: italic;
  }
}

@keyframes thinking-pulse {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
