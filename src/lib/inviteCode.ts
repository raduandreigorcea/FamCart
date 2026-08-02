// The invite code: how someone joins a family, and the only credential guarding
// that. Both the code generator and the shape check live here because the two
// have to agree — a generated code that the join form would reject is a family
// nobody can be invited to.
//
// This was duplicated character-for-character in FamilySetupView (which mints
// one when creating a family) and FamilySettingsModal (which mints one when
// regenerating). Two copies of a security-relevant helper is one copy too many:
// a fix to the alphabet or the entropy in one would silently not reach the
// other.

// No I, O, 0 or 1 — the code gets read aloud and typed in by hand, and those
// four are where that goes wrong. Exactly 32 characters, which matters below.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const INVITE_CODE_LENGTH = 8

// What a code must look like to be worth sending to the server. Mirrors
// ALPHABET: A-H, J-N, P-Z, 2-9.
export const INVITE_CODE_REGEX = /^[A-HJ-NP-Z2-9]{8}$/

// A fresh code. Uses a CSPRNG rather than Math.random(): this is the credential
// that admits someone to a family's list, so a predictable one is a way in.
// The 32-character alphabet divides 256 evenly, so `byte & 31` maps onto it
// with no modulo bias — every character is equally likely.
export function randomInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH))
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('')
}

// Normalize what someone typed, then check it. Codes are shown and stored
// uppercase; accepting a lowercase paste costs nothing and rejecting it only
// looks like a bug.
export function normalizeInviteCode(input: string): string {
  return input.trim().toUpperCase()
}

export function isValidInviteCode(code: string): boolean {
  return INVITE_CODE_REGEX.test(code)
}
