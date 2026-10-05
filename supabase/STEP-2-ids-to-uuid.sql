-- =============================================================================
-- CoachOps — STEP 2 of 2 (ONLY IF NEEDED): bigint ids -> UUID
-- =============================================================================
-- RUN THIS ONLY IF the report at the end of STEP 1 showed `bigint` for an id.
--
-- If it showed `uuid`, STOP. Your ids are already correct and running this will
-- REASSIGN EVERY ROW A NEW ID. That is not destructive to your data, but it will
-- orphan the rows currently sitting in the cloud: the app will pull them as new
-- rows and the old copies would remain behind as duplicates. Do not run it.
--
-- Why this exists: the app used to create ids on the device with auto-increment
-- integers, which meant two devices signed into the same account each started
-- their own numbering and silently overwrote each other's rows. Ids are now
-- UUIDs generated on the device, so two devices can never collide. This script
-- converts the existing cloud rows to match.
--
-- Everything runs inside ONE transaction. If any statement fails, the whole
-- thing rolls back and your database is left exactly as it was.
--
-- ORDER MATTERS, and the reason is a Postgres type restriction:
--
--   A UUID cannot be written into a bigint column. So converting straight from
--   bigint to uuid fails with:
--     42804 column "session_id" is of type bigint but expression is of type uuid
--
--   The columns must therefore be widened to text first (text can hold both an
--   old integer and a new uuid string), the ids swapped while they are text, and
--   only then narrowed back to uuid.
--
-- The `drop identity` steps are also required. Postgres refuses to change the
-- type of an identity column:
--   22023 identity column type must be smallint, integer, or bigint
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Drop the foreign keys so column types can change freely.
-- -----------------------------------------------------------------------------
alter table attendance  drop constraint if exists attendance_session_id_fkey;
alter table attendance  drop constraint if exists attendance_player_id_fkey;
alter table players     drop constraint if exists players_team_id_fkey;
alter table sessions    drop constraint if exists sessions_team_id_fkey;
alter table lineups     drop constraint if exists lineups_team_id_fkey;
alter table cotisations drop constraint if exists cotisations_team_id_fkey;
alter table cotisations drop constraint if exists cotisations_player_id_fkey;
alter table expenses    drop constraint if exists expenses_team_id_fkey;
alter table evaluations drop constraint if exists evaluations_team_id_fkey;
alter table evaluations drop constraint if exists evaluations_player_id_fkey;
alter table teams       drop constraint if exists teams_club_id_fkey;


-- -----------------------------------------------------------------------------
-- 2. Mapping tables: old integer id -> brand new UUID.
--    Nothing can be remapped before these exist.
-- -----------------------------------------------------------------------------
create temporary table _m_clubs    as select id::bigint as old_id, gen_random_uuid() as new_id from clubs;
create temporary table _m_teams    as select id::bigint as old_id, gen_random_uuid() as new_id from teams;
create temporary table _m_players  as select id::bigint as old_id, gen_random_uuid() as new_id from players;
create temporary table _m_sessions as select id::bigint as old_id, gen_random_uuid() as new_id from sessions;
create temporary table _m_att      as select id::bigint as old_id, gen_random_uuid() as new_id from attendance;
create temporary table _m_lineups  as select id::bigint as old_id, gen_random_uuid() as new_id from lineups;
create temporary table _m_cot      as select id::bigint as old_id, gen_random_uuid() as new_id from cotisations;
create temporary table _m_exp      as select id::bigint as old_id, gen_random_uuid() as new_id from expenses;
create temporary table _m_eval     as select id::bigint as old_id, gen_random_uuid() as new_id from evaluations;


-- -----------------------------------------------------------------------------
-- 3. Widen every id column to text.
--    `drop identity` first: Postgres will not retype an identity column.
-- -----------------------------------------------------------------------------
alter table clubs       alter column id drop identity;
alter table teams       alter column id drop identity;
alter table players     alter column id drop identity;
alter table sessions    alter column id drop identity;
alter table attendance  alter column id drop identity;
alter table lineups     alter column id drop identity;
alter table cotisations alter column id drop identity;
alter table expenses    alter column id drop identity;
alter table evaluations alter column id drop identity;

