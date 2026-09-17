// What the admin dashboard may ask of Sentry, OneSignal and Clerk, and what it
// gets back.
//
// The dashboard is a plain SPA and holds no secret, on purpose (admin's
// .env.example says why). These three services only answer to a secret key, so
// admin-services/index.ts holds the keys and asks on the dashboard's behalf,
// once the caller has proved to be an admin. This file is the part of that
// which is decisions rather than wiring -- which requests exist, which secrets
// each one needs, and how a vendor's payload is cut down to the fields a page
// renders -- and it uses no Deno API, so test/services.test.js runs it as is.
// Same split as push.ts beside it.
//
// Cutting the payloads down is not tidiness. A Clerk user object carries
// private metadata and every address the person ever added; a Sentry issue
// carries stack context. The browser gets what the page shows and no more.

export type Service = 'sentry' | 'onesignal' | 'clerk'

export type ServiceRequest =
  | { service: 'sentry'; view: 'issues' | 'feedback' }
  | { service: 'onesignal'; view: 'notifications' }
  | { service: 'clerk'; view: 'summary' }
  | { service: 'clerk'; view: 'user'; userId: string }

// The Sentry project the app reports to. The same two strings vite.config.js
// uploads source maps under, so they are constants rather than two more secrets.
// The project is shared by every build, so both app databases read the same
// issues.
export const SENTRY_ORG = 'famcart'
export const SENTRY_PROJECT = 'javascript-vue'

// THE EU REGION, NOT sentry.io. The famcart organisation's data lives in
// Sentry's EU region (its DSN ingests at ingest.de.sentry.io, and an org token
// says region_url https://de.sentry.io). An organisation token carries that
// region and sentry.io routes it; a personal token does not, and sentry.io then
// answers 404 for the organisation's projects and issues -- which is what the
// admin Health page showed as "Sentry answered 404". The region host answers
// both kinds, so it is what is asked.
export const SENTRY_API = 'https://de.sentry.io/api/0'

const SECRETS: Record<Service, string[]> = {
  // A token with event:read and project:read. The build's SENTRY_AUTH_TOKEN is
  // not it: that one is scoped to uploading source maps and gets 403 here.
  sentry: ['SENTRY_READ_TOKEN'],
  // The same two push-on-item-insert already uses.
  onesignal: ['ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY'],
  clerk: ['CLERK_SECRET_KEY'],
}

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

// A Clerk user id. Checked because it is spliced into a URL path.
const CLERK_USER_ID = /^user_[A-Za-z0-9]{10,64}$/

/** The request, or null for anything this function does not answer. */
export function parseRequest(body: unknown): ServiceRequest | null {
  if (!body || typeof body !== 'object') return null
  const { service, view, userId } = body as Record<string, unknown>
  if (service === 'sentry' && (view === 'issues' || view === 'feedback')) return { service, view }
  if (service === 'onesignal' && view === 'notifications') return { service, view }
  if (service === 'clerk' && view === 'summary') return { service, view }
  if (service === 'clerk' && view === 'user' && typeof userId === 'string' && CLERK_USER_ID.test(userId)) {
    return { service, view, userId }
  }
  return null
}

/** The secrets a service needs that this project does not have. */
export function missingSecrets(service: Service, read: (name: string) => string | undefined): string[] {
  return SECRETS[service].filter((name) => !read(name))
}

/** A vendor answered, and not with what was asked for. */
export class UpstreamError extends Error {
  constructor(
    readonly service: Service,
    readonly status: number,
  ) {
    super(upstreamMessage(service, status))
  }
}

const SERVICE_NAMES: Record<Service, string> = { sentry: 'Sentry', onesignal: 'OneSignal', clerk: 'Clerk' }

export function upstreamMessage(service: Service, status: number): string {
  const name = SERVICE_NAMES[service]
  if (status === 401 || status === 403) {
    return `${name} refused the key this project holds (${status}). It is wrong, revoked, or missing a scope.`
  }
  if (status === 429) return `${name} is rate limiting this key (429). Try again in a minute.`
  if (status >= 500) return `${name} is failing on its side (${status}).`
  return `${name} answered ${status}.`
}

// ─── Sentry ──────────────────────────────────────────────────────────────────

/**
 * The issues endpoint, for one view.
 *
 * Feedback deliberately has no status filter. Sentry archives feedback it
 * judges to be spam on its own, and an archived report is invisible in the
 * default inbox, so the page lists every status and says which one each is in.
 */
export function sentryIssuesUrl(
  projectId: string,
  view: 'issues' | 'feedback',
  environments: string[],
): string {
  const params = new URLSearchParams({
    project: projectId,
    limit: '50',
    sort: 'date',
    statsPeriod: view === 'issues' ? '14d' : '90d',
    query: view === 'issues' ? 'is:unresolved issue.category:error' : 'issue.category:feedback',
  })
  for (const environment of environments) params.append('environment', environment)
  return `${SENTRY_API}/organizations/${SENTRY_ORG}/issues/?${params}`
}

// The `famcart` project. The same public ref src/lib/appChannel.ts compares
// against, and for the same reason: it is what production IS.
export const PRODUCTION_PROJECT_REF = 'qwpyiperbjaeykrvilhf'

/**
 * Which Sentry environments belong to the project this function runs on.
 *
 * One Sentry project takes reports from every build, told apart by the
 * environment tag src/lib/errorReporting.ts sets from the app's channel. So the
 * production database reads `production` only, and famcart-dev reads what is
 * wired to it: the nightly builds and a local `npm run dev`. Reports sent before
 * the tag followed the channel say `production` whatever sent them.
 */
