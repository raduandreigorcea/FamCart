<script setup>
import ConfirmModal from './ConfirmModal.vue'

// The app's single error surface: every failure message pops this dialog.
// Opens whenever `message` is non-empty; dismiss must clear it in the parent.
defineProps({
  title: { type: String, default: 'Something went wrong' },
  message: { type: String, default: '' },
})

const emit = defineEmits(['dismiss'])
</script>

<template>
  <ConfirmModal
    :open="!!message"
    tone="danger"
    :title="title"
    :message="message"
    confirm-text="OK"
    :show-cancel="false"
    @confirm="emit('dismiss')"
    @cancel="emit('dismiss')"
  />
</template>
