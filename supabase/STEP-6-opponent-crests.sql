-- =============================================================================
-- CoachOps — STEP 6: opponent crests (table + RLS)
-- =============================================================================
-- Run this ONCE in the Supabase SQL editor, after STEP 5.
--
-- WHAT THIS ADDS
-- --------------
-- An `opponent_crests` table holding one logo per rival club, stored inline as a
-- base64 data URL exactly like player photos.
--
-- WHY A SEPARATE TABLE, NOT A COLUMN ON `lineups`
-- ----------------------------------------------
-- The opponent is free text the coach types into the lineup form. Keying the
-- crest by that text rather than by fixture id means:
--
--   - A club plays the same rival eight times a season and the image is uploaded
--     once, not eight times. Each extra copy would be ~15KB re-shipped through
--     every sync of every fixture.
--   - Fixtures already saved gain a crest the moment one is added, because the
--     lookup happens at render time from the name already on the row. No
--     backfill, no rewriting of past matches.
--
-- The cost is that spelling matters: "الرجاء" and "رجاء" are different keys, so
-- the app shows "no crest yet" rather than the wrong logo. That is the safer of
-- the two failure modes.
--
-- WHY THE COLUMN MUST EXIST BEFORE YOU ADD A CREST
-- -------------------------------------------------
-- The sync engine upserts whole rows and never diffs columns, so a client
-- holding crest_url sends that key whether or not the column exists. Without this
-- table every push would fail with:
--
--   PGRST204: Could not find the 'opponent_crests' relation in the schema cache
--
-- SAFE TO RE-RUN. Every statement is guarded.
--
-- RLS: leave it enabled. The SQL editor connects as `postgres`, which owns the
-- table and bypasses RLS anyway, so nothing here depends on turning it off.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The table.
-- -----------------------------------------------------------------------------
-- `id` is a client-generated uuid, matching every other synced table: the app
-- assigns it so the row can be identified before it has ever reached the server.
--
-- `key` is the lookup form of the name (trimmed, lowercased, internal whitespace
-- collapsed) and is unique, because two crests for one club is always a data
-- mistake and the app would silently pick one of them.
--
-- `name` is kept as the coach typed it. That is what gets printed, so it must
-- not be normalised.
--
-- The CHECK is deliberate rather than decorative: a `key` that disagrees with
-- `name` would be unreachable, because the app always looks up by the
-- normalised form. Better to refuse the row than store one that can never match.
create table if not exists opponent_crests (
  id         uuid primary key,
  name       text not null,
  key        text not null,
  crest_url  text not null,
  created_at timestamptz default now(),
  updated_at timestamptz,
  owner_id   uuid references auth.users(id) on delete cascade
);

-- A missing table means an older schema; add the columns explicitly, because
-- `create table if not exists` is a no-op on an existing table.
alter table opponent_crests add column if not exists name        text;
alter table opponent_crests add column if not exists key         text;
alter table opponent_crests add column if not exists crest_url   text;
alter table opponent_crests add column if not exists created_at  timestamptz default now();
alter table opponent_crests add column if not exists updated_at  timestamptz;
alter table opponent_crests add column if not exists owner_id    uuid references auth.users(id) on delete cascade;


-- -----------------------------------------------------------------------------
-- 2. Uniqueness on the lookup key.
-- -----------------------------------------------------------------------------
-- Concurrent pushes from two devices can insert the same club's crest at the
-- same moment. Without a unique index the second insert wins and the coach ends
-- up with a duplicate entry; with one, the upsert retries as an update. The app
-- reuses the existing row's id when replacing, so the ordinary path is an update
-- either way and this only bites on a genuine race.
create unique index if not exists opponent_crests_key_uniq
  on opponent_crests(key);

create index if not exists opponent_crests_owner on opponent_crests(owner_id);


-- -----------------------------------------------------------------------------
-- 3. RLS, matching every other table.
-- -----------------------------------------------------------------------------
alter table opponent_crests enable row level security;

drop policy if exists "own opponent crests" on opponent_crests;
create policy "own opponent crests" on opponent_crests
  for all
  using      (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));


-- =============================================================================
-- VERIFY
-- =============================================================================
-- Expected: 0 rows, until a crest is added from the app.
select * from opponent_crests;


-- Should read enabled = true, and polname = 'own opponent crests'.
select relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'opponent_crests';

select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'opponent_crests';


-- =============================================================================
-- IF YOU WANT TO SEED CRESTS WITHOUT THE APP
-- =============================================================================
-- Not usually necessary -- the app writes these rows itself -- but if you have a
-- logo to hand as a file, this is the shape it takes. `owner_id` is your auth
-- user id, from Supabase -> Authentication -> Users.
--
--   insert into opponent_crests (id, name, key, crest_url, owner_id)
--   values (
--     gen_random_uuid(),
--     'الرجاء البيضاوي',
--     lower(btrim('الرجاء البيضاوي')),
--     'data:image/png;base64,...',
--     '<your-auth-uid>'
--   );
--
-- Note the base64 payload carries no line breaks. The app re-encodes a picked
-- image down to 192px PNG, which is why a crest added through the UI is only a
-- few KB; a raw 500KB logo dropped in here would be re-shipped on every sync.
-- =============================================================================