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

