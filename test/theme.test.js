// The theme key and its read/write rules existed twice — main.ts applied the
// saved theme on boot, AppSettingsModal.vue read and wrote it with its own copy
// of the key literal — and two spellings of one storage key is exactly the
// hazard nativeUpdate.ts documents having been bitten by. lib/theme.ts is now
// the single authority; these tests pin the storage contract both callers rely
// on, most importantly that anything unrecognised means 'system' rather than a
// crash or a stuck theme.
import { describe, it, expect } from 'vitest'
import { THEME_STORAGE_KEY, loadThemeMode, saveThemeMode } from '../src/lib/theme'
import { makeStorage } from './support/fakeStorage.js'

describe('loadThemeMode', () => {
  it('returns the saved mode for each of the three valid values', () => {
    for (const mode of ['light', 'dark', 'system']) {
      const storage = makeStorage({ [THEME_STORAGE_KEY]: mode })
      expect(loadThemeMode(storage)).toBe(mode)
    }
  })

  it('returns system when nothing is saved', () => {
    expect(loadThemeMode(makeStorage())).toBe('system')
  })

  it('returns system for a value no build ever wrote', () => {
    const storage = makeStorage({ [THEME_STORAGE_KEY]: 'sepia' })
    expect(loadThemeMode(storage)).toBe('system')
  })

  it('returns system when storage is unusable rather than throwing', () => {
    const storage = {
      getItem() {
        throw new Error('storage disabled')
      },
    }
    expect(loadThemeMode(storage)).toBe('system')
  })
})

describe('saveThemeMode', () => {
  it('writes under the one shared key, so load reads back what save wrote', () => {
    const storage = makeStorage()
    saveThemeMode(storage, 'dark')
    expect(storage.map.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(loadThemeMode(storage)).toBe('dark')
  })

  it('swallows a refused write — the theme just does not persist', () => {
    const storage = {
      setItem() {
        throw new Error('quota')
      },
    }
    expect(() => saveThemeMode(storage, 'light')).not.toThrow()
  })
})
