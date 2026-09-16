-- Scoopr — Phase 3, Prompt 4: Tips & Facts Generator (schema addition)
-- Run this in the Supabase SQL Editor, same way as schema.sql /
-- phase2_schema.sql / phase3_schema.sql / phase3_prompt2_schema.sql were
-- run. Safe to re-run: guarded with IF NOT EXISTS so re-running it won't
-- error on a partial apply.
--
-- This does NOT touch cards, seen_items, schedule_settings, or any
-- news/events logic — "Tips & Facts" is a separate, self-contained
-- content type (per the original spec: "Dedicated 'Tips & Facts' tab —
-- evergreen tech tips and trivia"), stored in its own table rather than
-- being shoehorned into `cards`, since it has no source_url/source_type
-- in the news-pipeline sense and isn't subject to a freshness window.

-- ─────────────────────────────────────────────────────────────
-- tips_facts — generated evergreen tips/facts
-- ─────────────────────────────────────────────────────────────

create table if not exists tips_facts (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,                 -- the tip/fact text itself
  category     text not null
               check (category in ('tip', 'fact')),
  topic        text not null default 'tech',  -- flexible: not constrained to config/topics.js keys,
                                               -- since tips/facts aren't tied to the news topic list
  image_url    text,                          -- always the templated fallback graphic (see imageHandler.js) — tips/facts never have a source image
  -- Dedup key: sha1 of the normalized (lowercased, whitespace/punctuation-
  -- collapsed) content text — see src/utils/hashDedupKey.js. Tips/facts
  -- have no natural URL/GUID to dedup on the way cards.source_id does for
  -- Reddit/RSS/HN, so the content itself (normalized) is the identity.
  content_hash text not null,
  created_at   timestamptz not null default now(),
  status       text not null default 'draft'
               check (status in ('draft', 'approved', 'skipped'))
);

-- Enforces "the same fact/tip doesn't get regenerated and reshown
-- repeatedly" at the DB level too, not just in the pre-insert check in
-- tipsFactsGenerator.js — same defense-in-depth pattern as
-- cards_source_id_key in phase2_schema.sql.
create unique index if not exists tips_facts_content_hash_key
  on tips_facts (content_hash);

create index if not exists tips_facts_created_at_idx
  on tips_facts (created_at desc);

create index if not exists tips_facts_topic_category_idx
  on tips_facts (topic, category);

alter table tips_facts enable row level security;

-- No policies = deny-all for anon/authenticated roles. The backend talks
-- to Supabase with the service role key, which bypasses RLS entirely —
-- same pattern as `users`, `seen_items`, `cards`, and `schedule_settings`.
-- Belt-and-suspenders: explicitly revoke table privileges from the
-- client-facing roles too.
revoke all on tips_facts from anon, authenticated;
