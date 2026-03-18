# Clerk Vue App

This project is a Vue 3 + Vite app with Clerk authentication already wired in.

## Setup

1. Create a Clerk application in the Clerk dashboard.
2. Copy your Clerk publishable key.
3. Put it in `.env` as:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The current `.env` value should be replaced with your real Clerk key if you want the app to authenticate against your account.

## Run

```bash
npm install
npm run dev
```

## What the app includes

- Embedded Clerk sign-in flow.
- Family creation and joining backed by Supabase.
- Shared shopping list CRUD for all family members.
- Open Food Facts search suggestions for adding products quickly.

## Build

```bash
npm run build
```
