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
  background: #fff;
  border-radius: 24px;
  padding: 2.25rem 2rem 2rem;
  box-shadow: 0 2px 24px rgba(0, 0, 0, 0.06), 0 1px 4px rgba(0, 0, 0, 0.04);
  position: relative;
  z-index: 1;
}

.app-card--default {
  max-width: 400px;
}

.app-card--narrow {
  max-width: 340px;
  border-radius: 20px;
  padding: 2rem 1.75rem 1.75rem;
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.07);
}
</style>
