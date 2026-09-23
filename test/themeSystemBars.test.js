// Android colours the status bar icons and navigation buttons from the phone's
// dark mode, not the app's, so a dark phone with the app on Light drew white
// buttons on a near-white page. applyResolvedTheme now sets the bar style from
// the theme that is actually on screen, in the native app only.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({ isNative: true, setStyle: vi.fn(() => Promise.resolve()) }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
  SystemBars: { setStyle: native.setStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
  SystemBarType: { StatusBar: 'StatusBar', NavigationBar: 'NavigationBar' },
}))

const { applyResolvedTheme, setStatusBarOnBrand } = await import('../src/lib/theme')

// Both bars get a style, each named.
const styled = (bar) => native.setStyle.mock.calls.map(([o]) => o).filter((o) => o.bar === bar).at(-1)?.style

let osDark = false
beforeEach(() => {
  native.isNative = true
  native.setStyle.mockClear()
  vi.stubGlobal('document', { documentElement: { setAttribute() {} } })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: osDark }) })
})

describe('system bars follow the app theme', () => {
  it('asks for dark icons when the app is light, whatever the phone says', () => {
    osDark = true
    applyResolvedTheme('light')
    expect(styled('StatusBar')).toBe('LIGHT')
    expect(styled('NavigationBar')).toBe('LIGHT')
  })

  it('asks for light icons when the app is dark', () => {
    osDark = false
    applyResolvedTheme('dark')
    expect(styled('StatusBar')).toBe('DARK')
    expect(styled('NavigationBar')).toBe('DARK')
  })

  it('resolves system mode first, then styles the bars to match', () => {
    osDark = true
    applyResolvedTheme('system')
    expect(styled('NavigationBar')).toBe('DARK')
  })

  // The green header runs up behind the status bar, so its icons go light there
  // even on a light theme; the navigation bar still follows the theme.
  it('lights the status bar icons over the green header, and only there', () => {
    osDark = false
    applyResolvedTheme('light')
    setStatusBarOnBrand(true)
    expect(styled('StatusBar')).toBe('DARK')
    expect(styled('NavigationBar')).toBe('LIGHT')
    setStatusBarOnBrand(false)
    expect(styled('StatusBar')).toBe('LIGHT')
  })

  it('leaves the browser alone', () => {
    native.isNative = false
    applyResolvedTheme('light')
    expect(native.setStyle).not.toHaveBeenCalled()
  })
})
