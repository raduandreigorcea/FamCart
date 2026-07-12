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

Push is delivered by OneSignal on both the web app (Web SDK v16, worker under
`/onesignal/`) and the Android app (`@onesignal/capacitor-plugin`). The
account-menu toggle opts the device in/out and ties it to the Clerk user id
via `OneSignal.login`; the `push-on-item-insert` edge function notifies family
members through OneSignal's REST API when someone adds an item, even with the
app closed. One-time setup per environment:

1. Create an app at onesignal.com. Activate the **Web** platform (site URL =
   where FamCart is hosted) and, for the Android app, the **Google Android**
   platform (upload the Firebase service-account JSON there).
2. Client env: set `VITE_ONESIGNAL_APP_ID=<app id>` (no id = toggle stays
   local-only, nothing breaks).
3. Function secrets, from the dashboard's Keys & IDs page:
   `supabase secrets set ONESIGNAL_APP_ID=... ONESIGNAL_REST_API_KEY=... PUSH_WEBHOOK_SECRET=<random string>`
4. Deploy: `supabase functions deploy push-on-item-insert`
5. In the Supabase dashboard, create two Database Webhooks — one on
   `shopping_list_items` / INSERT ("X added Milk") and one on
   `purchase_history` / INSERT ("X bought Milk and 2 more") — both calling the
   `push-on-item-insert` function URL with an HTTP header
   `x-webhook-secret: <the same random string>`.

