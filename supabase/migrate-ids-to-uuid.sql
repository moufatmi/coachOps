-- CoachOps: bigint ids -> UUID
-- Run this ONCE in the Supabase SQL editor, replacing the current contents.
-- It is wrapped in a transaction: if any step fails, nothing changes.
--
-- Do NOT paste any other statements into this editor window before clicking Run.

begin;

-- 1. Mapping tables: remember each old integer id alongside its new UUID.
create temporary table _m_clubs  as select id, gen_random_uuid() as nid from clubs;
create temporary table _m_teams  as select id, gen_random_uuid() as nid from teams;
create temporary table _m_players as select id, gen_random_uuid() as nid from players;
create temporary table _m_sessions as select id, gen_random_uuid() as nid from sessions;
create temporary table _m_att     as select id, gen_random_uuid() as nid from attendance;
create temporary table _m_lineups as select id, gen_random_uuid() as nid from lineups;
create temporary table _m_cot     as select id, gen_random_uuid() as nid from cotisations;
create temporary table _m_exp     as select id, gen_random_uuid() as nid from expenses;
create temporary table _m_eval    as select id, gen_random_uuid() as nid from evaluations;

-- 2. Foreign keys first: every reference must become a UUID BEFORE the ids they
--    point at are retyped. Doing these after step 3 would try to cast a uuid
--    into a still-bigint column and fail.
update attendance  set session_id = (select nid from _m_sessions where _m_sessions.id = attendance.session_id);
update attendance  set player_id  = (select nid from _m_players  where _m_players.id  = attendance.player_id);

update players     set team_id    = (select nid from _m_teams    where _m_teams.id    = players.team_id);
update sessions    set team_id    = (select nid from _m_teams    where _m_teams.id    = sessions.team_id);
update lineups     set team_id    = (select nid from _m_teams    where _m_teams.id    = lineups.team_id);
update cotisations set team_id    = (select nid from _m_teams    where _m_teams.id    = cotisations.team_id);
update expenses    set team_id    = (select nid from _m_teams    where _m_teams.id    = expenses.team_id);
update evaluations set team_id    = (select nid from _m_teams    where _m_teams.id    = evaluations.team_id);
update evaluations set player_id  = (select nid from _m_players  where _m_players.id  = evaluations.player_id);
update cotisations set player_id  = (select nid from _m_players  where _m_players.id  = cotisations.player_id);
update teams       set club_id    = (select nid from _m_clubs   where _m_clubs.id   = teams.club_id);

-- captain_id / mvp_id are plain uuid columns with no foreign key, but they hold
-- player ids and still need converting.
update lineups     set captain_id = (select nid from _m_players where _m_players.id = lineups.captain_id)
  where captain_id is not null;
update lineups     set mvp_id     = (select nid from _m_players where _m_players.id = lineups.mvp_id)
  where mvp_id is not null;

-- 3. Primary keys: children before parents, because the FK constraints point at
--    the parent columns being retyped.
alter table attendance  alter column id type uuid using id::uuid;
alter table players     alter column id type uuid using id::uuid;
alter table sessions    alter column id type uuid using id::uuid;
alter table lineups     alter column id type uuid using id::uuid;
alter table cotisations alter column id type uuid using id::uuid;
alter table expenses    alter column id type uuid using id::uuid;
alter table evaluations alter column id type uuid using id::uuid;
alter table teams       alter column id type uuid using id::uuid;
alter table clubs       alter column id type uuid using id::uuid;

-- 4. Foreign key columns.
alter table attendance  alter column session_id type uuid using session_id::uuid;
alter table attendance  alter column player_id  type uuid using player_id::uuid;
alter table players     alter column team_id    type uuid using team_id::uuid;
alter table sessions    alter column team_id    type uuid using team_id::uuid;
alter table lineups     alter column team_id    type uuid using team_id::uuid;
alter table cotisations alter column team_id    type uuid using team_id::uuid;
alter table cotisations alter column player_id  type uuid using player_id::uuid;
alter table expenses    alter column team_id    type uuid using team_id::uuid;
alter table evaluations alter column team_id    type uuid using team_id::uuid;
alter table evaluations alter column player_id  type uuid using player_id::uuid;
alter table teams       alter column club_id    type uuid using club_id::uuid;

commit;