alter table clubs       alter column id type text;
alter table teams       alter column id type text;
alter table teams       alter column club_id type text;
alter table players     alter column id type text;
alter table players     alter column team_id type text;
alter table sessions    alter column id type text;
alter table sessions    alter column team_id type text;
alter table attendance  alter column id type text;
alter table attendance  alter column session_id type text;
alter table attendance  alter column player_id type text;
alter table lineups     alter column id type text;
alter table lineups     alter column team_id type text;
alter table lineups     alter column captain_id type text;
alter table lineups     alter column mvp_id type text;
alter table cotisations alter column id type text;
alter table cotisations alter column team_id type text;
alter table cotisations alter column player_id type text;
alter table expenses    alter column id type text;
alter table expenses    alter column team_id type text;
alter table evaluations alter column id type text;
alter table evaluations alter column team_id type text;
alter table evaluations alter column player_id type text;


-- -----------------------------------------------------------------------------
-- 4. Swap old ids for new ones, everywhere.
-- -----------------------------------------------------------------------------
update clubs       set id       = (select new_id::text from _m_clubs   where old_id = clubs.id::bigint);
update teams       set id       = (select new_id::text from _m_teams   where old_id = teams.id::bigint);
update teams       set club_id  = (select new_id::text from _m_clubs   where old_id = teams.club_id::bigint);
update players     set id       = (select new_id::text from _m_players where old_id = players.id::bigint);
update players     set team_id  = (select new_id::text from _m_teams   where old_id = players.team_id::bigint);
update sessions    set id       = (select new_id::text from _m_sessions where old_id = sessions.id::bigint);
update sessions    set team_id  = (select new_id::text from _m_teams    where old_id = sessions.team_id::bigint);
update attendance  set id        = (select new_id::text from _m_att      where old_id = attendance.id::bigint);
update attendance  set session_id = (select new_id::text from _m_sessions where old_id = attendance.session_id::bigint);
update attendance  set player_id  = (select new_id::text from _m_players  where old_id = attendance.player_id::bigint);
update lineups     set id        = (select new_id::text from _m_lineups  where old_id = lineups.id::bigint);
update lineups     set team_id   = (select new_id::text from _m_teams    where old_id = lineups.team_id::bigint);
update lineups     set captain_id = (select new_id::text from _m_players where old_id = lineups.captain_id::bigint);
update lineups     set mvp_id     = (select new_id::text from _m_players where old_id = lineups.mvp_id::bigint);
update cotisations set id        = (select new_id::text from _m_cot      where old_id = cotisations.id::bigint);
update cotisations set team_id   = (select new_id::text from _m_teams    where old_id = cotisations.team_id::bigint);
update cotisations set player_id = (select new_id::text from _m_players  where old_id = cotisations.player_id::bigint);
update expenses    set id        = (select new_id::text from _m_exp      where old_id = expenses.id::bigint);
update expenses    set team_id   = (select new_id::text from _m_teams    where old_id = expenses.team_id::bigint);
update evaluations set id        = (select new_id::text from _m_eval     where old_id = evaluations.id::bigint);
update evaluations set team_id   = (select new_id::text from _m_teams    where old_id = evaluations.team_id::bigint);
update evaluations set player_id = (select new_id::text from _m_players  where old_id = evaluations.player_id::bigint);


