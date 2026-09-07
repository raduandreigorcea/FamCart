# A bottom bar for the list screen

Date: 2026-09-07
Status: agreed, not yet implemented

## What this changes

The list screen is the app. Everything else (checkout history, household
settings, your account, app settings, report an issue) is a dialog opened from
the fixed 72px topbar, and adding an item is an inline field pinned above the
list that expands into a fullscreen search.

On a phone that spends the two scarcest resources badly. The topbar costs 72px
plus the status bar strip permanently, so that three buttons can sit at the top
of a screen held at the bottom; the add field costs another ~64px above the fold
to hold a control the user touches once per item.

This replaces both with one fixed bottom bar of five slots. The bar is not a tab
bar: nothing in it is ever the current page, because there is only one page. It
is an action bar, so no slot ever paints a selected state.

    Household   History   [ Add ]   (empty)   Profile

Slot four is deliberately empty for now. The bar is built for five so that
filling it later moves nothing.

## The shell

Under 900px there is no top chrome at all. The household emoji, name and the
item count become a heading at the top of the list content, which scrolls away
with it. The heading is context, not a control: the way into household settings
is the bar's first slot, so the heading has no click target and no press state.
Two doors to one room is what the topbar was.

At 900px and above the existing topbar layout returns and the bar hides. That
boundary already exists in the codebase for `--desktop-column`.

Two breakpoints are in play and they must stay distinct:

- 900px is the shell boundary (bar versus topbar), matching `--desktop-column`.
- 599.98px is `PHONE_QUERY` in `usePhoneSearchScreen`, which decides whether the
  search is a screen or a dropdown. The add flow section below removes that
  split, so the constant goes away rather than gaining a second meaning.

## The bar

    +--------------------------------------------------+
    |                                                  |
    |   HH          ic         (  +  )           AV    |
    |                                                  |
    | Household   History       Add            You     |
    +--------------------------------------------------+
      66px + safe-bottom, five equal cells, one baseline

Two of the five marks are identity rather than iconography, and that is what
keeps this from being a bar any app could ship:

- **Household** draws the household's own emoji, the one already chosen in
  settings and already rendered by the topbar today through
  `DEFAULT_HOUSEHOLD_EMOJI`. It also answers "which household" for an account
  that belongs to more than one.
- **Profile** draws the user's Clerk avatar image, with the same initial
  fallback the topbar uses now.
- **History** is `history.svg` through `AppIcon`.
- **Add** is a filled disc, described below.

### Sizes

| Thing | Value |
|---|---|
| Bar content height | 66px, plus `var(--safe-bottom)` as padding |
| Cell | `flex: 1`, minimum tap target 48x48 |
| Small icon / emoji / avatar | 24px |
| Label | `--text-2xs`, `--weight-semibold`, `--leading-tight` |
| Gap, icon to label | 3px |
| Add disc | 48px, `+` glyph 26px |

The disc stays **inside** the bar's top edge. No notch, no cutout, no protruding
FAB. The app's vocabulary is already a solid green knob riding a neutral track
(`.buy-bar__thumb`), and reusing that beats borrowing Material's cutout, which
is also the shape that would have collided with the checkout slider. The disc's
label sits on the same baseline as the other four, so the bar is one grid with a
single exception in it.

### Colour and type

Everything comes from the existing tokens. No new palette: inventing one for a
single bar in an established app would read as wrong rather than as designed.

- Bar surface `--bg-surface`, hairline top border `--border-main`.
- Icons and labels `--text-secondary`.
- Add disc `--color-primary`, glyph `--text-inverse`, `--elevation-primary`.
- Labels are sentence case, no tracking, no caps.

The disc is the only saturated thing along the bottom edge of the screen.
Nothing else in the bar is coloured.

Nightly repaints the disc indigo for free, because it re-points
`--color-primary`. The NIGHTLY badge loses its home when the topbar goes; it
moves into the scrolling heading beside the household name.

### States

Press states copy `AppTopbar`'s existing rule verbatim rather than inventing a
second one: `--bg-press` background, `scale(0.92)`, `transition-duration: 0s`
going in and `--transition-fast` coming out, and `transform: none` under
`prefers-reduced-motion`. The disc presses to `scale(0.94)` and its shadow
tightens.

Nothing in the bar animates on its own. It does not slide in on load and it does
not hide on scroll.

### Accessibility

- `<nav>` with `aria-label` from a new `nav.label` key.
- Each button carries `aria-haspopup="dialog"` and `aria-expanded` bound to the
  dialog it owns.
- The visible labels are the accessible names for the four small slots. The
  disc's visible label is "Add" and its `aria-label` carries the fuller "Add an
  item", so the short label does not have to do both jobs.
- The empty fourth slot renders an empty cell, not a disabled button. A disabled
  control is a promise; a gap is not.

## The add flow

`AddItemForm` has two modes today. Above 600px it is an inline field with a
dropdown. Below it, focusing the field runs a FLIP through
`usePhoneSearchScreen`: the slot's height is frozen so the list does not jump,
the field's row is translated back to where it started, and the browser animates
the release.

