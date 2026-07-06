import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import './style.css'
import App from './App.vue'
import router from './router'

const savedTheme = localStorage.getItem('famcart-theme')
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', savedTheme)
} else {
  document.documentElement.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light')
}

const app = createApp(App)

app.use(clerkPlugin, {
  publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
})

app.use(router)
app.mount('#app')
