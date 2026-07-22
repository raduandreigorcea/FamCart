-- Family-level preference: an emoji the owner picks to identify the family in
-- the switcher. Optional (null = none). Length-capped but generous enough for a
-- single multi-codepoint emoji (flags, ZWJ family sequences).
alter table public.families
  add column if not exists emoji text;

alter table public.families
  drop constraint if exists families_emoji_length_check;

alter table public.families
  add constraint families_emoji_length_check
  check (emoji is null or char_length(emoji) <= 16);