-- -----------------------------------------------------------------------------
-- 5. Player ids buried inside lineup jsonb columns.
--    Skipping these would leave a saved lineup pointing at players that no
--    longer exist, so the pitch would come back empty.
-- -----------------------------------------------------------------------------
update lineups set slots = (
  select coalesce(jsonb_agg(
    case
      when elem ->> 'player_id' is null then elem
      else jsonb_set(elem, '{player_id}',
        to_jsonb(coalesce(
          (select new_id::text from _m_players where old_id = (elem ->> 'player_id')::bigint),
          elem ->> 'player_id')))
    end order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(slots) with ordinality as e(elem, ord)
);

update lineups set substitutes = (
  select coalesce(jsonb_agg(
    to_jsonb(coalesce(
      (select new_id::text from _m_players where old_id = v::bigint),
      v))
  ), '[]'::jsonb)
  from jsonb_array_elements_text(substitutes) as v
);

update lineups set scorers = (
  select coalesce(jsonb_agg(
    case
      when s ->> 'player_id' is null then s
      else jsonb_set(s, '{player_id}',
        to_jsonb(coalesce(
          (select new_id::text from _m_players where old_id = (s ->> 'player_id')::bigint),
          s ->> 'player_id')))
    end order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(scorers) with ordinality as e(s, ord)
);


-- -----------------------------------------------------------------------------
-- 6. Narrow text back to uuid. This only works now because step 4 and 5 put
--    valid uuid strings into every column.
-- -----------------------------------------------------------------------------
alter table clubs       alter column id type uuid using id::uuid;
alter table teams       alter column id type uuid using id::uuid;
alter table teams       alter column club_id type uuid using club_id::uuid;
alter table players     alter column id type uuid using id::uuid;
alter table players     alter column team_id type uuid using team_id::uuid;
alter table sessions    alter column id type uuid using id::uuid;
alter table sessions    alter column team_id type uuid using team_id::uuid;
alter table attendance  alter column id type uuid using id::uuid;
alter table attendance  alter column session_id type uuid using session_id::uuid;
alter table attendance  alter column player_id type uuid using player_id::uuid;
alter table lineups     alter column id type uuid using id::uuid;
alter table lineups     alter column team_id type uuid using team_id::uuid;
alter table lineups     alter column captain_id type uuid using captain_id::uuid;
alter table lineups     alter column mvp_id type uuid using mvp_id::uuid;
alter table cotisations alter column id type uuid using id::uuid;
alter table cotisations alter column team_id type uuid using team_id::uuid;
alter table cotisations alter column player_id type uuid using player_id::uuid;
alter table expenses    alter column id type uuid using id::uuid;
alter table expenses    alter column team_id type uuid using team_id::uuid;
alter table evaluations alter column id type uuid using id::uuid;
alter table evaluations alter column team_id type uuid using team_id::uuid;
alter table evaluations alter column player_id type uuid using player_id::uuid;

-- Server-side inserts (e.g. from the dashboard) still need a default.
alter table clubs       alter column id set default gen_random_uuid();
alter table teams       alter column id set default gen_random_uuid();
alter table players     alter column id set default gen_random_uuid();
alter table sessions    alter column id set default gen_random_uuid();
alter table attendance  alter column id set default gen_random_uuid();
alter table lineups     alter column id set default gen_random_uuid();
alter table cotisations alter column id set default gen_random_uuid();
alter table expenses    alter column id set default gen_random_uuid();
alter table evaluations alter column id set default gen_random_uuid();


-- -----------------------------------------------------------------------------
-- 7. Restore the foreign keys. Cascade behaviour is preserved exactly:
--    deleting a group still removes its players, sessions and attendance.
-- -----------------------------------------------------------------------------
alter table attendance  add constraint attendance_session_id_fkey
  foreign key (session_id) references sessions(id) on delete cascade;
alter table attendance  add constraint attendance_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;
alter table players     add constraint players_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table sessions    add constraint sessions_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table lineups     add constraint lineups_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table cotisations add constraint cotisations_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table cotisations add constraint cotisations_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;
alter table expenses    add constraint expenses_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table evaluations add constraint evaluations_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
alter table evaluations add constraint evaluations_player_id_fkey
  foreign key (player_id) references players(id) on delete cascade;
alter table teams       add constraint teams_club_id_fkey
  foreign key (club_id) references clubs(id) on delete set null;

commit;


-- =============================================================================
-- 8. REPORT. Read-only. Every row should now say `uuid`.
-- =============================================================================
select table_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name = 'id'
order by table_name;

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