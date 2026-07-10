import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The module creates Supabase clients at import time; stub that out so the
// test exercises fetchWithRetry alone (CI has no VITE_SUPABASE_* env).
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@clerk/vue', () => ({ useAuth: () => ({}) }))

import { fetchWithRetry } from '../src/supabase'

const networkError = () => Object.assign(new TypeError('Failed to fetch'), {})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWithRetry', () => {
  it('retries GETs that fail at the network layer, then succeeds', async () => {
    fetch
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce('response')

    await expect(fetchWithRetry('https://x/rest')).resolves.toBe('response')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('gives up after exhausting the retry budget', async () => {
    fetch.mockRejectedValue(networkError())

    await expect(fetchWithRetry('https://x/rest', { method: 'GET' })).rejects.toThrow('Failed to fetch')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('never retries mutations', async () => {
    fetch.mockRejectedValue(networkError())

    await expect(fetchWithRetry('https://x/rest', { method: 'POST' })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns HTTP error responses without retrying', async () => {
    const errorResponse = { ok: false, status: 500 }
    fetch.mockResolvedValue(errorResponse)

    await expect(fetchWithRetry('https://x/rest')).resolves.toBe(errorResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry aborted requests', async () => {
    fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    await expect(fetchWithRetry('https://x/rest')).rejects.toThrow('aborted')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
