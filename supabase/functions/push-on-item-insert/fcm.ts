// Firebase Cloud Messaging HTTP v1 sender for Deno (Supabase Edge Functions).
//
// FCM v1 authenticates with a short-lived OAuth2 access token minted from a
// service-account key (unlike the legacy server key). We sign a JWT with the
// service account's private key using Web Crypto and exchange it for an access
// token, which we cache in memory until shortly before it expires.
//
// Secret required (supabase secrets set FCM_SERVICE_ACCOUNT="$(cat key.json)"):
//   FCM_SERVICE_ACCOUNT — the full service-account JSON downloaded from Firebase
//                          (Project settings → Service accounts → Generate key).

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
  token_uri?: string
}

export interface FcmSendResult {
  ok: boolean
  // True when FCM says the token is dead (UNREGISTERED / invalid) so the caller
  // can prune it.
  prune: boolean
}

let serviceAccount: ServiceAccount | null = null
let cachedToken: { value: string; expiresAt: number } | null = null

function loadServiceAccount(): ServiceAccount | null {
  if (serviceAccount) return serviceAccount
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ServiceAccount
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null
    serviceAccount = parsed
    return serviceAccount
  } catch {
    return null
  }
}

export function isFcmConfigured(): boolean {
  return loadServiceAccount() !== null
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function mintAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value

  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token'
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }

  const enc = new TextEncoder()
  const signingInput = `${base64UrlEncode(enc.encode(JSON.stringify(header)))}.${base64UrlEncode(
    enc.encode(JSON.stringify(claim)),
  )}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput)),
  )
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) return null

  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) }
  return cachedToken.value
}

export interface FcmMessage {
  title: string
  body: string
  tag: string
  url: string
}

// Send one notification to one device token. Returns prune=true when FCM
// reports the token is no longer valid.
export async function sendFcm(token: string, msg: FcmMessage): Promise<FcmSendResult> {
  const sa = loadServiceAccount()
  if (!sa) return { ok: false, prune: false }

  const accessToken = await mintAccessToken(sa)
  if (!accessToken) return { ok: false, prune: false }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: { url: msg.url },
          android: {
            // Collapse a burst of adds into one banner per family, matching Web Push.
            collapse_key: msg.tag,
            notification: { tag: msg.tag },
          },
        },
      }),
    },
  )

  if (res.ok) return { ok: true, prune: false }

  // 404 = UNREGISTERED (app uninstalled / token rotated); 400 with an invalid
  // token argument is also permanently dead. Anything else is transient.
  const prune = res.status === 404 || res.status === 400
  return { ok: false, prune }
}
