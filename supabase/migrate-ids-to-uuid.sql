-- CoachOps: bigint ids -> UUID
-- Run ONCE in the Supabase SQL editor. Replace the editor contents entirely.
--
-- Why this version is ordered the way it is:
--   A UUID cannot be written into a bigint column, so every column is first
--   widened to text, remapped, then narrowed to uuid. Converting straight from
--   bigint to uuid fails with:
--     42804 column "session_id" is of type bigint but expression is of type uuid
--
-- Everything runs inside one transaction: if any step fails, nothing changes.

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop foreign keys so column types can change freely.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Mapping tables: old integer id -> brand new UUID.
--    Nothing else can be remapped before this exists.
-- ---------------------------------------------------------------------------
create temporary table _m_clubs    as select id::bigint as old_id, gen_random_uuid() as new_id from clubs;
create temporary table _m_teams    as select id::bigint as old_id, gen_random_uuid() as new_id from teams;
create temporary table _m_players  as select id::bigint as old_id, gen_random_uuid() as new_id from players;
create temporary table _m_sessions as select id::bigint as old_id, gen_random_uuid() as new_id from sessions;
create temporary table _m_att      as select id::bigint as old_id, gen_random_uuid() as new_id from attendance;
create temporary table _m_lineups  as select id::bigint as old_id, gen_random_uuid() as new_id from lineups;
create temporary table _m_cot      as select id::bigint as old_id, gen_random_uuid() as new_id from cotisations;
create temporary table _m_exp      as select id::bigint as old_id, gen_random_uuid() as new_id from expenses;
create temporary table _m_eval     as select id::bigint as old_id, gen_random_uuid() as new_id from evaluations;

-- ---------------------------------------------------------------------------
-- 3. Widen every id column to text. bigint -> text is always safe, and text is
--    the only type that can hold both an old integer and a new uuid string.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Swap old ids for new ones, everywhere.
-- ---------------------------------------------------------------------------
update clubs       set id = (select new_id::text from _m_clubs   where old_id = clubs.id::bigint);
update teams       set id = (select new_id::text from _m_teams   where old_id = teams.id::bigint);
update teams       set club_id = (select new_id::text from _m_clubs where old_id = teams.club_id::bigint);
update players     set id = (select new_id::text from _m_players where old_id = players.id::bigint);
update players     set team_id = (select new_id::text from _m_teams where old_id = players.team_id::bigint);
update sessions    set id = (select new_id::text from _m_sessions where old_id = sessions.id::bigint);
update sessions    set team_id = (select new_id::text from _m_teams where old_id = sessions.team_id::bigint);
update attendance  set id = (select new_id::text from _m_att     where old_id = attendance.id::bigint);
update attendance  set session_id = (select new_id::text from _m_sessions where old_id = attendance.session_id::bigint);
update attendance  set player_id = (select new_id::text from _m_players  where old_id = attendance.player_id::bigint);
update lineups     set id = (select new_id::text from _m_lineups where old_id = lineups.id::bigint);
update lineups     set team_id = (select new_id::text from _m_teams where old_id = lineups.team_id::bigint);
update lineups     set captain_id = (select new_id::text from _m_players where old_id = lineups.captain_id::bigint);
update lineups     set mvp_id = (select new_id::text from _m_players where old_id = lineups.mvp_id::bigint);
update cotisations set id = (select new_id::text from _m_cot     where old_id = cotisations.id::bigint);
update cotisations set team_id = (select new_id::text from _m_teams   where old_id = cotisations.team_id::bigint);
update cotisations set player_id = (select new_id::text from _m_players where old_id = cotisations.player_id::bigint);
update expenses    set id = (select new_id::text from _m_exp     where old_id = expenses.id::bigint);
update expenses    set team_id = (select new_id::text from _m_teams   where old_id = expenses.team_id::bigint);
update evaluations set id = (select new_id::text from _m_eval    where old_id = evaluations.id::bigint);
update evaluations set team_id = (select new_id::text from _m_teams   where old_id = evaluations.team_id::bigint);
update evaluations set player_id = (select new_id::text from _m_players where old_id = evaluations.player_id::bigint);

-- ---------------------------------------------------------------------------
-- 5. Player ids nested inside lineup jsonb columns.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 6. Narrow text back to uuid. This only works now because step 4/5 put valid
--    uuid strings in every column.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 7. Restore the constraints.
-- ---------------------------------------------------------------------------
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