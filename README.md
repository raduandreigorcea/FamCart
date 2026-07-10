# FamCart

Shared family shopping list app built with Vue 3, Clerk auth, and Supabase.

## Live updates

FamCart supports WebSockets via Supabase Realtime so every family member sees list and member updates immediately.

## Android APK

`npm run build:apk` builds the web app, syncs it into the Capacitor Android
project, and compiles a debug APK (requires Android Studio for its SDK/JDK).
The output path is printed at the end:
`android/app/build/outputs/apk/debug/app-debug.apk` — copy it to a phone and
open it to install.

## Push notifications

The account-menu notification toggle subscribes the browser to Web Push; the
`push-on-item-insert` edge function notifies family members when someone adds
an item, even with the app closed. One-time setup per environment:

1. Generate VAPID keys: `npx web-push generate-vapid-keys`
2. Client env: set `VITE_VAPID_PUBLIC_KEY=<public key>` (no key = toggle stays
   local-only, nothing breaks).
3. Function secrets:
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=<random string>`
4. Deploy: `supabase functions deploy push-on-item-insert`
5. In the Supabase dashboard, create a Database Webhook on
   `shopping_list_items` / INSERT calling the `push-on-item-insert` function
   URL, with an HTTP header `x-webhook-secret: <the same random string>`.

