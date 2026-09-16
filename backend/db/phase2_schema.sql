-- Scoopr — Phase 2, Prompt 3: Dedup + Storage
-- Run this in the Supabase SQL Editor (same way Phase 1's schema.sql was
-- run). Safe to re-run: everything is guarded with IF NOT EXISTS /
-- DROP POLICY IF EXISTS so re-running it won't error on a partial apply.

-- ─────────────────────────────────────────────────────────────
-- seen_items — dedup ledger
-- ─────────────────────────────────────────────────────────────
-- Tracks every sourceId we've ever fetched, regardless of whether it made
-- it into `cards`. Re-running the pipeline checks against this table so
-- the same story never gets processed twice.

create table if not exists seen_items (
  id            uuid primary key default gen_random_uuid(),
  source_id     text not null,
  source_type   text not null,
  topic         text,
  first_seen_at timestamptz not null default now()
);

-- source_id is the permanent uniqueness key (see note at the bottom of
-- this file). Each fetch module already prefixes it with the source type
-- (e.g. "hackernews:41823901", "reddit:t3_abc123"), so it's globally
-- unique on its own — the unique constraint lives on source_id alone,
-- not the (source_id, source_type) pair.
create unique index if not exists seen_items_source_id_key
  on seen_items (source_id);

create index if not exists seen_items_source_type_idx
  on seen_items (source_type);

alter table seen_items enable row level security;

-- No policies = deny-all for anon/authenticated roles. The backend talks
-- to Supabase with the service role key, which bypasses RLS entirely —
-- same pattern as Phase 1's `users` table. Belt-and-suspenders: explicitly
-- revoke table privileges from the client-facing roles too.
revoke all on seen_items from anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- cards — draft/approved/skipped content cards
-- ─────────────────────────────────────────────────────────────

create table if not exists cards (
  id           uuid primary key default gen_random_uuid(),
  topic        text not null,
  title        text not null,
  caption      text,                 -- nullable — filled in by Gemini polishing (Prompt 3... err, the next one)
  image_url    text,
  source_url   text not null,
  source_type  text not null,
  source_id    text not null,        -- traces back to seen_items; also an
                                      -- extra dedup safety net (see below)
  created_at   timestamptz not null default now(),
  status       text not null default 'draft'
               check (status in ('draft', 'approved', 'skipped'))
);

-- Defense in depth: even though the pipeline should never hand a seen
-- sourceId to insertDraftCards, a unique constraint here means a rare
-- race condition (e.g. two overlapping pipeline runs) still can't produce
-- two cards for the same source content. Inserts use upsert +
-- ON CONFLICT DO NOTHING against this constraint.
create unique index if not exists cards_source_id_key
  on cards (source_id);

create index if not exists cards_topic_status_idx
  on cards (topic, status);

create index if not exists cards_created_at_idx
  on cards (created_at desc);

alter table cards enable row level security;
revoke all on cards from anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- Note on long-term dedup behavior
-- ─────────────────────────────────────────────────────────────
-- sourceId (e.g. "hackernews:41823901", "reddit:t3_abc123") is the
-- permanent uniqueness key for a piece of content, for as long as that
-- content exists in the source system. It is:
--   1. Checked against `seen_items` before anything is inserted into
--      `cards` — already-seen sourceIds are filtered out of the batch
--      before storage even runs.
--   2. Enforced again at the DB level via the unique index on
--      `cards.source_id` (ON CONFLICT DO NOTHING on insert), so even a
--      bug or a race between overlapping pipeline runs can't create a
--      second card for the same sourceId.
-- Re-running the pipeline on the same window/topic combination is
-- therefore idempotent: it fetches the same items, dedup filters them
-- down to nothing new, and zero cards get inserted. Only genuinely new
-- content (a sourceId never seen before) produces a new card. If a card
-- is later deleted or its status changed, the sourceId stays in
-- `seen_items` — it will not be re-fetched into a new card unless
-- `seen_items` itself is cleared for that id, which is intentionally not
-- something the pipeline does on its own.
