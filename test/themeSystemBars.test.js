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
}))

const { applyResolvedTheme } = await import('../src/lib/theme')

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
    expect(native.setStyle).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('asks for light icons when the app is dark', () => {
    osDark = false
    applyResolvedTheme('dark')
    expect(native.setStyle).toHaveBeenCalledWith({ style: 'DARK' })
  })

  it('resolves system mode first, then styles the bars to match', () => {
    osDark = true
    applyResolvedTheme('system')
    expect(native.setStyle).toHaveBeenCalledWith({ style: 'DARK' })
  })

  it('leaves the browser alone', () => {
    native.isNative = false
    applyResolvedTheme('light')
    expect(native.setStyle).not.toHaveBeenCalled()
  })
})
