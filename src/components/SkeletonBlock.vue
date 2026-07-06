<script setup>
defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '1rem' },
  radius: { type: String, default: 'var(--radius-xs)' },
})
</script>

<template>
  <span
    class="skeleton"
    :style="{ width, height, borderRadius: radius }"
    aria-hidden="true"
  ></span>
</template>

<style scoped>
.skeleton {
  display: inline-block;
  flex-shrink: 0;
  background: linear-gradient(
    90deg,
    var(--bg-hover) 25%,
    color-mix(in srgb, var(--bg-hover) 45%, var(--bg-surface)) 37%,
    var(--bg-hover) 63%
  );
  background-size: 400% 100%;
  animation: skeleton-shimmer 1.4s ease infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
