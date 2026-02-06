-- apps/server/migrations/001_init.sql
-- Enable required extensions
create extension if not exists "pgcrypto";

-- Profiles
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Guest',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Wallets
create table if not exists wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Ledger
create table if not exists ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null,
  type text not null,
  match_id uuid,
  game_key text not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
);

-- Matches
create table if not exists matches (
  match_id uuid primary key default gen_random_uuid(),
  room_id text,
  game_key text not null,
  stake_amount bigint not null default 0,
  status text not null,
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(match_id) on delete cascade,
  user_id uuid references auth.users(id),
  is_bot boolean not null default false,
  bot_difficulty int,
  seat_index int not null,
  created_at timestamptz not null default now()
);

create table if not exists match_events (
  event_id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(match_id) on delete cascade,
  seq int not null,
  user_id uuid references auth.users(id),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(match_id, seq)
);

-- Indexes
create index if not exists idx_ledger_user_created on ledger_transactions(user_id, created_at desc);
create index if not exists idx_ledger_match on ledger_transactions(match_id);
create index if not exists idx_matches_status_created on matches(status, created_at desc);
create index if not exists idx_match_events_match_seq on match_events(match_id, seq);

-- RLS
alter table profiles enable row level security;
alter table wallets enable row level security;
alter table ledger_transactions enable row level security;
alter table matches enable row level security;
alter table match_players enable row level security;
alter table match_events enable row level security;

-- Profiles: users can read/update their own profile (optional)
create policy "profiles_select_own" on profiles
for select to authenticated
using (auth.uid() = user_id);

create policy "profiles_update_own" on profiles
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Wallets: users can read own, cannot write
create policy "wallets_select_own" on wallets
for select to authenticated
using (auth.uid() = user_id);

-- No insert/update/delete policies for authenticated => denied.

-- Ledger: users can read own, cannot write
create policy "ledger_select_own" on ledger_transactions
for select to authenticated
using (auth.uid() = user_id);

-- Matches/events: users can read if participant via match_players
create policy "matches_select_participant" on matches
for select to authenticated
using (
  exists (
    select 1 from match_players mp
    where mp.match_id = matches.match_id
      and mp.user_id = auth.uid()
  )
);

create policy "match_players_select_participant" on match_players
for select to authenticated
using (
  exists (
    select 1 from match_players mp2
    where mp2.match_id = match_players.match_id
      and mp2.user_id = auth.uid()
  )
);

create policy "match_events_select_participant" on match_events
for select to authenticated
using (
  exists (
    select 1 from match_players mp
    where mp.match_id = match_events.match_id
      and mp.user_id = auth.uid()
  )
);
