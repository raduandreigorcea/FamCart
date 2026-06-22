<script setup>
import { AuthenticateWithRedirectCallback } from '@clerk/vue'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <AuthenticateWithRedirectCallback
    :after-sign-in-url="'/'"
    :after-sign-up-url="'/'"
  />
</template>
