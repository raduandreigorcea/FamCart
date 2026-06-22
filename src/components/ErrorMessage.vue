<script setup>
defineProps({ message: String })
</script>

<template>
  <p v-if="message" class="error-msg">{{ message }}</p>
</template>

<style scoped>
.error-msg {
  font-size: 0.8rem;
  color: #c0392b;
  margin: 0;
  padding: 0.45rem 0.75rem;
  background: #fdf3f2;
  border-radius: 8px;
  border: 1px solid #f5c6c2;
}
</style>
