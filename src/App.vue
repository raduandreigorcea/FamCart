<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppSplash from './components/AppSplash.vue'

// The first navigation is async (connectivity check, then Clerk). Show a branded
// splash until it resolves so the app never opens on a blank screen — offline in
// particular, where the guard has real work to do before any route can mount.
const router = useRouter()
const ready = ref(false)
router.isReady().finally(() => { ready.value = true })
</script>

<template>
  <RouterView v-if="ready" />
  <AppSplash v-else />
</template>
