// Strips Clerk's __clerk_* callback params and collapses duplicate leading
// slashes left behind by the post-auth redirect. Returns the cleaned
// path+search+hash to replace the current URL with, or null if the URL is
// already clean.
export function cleanAuthCallbackUrl(href: string): string | null {
  const current = new URL(href)
  const normalizedPath = `/${current.pathname.replace(/^\/+/, '')}`
  let changed = normalizedPath !== current.pathname

  const clerkParamKeys: string[] = []
  current.searchParams.forEach((_, key) => {
    if (key.startsWith('__clerk_')) clerkParamKeys.push(key)
  })

  if (clerkParamKeys.length) {
    clerkParamKeys.forEach((key) => current.searchParams.delete(key))
    changed = true
  }

  if (!changed) return null

  const nextSearch = current.searchParams.toString()
  return `${normalizedPath}${nextSearch ? `?${nextSearch}` : ''}${current.hash}`
}
