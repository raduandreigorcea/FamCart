// @vitest-environment happy-dom
//
// An address the app does not know used to render nothing at all: no route
// matched, so RouterView drew a blank page. /family-setup is the one that
// mattered (old bookmarks and PWA shortcuts from before the households rename),
// and the catch-all now sends it, and any other stray link, home.
import { it, expect } from 'vitest'
import router from '../src/router'

it.each(['/family-setup?add=1', '/no-such-page', '/a/b/c'])('sends %s home', (path) => {
  expect(router.resolve(path).matched.at(-1)?.redirect).toBe('/')
})

it('leaves the real routes alone', () => {
  expect(router.resolve('/household-setup').name).toBe('household-setup')
  expect(router.resolve('/login').name).toBe('login')
})
