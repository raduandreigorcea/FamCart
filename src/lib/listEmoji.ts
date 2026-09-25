// A list's emoji is optional: owners pick one in settings, and until they do
// the app falls back to the shopping cart so the topbar tile and every list
// row still read as one tidy square. The settings picker shows the same fallback
// (dimmed) so the preview never sits empty.
export const DEFAULT_LIST_EMOJI = '🛒'

// Curated list/list emoji offered in the settings picker.
export const LIST_EMOJIS = [
  '🏠', '🏡', '🛒', '🧺', '🍎', '🥕', '🍞', '🥑', '🍕',
  '🍽️', '☕', '🐶', '🐱', '🌿', '🌟', '❤️', '🎉', '🔑',
]
