// @vitest-environment happy-dom
//
// Where PopoverMenu puts its panel on a pointer-sized screen.
//
// Below 600px none of this applies: the panel is a bottom sheet and the trigger
// is ignored. At and above it the panel hangs off the button, and it used to
// hang off it in one direction only -- downwards, because both callers at the
// time (the old topbar's household name, and the list filter in the list header)
// sat near the top of the screen.
//
// The household switcher's trigger is in the bottom action bar, which is the
// visible shell right up to 900px. Between the two breakpoints the panel was
// therefore placed 8px below a button already sitting on the bottom edge of the
// screen: entirely off it, so the menu opened and nobody saw it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PopoverMenu from '../src/components/PopoverMenu.vue'

const VIEWPORT_H = 800
const VIEWPORT_W = 700

let realMatchMedia

// A button at a given vertical position, standing in for a real trigger.
function triggerAt({ top, height = 56 }) {
  const el = document.createElement('button')
  el.getBoundingClientRect = () => ({
    top,
    bottom: top + height,
    left: 40,
    right: 104,
    width: 64,
    height,
    x: 40,
    y: top,
  })
  document.body.appendChild(el)
  return el
}

const wrappers = []

// Mounted closed and then opened, because that is the only way it ever happens:
// PopoverMenu measures the trigger in a watcher on `open`, so a menu that was
// already open when it mounted would never have been measured at all.
async function mountMenu(trigger, props = {}) {
  const w = mount(PopoverMenu, {
    props: { modelValue: false, trigger, heading: 'Menu', ...props },
    attachTo: document.body,
  })
  wrappers.push(w)
  await w.setProps({ modelValue: true })
  return w
}

const panelStyle = () => document.querySelector('.popover-panel').getAttribute('style') || ''

beforeEach(() => {
  realMatchMedia = window.matchMedia
  // Pointer-sized: between the sheet breakpoint (600) and the shell one (900),
  // which is the band this file is about.
  window.matchMedia = (q) => ({
    matches: q.includes('min-width: 600px'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })
  window.innerHeight = VIEWPORT_H
  window.innerWidth = VIEWPORT_W
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  window.matchMedia = realMatchMedia
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PopoverMenu placement on a pointer screen', () => {
  it('hangs below a trigger near the top', async () => {
    await mountMenu(triggerAt({ top: 60 }))

    // 60 + 56 + 8.
    expect(panelStyle()).toContain('top: 124px')
    expect(panelStyle()).toContain('bottom: auto')
  })

  // The switcher's trigger. Anchoring below it puts the whole panel past the
  // bottom edge of the screen.
  it('hangs above a trigger sitting on the bottom edge', async () => {
    await mountMenu(triggerAt({ top: VIEWPORT_H - 56 }))

    const style = panelStyle()
    // Measured up from the bottom, so the panel never needs its own height to
    // know where it goes.
    expect(style).toContain('top: auto')
    // 800 - 744 + 8: clear of the bar rather than under it.
    expect(style).toContain('bottom: 64px')
  })

  // The rule is "whichever side has more room", so a trigger just past the
  // midpoint flips even though there is still some space under it.
  it('flips as soon as there is more room above than below', async () => {
    await mountMenu(triggerAt({ top: 500, height: 40 }))

    // 500 above, 260 below.
    expect(panelStyle()).toContain('top: auto')
    expect(panelStyle()).toContain('bottom: 308px')
  })

  it('keeps hanging below while there is more room below', async () => {
    await mountMenu(triggerAt({ top: 300, height: 40 }))

    // 300 above, 460 below.
    expect(panelStyle()).toContain('top: 348px')
  })

  // Alignment is a separate axis and must survive the flip.
  it('keeps its horizontal alignment when it flips', async () => {
    await mountMenu(triggerAt({ top: VIEWPORT_H - 56 }), { align: 'right' })

    const style = panelStyle()
    expect(style).toContain('top: auto')
    // 700 - 104.
    expect(style).toContain('right: 596px')
    expect(style).toContain('left: auto')
  })
})
