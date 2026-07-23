// How the topbar splits its width between the family name and the member stack.
//
// Five circles cost about 114px (30px each, overlapped by 9px); three cost 72px.
// On a narrow phone that 42px is the difference between a family name that fits
// and one that gets cut off, so a long name buys its room back from the stack.
//
// These are slot counts, not circle counts. MemberAvatarStack renders up to
// slots + 1 avatars before collapsing the rest into "+n", because collapsing at
// exactly one over would hide a face to show a "+1" badge in its place and save
// no room at all. So 4 slots means at most 5 circles, and 2 slots means at most
// 3: three members show all three, four show two and a "+2".
export const AVATAR_SLOTS_WIDE = 4
export const AVATAR_SLOTS_NARROW = 2

// Past this many characters the name would ellipsize against a full stack on a
// narrow screen, which is the point where the stack should give way instead.
export const LONG_FAMILY_NAME_CHARS = 14

export function avatarSlotsForFamilyName(name: string | null | undefined): number {
  const length = (name ?? '').trim().length
  return length > LONG_FAMILY_NAME_CHARS ? AVATAR_SLOTS_NARROW : AVATAR_SLOTS_WIDE
}
