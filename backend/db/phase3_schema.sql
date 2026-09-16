-- Scoopr — Phase 3, Prompt 1: Schedule Settings (storage only)
-- Run this in the Supabase SQL Editor (same way schema.sql / phase2_schema.sql
-- were run). Safe to re-run: guarded with IF NOT EXISTS / DROP TRIGGER IF EXISTS
-- so re-running it won't error on a partial apply.

-- ─────────────────────────────────────────────────────────────
-- schedule_settings — one row per user, describes their auto-generate setup
-- ─────────────────────────────────────────────────────────────
-- This table ONLY stores the setting. Nothing reads/acts on it yet — the
-- cron engine that actually triggers pipeline runs off this table comes in
-- the next prompt. A user with no row here is simply treated as "not
-- scheduled" by the API layer (see routes/schedule.js), so this table does
-- not need a row seeded for every existing user.

create table if not exists schedule_settings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  enabled           boolean not null default false,
  scheduled_time    text not null default '08:00',   -- "HH:MM", 24h format
  topics            text[] not null default '{}',    -- subset of config/topics.js keys
  freshness_window  text not null default '24h'
                    check (freshness_window in ('6h', '24h', '3d')),
  update_type       text not null default 'news'
                    check (update_type in ('news', 'events', 'both')),
  -- Stored per-row (rather than a single global setting) so this can become
  -- a real per-user preference later without a schema change. For now every
  -- row defaults to UTC and the API doesn't yet expose a way to change it.
  timezone          text not null default 'UTC',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One schedule row per user.
create unique index if not exists schedule_settings_user_id_key
  on schedule_settings (user_id);

-- Keep updated_at current on every UPDATE, matching how the rest of this
-- schema tracks change-time (cards/seen_items use created_at only since
-- they're append-mostly; this table is upserted repeatedly, so it needs it).
create or replace function set_schedule_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_schedule_settings_updated_at on schedule_settings;
create trigger trg_schedule_settings_updated_at
  before update on schedule_settings
  for each row
  execute function set_schedule_settings_updated_at();

alter table schedule_settings enable row level security;

-- No policies = deny-all for anon/authenticated roles. The backend talks to
-- Supabase with the service role key, which bypasses RLS entirely — same
-- pattern as `users`, `seen_items`, and `cards`. Belt-and-suspenders:
-- explicitly revoke table privileges from the client-facing roles too.
revoke all on schedule_settings from anon, authenticated;
