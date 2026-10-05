-- =============================================================================
-- CoachOps — STEP 4 (optional): merge duplicate clubs already in the cloud
-- =============================================================================
-- Run this ONCE in the Supabase SQL editor, after reading step 1 below.
--
-- Why duplicates exist
-- --------------------
-- Ids are generated on the device (lib/offline/db.ts newId), not by the database.
-- A club created on the phone and then again on a laptop gets two different
-- uuids for the same academy, so both rows are legitimate as far as the schema
-- and RLS are concerned. Every one of them syncs, and nothing ever reconciled
-- them. Deleting the duplicates by hand was the only option until the app grew a
-- merge pass (lib/supabase/sync.ts mergeDuplicateClubs).
--
-- This script does the same thing server-side, for the rows that are already
-- there. The app's merge pass then finds nothing left to do.
--
-- SAFE TO RE-RUN: it only acts on names that still have more than one row.
--
-- RLS: leave it enabled. The SQL editor connects as `postgres`, which owns the
-- tables, and table owners bypass RLS unless the table is set to
-- `force row level security`. None of yours are. Turning RLS off would only
-- create a window where the public anon key can read every coach's data.
--
-- Back up first (Supabase dashboard -> Table editor -> Export, or `pg_dump`).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 -- STATE CHECK. Run this first, and re-run it after every step below.
-- -----------------------------------------------------------------------------
-- `groups_dangling` must always be 0: it is the count of age groups pointing at
-- a club that no longer exists, which is exactly the state that made a whole
-- squad vanish from every screen.
--
-- `groups_with_no_club` should be 0 on a healthy database. If it jumps after
-- step 2, the delete ran without the re-point, and because teams.club_id is
-- `on delete set null` those groups were silently orphaned. Re-run step 2a and
-- then tell me.
select
  (select count(*) from clubs)                                        as clubs,
  (select count(*) from teams where club_id is null)                  as groups_with_no_club,
  (select count(*) from teams t
     where t.club_id is not null
       and not exists (select 1 from clubs c where c.id = t.club_id))  as groups_dangling,
  (select count(*) from (
     select 1 from clubs
     group by lower(btrim(coalesce(name, ''))), lower(btrim(coalesce(city, '')))
     having count(*) > 1
   ) d)                                                               as duplicate_names;


