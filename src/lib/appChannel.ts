// Which build this is, and how the app says so on screen.
//
// FamCart ships from one codebase to two places: the production app, wired to
// the `famcart` Supabase project, and the nightly one, wired to `famcart-dev`.
// Until this module existed the two were pixel-identical, so a screenshot, a
// bug report or a phone left on a desk could not tell you which database it
// had been talking to. Worse, the failure was silent in the dangerous
// direction: a production build accidentally pointing at dev looked exactly
// like the real thing.
//
// So the channel is derived from what the build is actually connected to
// rather than declared, and it is safe by default in both directions. Only the
// exact production project ref, or an explicit `production` override, produces
// an unmarked build. Everything else wears the badge.

export type AppChannel = 'production' | 'nightly'

// The `famcart` project. Public: this ref is half of VITE_SUPABASE_URL, which
// ships in every bundle. Hardcoding it is the point, since the URL it is
// compared against is exactly the thing that might be wrong.
export const PRODUCTION_PROJECT_REF = 'qwpyiperbjaeykrvilhf'

// Indigo, as far from the brand green as the palette gets while still looking
// deliberate. Used for the nightly status bar and PWA chrome; the in-page
// tokens live in style.css under :root[data-channel='nightly'].
export const NIGHTLY_THEME_COLOR = '#5b5bd6'

/** The project ref out of a Supabase URL, or '' if it is not one. */
export function projectRefFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.split('.')[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * Pure so it can be tested; the constants below are the one real call.
 *
 * `channel` is VITE_APP_CHANNEL, the escape hatch for builds whose database
 * says nothing useful about them: a Vercel preview of a production-wired
 * branch, or the nightly APK flavour when that arrives.
 */
export function resolveChannel(env: {
  channel?: string
  supabaseUrl?: string
  dev?: boolean
}): AppChannel {
  const override = (env.channel ?? '').trim().toLowerCase()
  if (override) return override === 'production' ? 'production' : 'nightly'
  // The dev server is nightly even when someone has pointed it at production,
  // because an unbuilt, hot-reloading page is never the production app.
  if (env.dev) return 'nightly'
  return projectRefFromUrl(env.supabaseUrl) === PRODUCTION_PROJECT_REF ? 'production' : 'nightly'
}

export const SUPABASE_PROJECT_REF = projectRefFromUrl(import.meta.env.VITE_SUPABASE_URL)

export const APP_CHANNEL: AppChannel = resolveChannel({
  channel: import.meta.env.VITE_APP_CHANNEL,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  dev: import.meta.env.DEV,
})

export const IS_NIGHTLY = APP_CHANNEL === 'nightly'

/**
 * Stamp the channel on the root element and, on nightly, repaint the browser
 * chrome to match.
 *
 * Called from main.ts before mount, alongside the theme, and for the same
 * reason: `[data-channel]` in style.css re-points the brand tokens, so doing
 * this later would show a green frame before the indigo one.
 *
 * The theme-color meta is rewritten rather than duplicated per channel,
 * because index.html is one file serving both builds. It drives the Android
 * status bar and the installed PWA's title bar, which is the difference
 * between a badge inside the app and a phone that looks different from the
 * lock screen on.
 */
export function applyChannel(): void {
  document.documentElement.setAttribute('data-channel', APP_CHANNEL)
  if (!IS_NIGHTLY) return
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', NIGHTLY_THEME_COLOR)
}