export function sentryEnvironments(supabaseUrl: string | undefined): string[] {
  const ref = (supabaseUrl ?? '').replace(/^https:\/\//, '').split('.')[0]
  return ref === PRODUCTION_PROJECT_REF ? ['production'] : ['nightly', 'development']
}

export function sentryProjectUrl(): string {
  return `${SENTRY_API}/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/`
}

type Raw = Record<string, unknown>

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const num = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

export interface SentryIssue {
  id: string
  shortId: string
  title: string
  culprit: string | null
  level: string
  events: number
  users: number
  firstSeen: string
  lastSeen: string
  url: string
}

export function shapeSentryIssue(raw: Raw): SentryIssue {
  return {
    id: String(raw.id),
    shortId: str(raw.shortId) ?? String(raw.id),
    title: str(raw.title) ?? '(untitled)',
    culprit: str(raw.culprit),
    level: str(raw.level) ?? 'error',
    // Sentry sends the event count as a string and the user count as a number.
    events: num(raw.count),
    users: num(raw.userCount),
    firstSeen: String(raw.firstSeen),
    lastSeen: String(raw.lastSeen),
    url: String(raw.permalink),
  }
}

export interface SentryFeedback {
  id: string
  shortId: string
  message: string
  name: string | null
  email: string | null
  /** unresolved, resolved or ignored; ignored is what Sentry calls archived. */
  status: string
  at: string
  url: string
}

export function shapeSentryFeedback(raw: Raw): SentryFeedback {
  const meta = (raw.metadata ?? {}) as Raw
  return {
    id: String(raw.id),
    shortId: str(raw.shortId) ?? String(raw.id),
    message: str(meta.message) ?? str(raw.title) ?? '',
    name: str(meta.name),
    email: str(meta.contact_email),
    status: str(raw.status) ?? 'unresolved',
    at: String(raw.firstSeen),
    url: String(raw.permalink),
  }
}

// ─── OneSignal ───────────────────────────────────────────────────────────────

/** The newest notifications first; 50 is the most the endpoint returns. */
export function oneSignalNotificationsUrl(appId: string): string {
  return `https://api.onesignal.com/notifications?${new URLSearchParams({ app_id: appId, limit: '50' })}`
}

export interface PushNotification {
  id: string
  text: string
  /** When it finished sending, or was queued if it has not. */
  at: string | null
  delivered: number
  /** Devices that had unsubscribed: gone, rather than broken. */
  unsubscribed: number
  /** Deliveries that failed for a reason OneSignal counts as an error. */
  errored: number
  remaining: number
  canceled: boolean
}

const unixToIso = (value: unknown): string | null => {
  const n = num(value)
  return n > 0 ? new Date(n * 1000).toISOString() : null
}

export function shapeNotification(raw: Raw): PushNotification {
  const contents = (raw.contents ?? {}) as Record<string, unknown>
  // English is the fallback every notification carries (push.ts sends all six).
  const text = str(contents.en) ?? Object.values(contents).map(str).find(Boolean) ?? ''
  return {
    id: String(raw.id),
    text,
    at: unixToIso(raw.completed_at) ?? unixToIso(raw.queued_at),
    delivered: num(raw.successful),
    unsubscribed: num(raw.failed),
    errored: num(raw.errored),
    remaining: num(raw.remaining),
    canceled: raw.canceled === true,
  }
}

// ─── Clerk ───────────────────────────────────────────────────────────────────

export const CLERK_API = 'https://api.clerk.com/v1'

export interface ClerkUser {
  id: string
  name: string | null
  email: string | null
  imageUrl: string | null
  /** How this person can sign in: google, apple, password, email. */
  methods: string[]
  createdAt: string | null
  lastSignInAt: string | null
  lastActiveAt: string | null
  twoFactor: boolean
  banned: boolean
  locked: boolean
}

const msToIso = (value: unknown): string | null => {
  const n = num(value)
  return n > 0 ? new Date(n).toISOString() : null
}

export function signInMethods(raw: Raw): string[] {
  const methods = ((raw.external_accounts ?? []) as Raw[])
    .map((account) => str(account.provider)?.replace(/^oauth_/, ''))
    .filter((provider): provider is string => Boolean(provider))
  if (raw.password_enabled === true) methods.push('password')
  // An address with no password is a one-time code by email.
  else if (((raw.email_addresses ?? []) as Raw[]).length) methods.push('email')
  return [...new Set(methods)]
}

export function shapeClerkUser(raw: Raw): ClerkUser {
  const emails = (raw.email_addresses ?? []) as Raw[]
  const primary = emails.find((e) => e.id === raw.primary_email_address_id) ?? emails[0]
  const name = [str(raw.first_name), str(raw.last_name)].filter(Boolean).join(' ')
  return {
    id: String(raw.id),
    name: name || str(raw.username),
    email: primary ? str(primary.email_address) : null,
    imageUrl: str(raw.image_url),
    methods: signInMethods(raw),
    createdAt: msToIso(raw.created_at),
    lastSignInAt: msToIso(raw.last_sign_in_at),
    lastActiveAt: msToIso(raw.last_active_at),
    twoFactor: raw.two_factor_enabled === true,
    banned: raw.banned === true,
    locked: raw.locked === true,
  }
}

/** `/users/count` answers `{ total_count }`; older docs show a bare number. */
export function readClerkCount(raw: unknown): number {
  if (typeof raw === 'number') return raw
  return num((raw as Raw | null)?.total_count)
}
