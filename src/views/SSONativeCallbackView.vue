<script setup>
import { onMounted } from 'vue'
import AppCard from '../components/AppCard.vue'

// Landing spot for the native app's OAuth round-trip. Clerk only accepts
// http(s) redirect targets from web-mode clients, so the system browser is
// sent here first; this page forwards everything — including Clerk's query
// parameters — to the deep link the Android app listens on (famcart://
// sso-callback: keep in sync with nativeOAuth.ts and AndroidManifest.xml).
const target = `famcart://sso-callback${window.location.search}`

onMounted(() => {
  // Auto-hop into the app. Some browsers refuse custom-scheme navigations
  // that lack a user gesture; the button below is the one-tap fallback.
  window.location.replace(target)
})
</script>

<template>
  <div class="sso-native-page">
    <AppCard variant="narrow">
      <div class="sso-native-content">
        <h1 class="sso-native-title">Almost there</h1>
        <p class="sso-native-text">Taking you back to the FamCart app…</p>
        <a class="sso-native-open" :href="target">Open FamCart</a>
      </div>
    </AppCard>
  </div>
</template>

<style scoped>
.sso-native-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(1rem + var(--safe-top)) 1rem calc(1rem + var(--safe-bottom));
  /* Same branded backdrop as the login and offline screens. */
  background-color: var(--color-primary-bg);
  background-image: url('/screen.webp');
  background-size: auto 100%;
  background-position: center;
  background-repeat: repeat-x;
}

.sso-native-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
}

.sso-native-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.sso-native-text {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.sso-native-open {
  margin-top: var(--space-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.4rem;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: var(--text-inverse);
  font-weight: 700;
  font-size: 0.9rem;
  text-decoration: none;
  box-shadow: var(--elevation-primary);
}
</style>
