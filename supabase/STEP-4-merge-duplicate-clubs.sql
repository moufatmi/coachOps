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
-- Back up first (Supabase dashboard -> Table editor -> Export, or
-- `pg_dump`).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 -- REPORT FIRST. Read this output before running step 2.
-- -----------------------------------------------------------------------------
-- Shows every club name held more than once, with the row count and the id that
-- will be kept (oldest by created_at, ties broken by id so the winner is stable).
--
-- If this returns no rows, you have no duplicates and should stop here.
with ranked as (
  select
    c.id,
    c.name,
    c.city,
    c.owner_id,
    c.created_at,
    lower(btrim(coalesce(c.name, ''))) as norm_name,
    lower(btrim(coalesce(c.city, ''))) as norm_city,
    row_number() over (
      partition by lower(btrim(coalesce(c.name, ''))), lower(btrim(coalesce(c.city, '')))
      order by c.created_at asc nulls last, c.id asc
    ) as rn,
    count(*) over (
      partition by lower(btrim(coalesce(c.name, ''))), lower(btrim(coalesce(c.city, '')))
    ) as copies
  from clubs c
)
select
  copies                                   as copies_found,
  norm_name                                as name,
  norm_city                                as city,
  (select count(*) from teams t where t.club_id = ranked.id) as groups_under_this_row,
  (rn = 1)                                 as will_keep,
  id
from ranked
where copies > 1
order by copies desc, norm_name, id;


-- =============================================================================
-- STEP 2 -- THE MERGE. Only run this after reading step 1.
-- =============================================================================
-- Everything runs inside ONE transaction: if any statement fails, nothing
-- changes and your database is left exactly as it was.
--
-- Two things happen, in this order, because order is load-bearing:
--
--   1. teams.club_id is re-pointed at the surviving row. This must happen
--      first, because the survivor is chosen by age and the losers may be the
--      rows your age groups currently point at. Do it afterwards instead and
--      every group would be left on a deleted club.
--
--   2. The losing rows are deleted.
--
-- `coalesce(club_id, ...)`: a group with club_id = NULL is an orphan from
-- before the club level existed, not a duplicate, and is left alone.
--
-- Note on `teams.club_id`'s foreign key: it is `on delete set null`, so the
-- losers would not have blocked the delete, but leaving them pointing nowhere is
-- what made a whole age group vanish from every screen.
-- =============================================================================

begin;

-- Sanity check: refuse to run if a name spans more than one owner. That means the
-- same academy legitimately belongs to two different coach accounts, and merging
-- across accounts would hand one coach the other's data.
do $$
declare
  mixed integer;
begin
  select count(*) into mixed
  from (
    select lower(btrim(coalesce(name, ''))) as n, lower(btrim(coalesce(city, ''))) as c
    from clubs
    group by 1, 2
    having count(*) > 1 and count(distinct owner_id) > 1
  ) s;
  if mixed > 0 then
    raise exception
      'Aborting: % name(s) are duplicated across different owner_id values. Those are different coaches, not duplicates. Merge them by hand.', mixed;
  end if;
end $$;

create temporary table _merge_clubs as
select
  id as loser_id,
  first_value(id) over (
    partition by lower(btrim(coalesce(name, ''))), lower(btrim(coalesce(city, '')))
    order by created_at asc nulls last, id asc
  ) as keeper_id
from clubs
qualify row_number() over (
  partition by lower(btrim(coalesce(name, ''))), lower(btrim(coalesce(city, '')))
  order by created_at asc nulls last, id asc
) > 1;


-- 1. Re-point the age groups at the surviving club.
update teams t
set club_id = m.keeper_id
from _merge_clubs m
where t.club_id = m.loser_id;


-- 2. Drop the duplicate clubs.
delete from clubs c
using _merge_clubs m
where c.id = m.loser_id;


-- 3. Confirm nothing is left dangling. Expected: zero rows.
select count(*) as groups_still_pointing_at_nothing
from teams t
where t.club_id is not null
  and not exists (select 1 from clubs c where c.id = t.club_id);


drop table _merge_clubs;

commit;


-- =============================================================================
-- STEP 3 -- VERIFY
-- =============================================================================
-- Every name should appear once. Expected: no rows.
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