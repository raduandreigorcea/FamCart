<script setup lang="ts">
// Clerk's component owns the redirect entirely (the after-sign-in/up URLs
// below), so this view has no navigation of its own to do.
import { AuthenticateWithRedirectCallback } from '@clerk/vue'
</script>

<template>
  <AuthenticateWithRedirectCallback
    :after-sign-in-url="'/'"
    :after-sign-up-url="'/'"
  />
</template>
