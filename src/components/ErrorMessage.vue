<script setup>
defineProps({ message: String })
</script>

<template>
  <p v-if="message" class="error-msg">{{ message }}</p>
</template>

<style scoped>
.error-msg {
  font-size: 0.8rem;
  color: var(--danger-text);
  margin: 0;
  padding: 0.45rem var(--space-3);
  background: var(--danger-bg);
  border-radius: var(--radius-sm);
  border: 1px solid var(--danger-border);
}
</style>
