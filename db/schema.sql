-- Scoopr: users table + supporting setup
-- Run this in Supabase's SQL Editor (Project -> SQL Editor -> New query)

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text unique not null,
  hashed_password text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_users_email on public.users (email);
create index if not exists idx_users_username on public.users (username);

-- Row Level Security is enabled with NO policies attached.
-- This means the anon/publishable key gets zero access to this table.
-- Only the SERVICE ROLE key (used exclusively by the backend) can read/write it,
-- because the service role bypasses RLS entirely.
alter table public.users enable row level security;

-- After your first real signup through the app, promote that user to admin
-- manually, since there's no public "become an admin" endpoint by design:
--
--   update public.users set role = 'admin' where username = 'your_username_here';
