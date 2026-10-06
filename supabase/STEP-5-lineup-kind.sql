-- =============================================================================
-- CoachOps — STEP 5: add the lineup "kind" column (official vs training)
-- =============================================================================
-- Run this ONCE in the Supabase SQL editor.
--
-- Until now a saved lineup was always treated as an official fixture. The app
-- now lets a coach save a training match through the same pitch screen, so the
-- server needs somewhere to record which it is. Without this column every push
-- fails with:
--
--   PGRST204: Could not find the 'kind' column of 'lineups' in the schema cache
--
-- WHY THE APP CANNOT JUST OMIT IT
-- --------------------------------
-- The sync engine upserts whole rows and never diffs columns, so a client
-- holding `kind: "training"` sends that key whether or not the column exists.
-- There is no way to save a training match until the column is there.
--
-- SAFE TO RE-RUN. Both statements are guarded.
--
-- RLS: leave it enabled. This is a schema change, not a data fix, and the SQL
-- editor connects as `postgres`, which owns the table and bypasses RLS anyway.
-- =============================================================================

-- 1. The column. A plain text column rather than a Postgres enum: an enum needs
--    its type created and dropped in a specific order, and adding a new value to
--    one later is awkward. The app only ever writes 'official' or 'training'.
--
--    Existing rows are backfilled to 'official', which is what they were. The
--    match centre had no training mode before this, so nothing already saved was
--    a drill.
alter table lineups add column if not exists kind text;

update lineups set kind = 'official' where kind is null or kind = '';

-- 2. A CHECK rather than trusting the client. A row that arrives with some other
--    value would silently fail the app's `kind === "training"` test and be
--    treated as an official fixture, quietly inflating the season record. Better
--    to reject it at the door.
--
--    The default covers the rare case of an insert that omits `kind`, so a
--    direct dashboard edit cannot create an uncountable row by accident.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lineups_kind_check'
  ) then
    alter table lineups
      add constraint lineups_kind_check
      check (kind is null or kind in ('official', 'training'));
  end if;
end $$;

alter table lineups alter column kind set default 'official';

-- The app filters saved lineups by kind, and Dexie indexes it locally, so the
-- same index is needed here for the query to stay cheap as history grows.
create index if not exists idx_lineups_kind on lineups(kind);


-- =============================================================================
-- VERIFY
-- =============================================================================
-- Every existing row should read 'official'.
select kind, count(*) from lineups group by kind order by kind;

-- Should return the column with data_type = 'text'.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'lineups' and column_name = 'kind';


-- =============================================================================
-- IF YOU WANT TO RECLASSIFY A SAVED LINEUP
-- =============================================================================
-- Find the id first, from the Tactical Board's saved-lineups list:
--
--   select id, date, opponent, kind from lineups order by date desc;
--
-- Then set it, and let the app pull:
--
--   update lineups set kind = 'training' where id = '<lineup-uuid>';
--   update lineups set kind = 'official' where id = '<lineup-uuid>';
--
-- Changing it here changes it on every device on their next pull, which is what
-- you want. There is no reason to edit Dexie directly.
-- =============================================================================