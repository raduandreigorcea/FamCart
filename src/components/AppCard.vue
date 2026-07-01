<script setup>
defineProps({
  // 'default' → setup-card style, 'narrow' → login-card style
  variant: { type: String, default: 'default' },
})
</script>

<template>
  <div class="app-card" :class="`app-card--${variant}`">
    <slot />
  </div>
</template>

<style scoped>
.app-card {
  width: 100%;
  background: var(--bg-surface);
  border-radius: var(--radius-4xl);
  padding: 2.25rem var(--space-8) var(--space-8);
  box-shadow: var(--elevation-card);
  position: relative;
  z-index: 1;
}

.app-card--default {
  max-width: 400px;
}

.app-card--narrow {
  max-width: 340px;
  border-radius: var(--radius-3xl);
  padding: var(--space-8) var(--space-7) var(--space-7);
  box-shadow: var(--elevation-card-strong);
}
</style>