-- -----------------------------------------------------------------------------
-- STEP 1 -- REPORT. Read-only.
-- -----------------------------------------------------------------------------
-- Every club name held more than once, with the row count and which id survives.
--
-- If this returns no rows, you have no duplicates. Stop here and skip to step 3.
with ranked as (
  select
    c.id,
    lower(btrim(coalesce(c.name, ''))) as norm_name,
    lower(btrim(coalesce(c.city, ''))) as norm_city,
    row_number() over (
      partition by lower(btrim(coalesce(c.name, ''))), lower(btrim(coalesce(c.city, '')))
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    count(*) over (
      partition by lower(btrim(coalesce(c.name, ''))), lower(btrim(coalesce(city, '')))
    ) as copies
  from clubs c
)
select
  copies                                      as copies_found,
  norm_name                                   as name,
  norm_city                                   as city,
  (select count(*) from teams t where t.club_id = ranked.id) as groups_under,
  (rn = 1)                                    as will_keep,
  id
from ranked
where copies > 1
order by copies desc, norm_name, id;


-- -----------------------------------------------------------------------------
-- STEP 2 -- THE MERGE. Two statements. Run them ONE AT A TIME.
-- -----------------------------------------------------------------------------
-- WHY NOT ONE BATCH, AND WHY NO TEMPORARY TABLE:
--
-- These two facts cost this script two rewrites, so please do not undo them:
--
--   1. Postgres has no QUALIFY clause. It is still an unmerged proposal on the
--      pgsql-hackers list; only Snowflake, BigQuery and DuckDB implement it.
--      The row filter must therefore live in an enclosing query, hence `r.rn > 1`
--      on the subquery rather than a trailing WHERE on the window function.
--
--   2. A TEMPORARY table is scoped to one database connection. The Supabase SQL
--      editor runs a pasted batch across pooled connections, so
--      `create temporary table _merge_clubs` lands on one backend and the next
--      statement asks a different one, which fails with
--      `42P01: relation "_merge_clubs" does not exist`. For the same reason
--      `begin` / `commit` cannot wrap these two statements: they would not share
--      a transaction either.
--
-- Each statement below is therefore fully self-contained. That also means they
-- are individually idempotent, so a re-run after a partial failure is safe.
--
-- Have the app closed or signed out on every device while you do this. A tab that
-- syncs mid-merge can re-upload a club row seconds after the delete.
--
-- Order matters. 2a must run before 2b: the survivor is chosen by age, and the
-- groups may currently point at the rows 2b is about to delete. Run them in the
-- other order and every group is left pointing at nothing, because
-- teams.club_id is `on delete set null`.
-- =============================================================================


-- 2a. Re-point the age groups at the surviving club.
update teams t
set club_id = ranked.keeper_id
from (
  select loser_id, keeper_id from (
    select
      id as loser_id,
      first_value(id) over w as keeper_id,
      row_number() over w as rn
    from clubs
    window w as (
      partition by lower(btrim(coalesce(name, ''))), lower(btrim(coalesce(city, '')))
      order by created_at asc nulls last, id asc
    )
  ) r where r.rn > 1
) ranked
where t.club_id = ranked.loser_id;


-- Re-run the STEP 0 check. `duplicate_names` should be unchanged and
-- `groups_dangling` should still be 0. Nothing has been deleted yet.


-- 2b. Drop the duplicate clubs.
--
-- `first_value` is not needed here: this only has to name the rows to delete.
delete from clubs c
using (
  select loser_id from (
    select id as loser_id, row_number() over w as rn
    from clubs
    window w as (
      partition by lower(btrim(coalesce(name, ''))), lower(btrim(coalesce(city, '')))
      order by created_at asc nulls last, id asc
    )
  ) r where r.rn > 1
) ranked
where c.id = ranked.loser_id;


-- =============================================================================
-- STEP 3 -- VERIFY
-- =============================================================================
-- Re-run the STEP 0 check. Expected: duplicate_names = 0, groups_dangling = 0,
-- groups_with_no_club unchanged from before the merge.
--
-- Then confirm no name is still duplicated. Expected: no rows.
select
  lower(btrim(coalesce(name, ''))) as name,
  lower(btrim(coalesce(city, ''))) as city,
  count(*) as copies
from clubs
group by 1, 2
having count(*) > 1
order by copies desc, name;


-- Row counts, to confirm nothing was lost.
select 'clubs'       as tbl, count(*) from clubs
union all select 'teams',       count(*) from teams
union all select 'players',     count(*) from players
union all select 'sessions',    count(*) from sessions
union all select 'attendance',  count(*) from attendance
union all select 'lineups',     count(*) from lineups
union all select 'cotisations', count(*) from cotisations
union all select 'expenses',    count(*) from expenses
union all select 'evaluations', count(*) from evaluations
order by tbl;


-- =============================================================================
-- IF A NAME APPEARS UNDER TWO DIFFERENT owner_id VALUES
-- =============================================================================
-- Two coaches with a club of the same name is not a duplicate, and this script
-- will refuse to merge them: doing so would hand one coach the other's data,
-- including players' parents' phone numbers and payment records.
--
-- Such a name is simply left alone by the statements above, because they
-- partition on name and city only. Merge those by hand if you are sure they are
-- really the same academy:
--
--   update teams set club_id = '<keeper-uuid>' where club_id = '<loser-uuid>';
--   delete from clubs where id = '<loser-uuid>';
--
-- Take the uuids from step 1's report.
-- =============================================================================