With no inline field there is no origin to lift from, so the search becomes what
it should have been: **a sheet that rises from the bottom edge**, at every width,
full screen on a phone and a centred sheet on desktop. That is where the keyboard
comes from, and the app already owns the motion (`--modal-rise: 100%` with the
shared `modal-rise-in` keyframes in `style.css`).

The consequences are all simplifications:

- `usePhoneSearchScreen` loses `slotStyle`, `slideFrom`, `stopSlide`,
  `onSlideEnd`, `slideTimer`, `SLIDE_TIMEOUT_MS` and both template refs.
- It keeps `measureScreen()` and the `visualViewport` listeners. That is the
  genuinely hard part (Android resizes the WebView and keeps `offsetTop` at 0,
  iOS does neither) and it is still needed to know where the keyboard starts.
- `PHONE_QUERY` and the `add-form--expanded` versus inline split both go, along
  with the inline dropdown CSS in `AddItemForm`.
- `expanded` stops being driven by focus and starts being driven by the bar.
  `HomeView` already owns `searchExpanded` and passes it as a v-model, so the
  Add slot sets that model and nothing new has to be threaded through.

Android Back keeps working with no new wiring: `AddItemForm` already registers
with `lib/modalStack` while expanded, and `handleBackPress` closes the top layer
first.

Barcode scanning stays exactly where it is, as the add button's second face
inside the search sheet while the field is empty. It is a way of adding, not a
peer of Add, which is also why it did not take slot four.

## The checkout slider

`.buy-bar-wrap` is fixed at `bottom: calc(1rem + var(--safe-bottom))` and would
land on top of the bar. It moves up to sit just clear of it:

    bottom: calc(66px + var(--safe-bottom) + 0.5rem)

and takes the bar's surface treatment, so the two read as one bottom assembly
rather than two floating objects stacked by accident. `.buy-bar-spacer` grows
from 84px to cover the bar plus the slider, so the last checked row stays
reachable.

`.dashboard-main` loses its topbar padding under 900px and gains
`padding-bottom: calc(66px + var(--safe-bottom) + 1rem)`.

## Copy

Six new short keys, in all six catalogs. They are new rather than reused because
the existing strings are descriptions, not labels: `topbar.history` is
"Istoricul cumpărăturilor" in Romanian, which cannot sit under a 24px icon.

| Key | en | ro |
|---|---|---|
| `nav.label` | Main actions | Acțiuni principale |
| `nav.household` | Household | Gospodărie |
| `nav.history` | History | Istoric |
| `nav.add` | Add | Adaugă |
| `nav.addLabel` | Add an item | Adaugă un produs |
| `nav.you` | You | Tu |

German "Hinzufügen" is the longest at roughly 62px in 11px semibold, against a
72px cell on a 360px phone. It fits. Labels take `text-overflow: ellipsis`
anyway, since the accessible name is carried by `aria-label`.

`de`, `es`, `fr` and `it` get the same treatment: the shortest honest single
word. The catalog parity test in `test/localeCatalogs.test.js` enforces that
none is forgotten.

## Files

| File | Change |
|---|---|
| `src/components/AppTopbar.vue` | Renamed `AppNavBar.vue`, template and CSS rewritten. Keeps all five modal hosts with their lazy-load and prefetch logic, which is why this is a rename and not a new component. Gains an `add` emit. |
| `src/views/HomeView.vue` | Renders the bar instead of the topbar under 900px, adds the scrolling heading, drops the inline `AddItemForm` from the flow, adjusts `.dashboard-main` padding. |
| `src/components/AddItemForm.vue` | Inline mode deleted. Renders only as a bottom sheet. |
| `src/lib/usePhoneSearchScreen.ts` | FLIP removed, viewport measurement kept. |
| `src/components/ShoppingList.vue` | `.buy-bar-wrap` offset and `.buy-bar-spacer` height. |
| `src/locales/*.ts` | Six catalogs, six new keys each. |
| `test/appTopbar*.component.test.js` | Renamed and retargeted at the bar. |
| `test/addItemForm*.component.test.js` | Four files; the search-screen one changes most. |
| `test/homeView*.component.test.js` | Any that mount the topbar or reach for the inline field. |

## Order of work

Two landings, because the second carries the larger risk and should not hold up
the first.

1. **The bar and the shell.** New `AppNavBar`, the scrolling heading, the
   checkout slider offset, the locale keys. The Add slot focuses the inline
   field, which is still there. Shippable on its own, and the whole bar can be
   looked at before anything about adding changes.
2. **The search sheet.** Delete the inline mode, simplify the composable, point
   the Add slot at the sheet.

## Testing

- The existing suites are the guard: `appTopbarAccount`, `appTopbarChannel`,
  `addItemFormSearchScreen`, `addItemFormBack`, `shoppingListSlider` and the
  `homeView*` set all touch surfaces this moves.
- New assertions worth having: the bar renders the household's emoji rather than
  a generic icon, the fourth cell holds its width without a button, the Add slot
  opens the search, and the checkout slider clears the bar when both are on
  screen.
- `localeCatalogs` covers the six new keys across six files with no new test.

## Deferred

- What fills slot four. Filter is the strongest candidate, since it is the only
  remaining control with real state to show, and moving it would free the list
  header to be just a count.
- Whether the desktop shell should eventually become the bar as well, rather
  than keeping two shells behind a media query.
