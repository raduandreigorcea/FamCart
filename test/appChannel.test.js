import { describe, it, expect } from 'vitest'
import { PRODUCTION_PROJECT_REF, projectRefFromUrl, resolveChannel } from '../src/lib/appChannel'

const PROD_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`
const DEV_URL = 'https://arkqdpvguqfsdocmfwaf.supabase.co'

describe('resolveChannel', () => {
  it('treats a build wired to the production project as production', () => {
    expect(resolveChannel({ supabaseUrl: PROD_URL, dev: false })).toBe('production')
  })

  it('treats a build wired to any other project as nightly', () => {
    expect(resolveChannel({ supabaseUrl: DEV_URL, dev: false })).toBe('nightly')
  })

  it('treats the dev server as nightly whatever it points at', () => {
    expect(resolveChannel({ supabaseUrl: PROD_URL, dev: true })).toBe('nightly')
  })

  it('lets an explicit channel override the project it points at', () => {
    expect(resolveChannel({ channel: 'nightly', supabaseUrl: PROD_URL, dev: false })).toBe('nightly')
    expect(resolveChannel({ channel: 'production', supabaseUrl: DEV_URL, dev: false })).toBe(
      'production',
    )
  })

  it('accepts an override in any casing or padding', () => {
    expect(resolveChannel({ channel: '  Production ', supabaseUrl: DEV_URL, dev: true })).toBe(
      'production',
    )
  })

  // Safe by default in both directions: only the exact word 'production', and
  // only the exact production project, ever produce an unmarked build. A typo
  // in the override, or a URL nobody recognises, shows the badge instead of
  // silently passing a dev build off as the real thing.
  it('falls back to nightly for an override it does not recognise', () => {
    expect(resolveChannel({ channel: 'staging', supabaseUrl: PROD_URL, dev: false })).toBe('nightly')
  })

  it('falls back to nightly when there is no url to judge', () => {
    expect(resolveChannel({ dev: false })).toBe('nightly')
    expect(resolveChannel({ supabaseUrl: 'not a url', dev: false })).toBe('nightly')
  })

  it('ignores an empty override rather than treating it as unrecognised', () => {
    expect(resolveChannel({ channel: '', supabaseUrl: PROD_URL, dev: false })).toBe('production')
  })
})

describe('projectRefFromUrl', () => {
  it('takes the ref from the hostname', () => {
    expect(projectRefFromUrl(DEV_URL)).toBe('arkqdpvguqfsdocmfwaf')
  })

  it('answers empty for anything it cannot parse', () => {
    expect(projectRefFromUrl('not a url')).toBe('')
    expect(projectRefFromUrl(undefined)).toBe('')
  })
})
