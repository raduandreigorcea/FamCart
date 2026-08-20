<script setup lang="ts">
import { computed } from 'vue'
import ConfirmModal from './ConfirmModal.vue'
import { t } from '../lib/i18n'

// The app's single error surface: every failure message pops this dialog.
// Opens whenever `message` is non-empty; dismiss must clear it in the parent.
//
// The default title is resolved below rather than written into the prop
// declaration. defineProps' object literal is evaluated once, when this module
// is first imported, so a t() call inside it would capture whatever language
// was active at that moment and keep it for the life of the page. Empty string
// means "caller said nothing"; the fallback is applied per render.
const props = defineProps({
  title: { type: String, default: '' },
  message: { type: String, default: '' },
})

const resolvedTitle = computed(() => props.title || t('error.genericTitle'))

const emit = defineEmits(['dismiss'])
</script>

<template>
  <ConfirmModal
    :open="!!message"
    tone="danger"
    :title="resolvedTitle"
    :message="message"
    :confirm-text="t('common.ok')"
    :show-cancel="false"
    @confirm="emit('dismiss')"
    @cancel="emit('dismiss')"
  />
</template>
