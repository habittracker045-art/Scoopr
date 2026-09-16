-- Scoopr — Phase 3, Prompt 2: Manual Create Mode (schema tweaks)
-- Run this in the Supabase SQL Editor, same way as schema.sql /
-- phase2_schema.sql / phase3_schema.sql were run. Safe to re-run.
--
-- This does NOT touch seen_items, schedule_settings, or any auto-pipeline
-- logic — it only relaxes/extends the `cards` table so manually-created
-- cards (POST /api/create) can be stored through the exact same
-- cardStore.insertDraftCards() the auto pipeline already uses.

-- ─────────────────────────────────────────────────────────────
-- cards.source_url -> nullable
-- ─────────────────────────────────────────────────────────────
-- Every auto-pipeline item (Reddit/RSS/HN) always has a source URL, so
-- this was NOT NULL from Phase 2, Prompt 3. A manually-typed idea has no
-- such link, and the spec explicitly calls for sourceUrl: null on those
-- cards rather than an empty-string placeholder — so relax the
-- constraint instead of faking a URL.
alter table cards alter column source_url drop not null;

-- ─────────────────────────────────────────────────────────────
-- cards.enrichment_note -> new, nullable
-- ─────────────────────────────────────────────────────────────
-- Holds the Gemini-generated contextual background + suggested
-- source/angle produced for manual cards (see
-- src/services/manualCreate.js). Always NULL for auto-pipeline cards,
-- which never populate it — this is purely additive and does not change
-- anything about how existing rows are read or written.
alter table cards add column if not exists enrichment_note text;
