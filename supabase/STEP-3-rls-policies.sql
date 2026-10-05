-- =============================================================================
-- CoachOps — RLS policies (run once, after STEP 1)
-- =============================================================================
-- RUN THIS IN THE SUPABASE SQL EDITOR, AFTER STEP 1 AND ONLY ONCE.
--
-- Postgres has no `create policy if not exists`, so this file is NOT safe to
-- re-run as-is: a second run errors with
--   42710 policy "..." for table "..." already exists
--
-- That is harmless — the policies already exist and are correct — but the error
-- is noise. If you have already run this file, skip it.
--
-- WHAT THIS DOES AND WHY IT MATTERS
--
-- STEP 1 turns Row Level Security ON for every table. On its own that would lock
-- the app out entirely: RLS with no policy denies everything, including the coach
-- trying to read their own data. These policies are what open the door back up,
-- and only for the rows a given signed-in coach owns.
--
-- Without them, or with them missing on any one table, the app fails with a 401
-- or an empty list. With them in place:
--
--   - A coach sees only their own rows, never another coach's.
--   - This includes parents' phone numbers and payment records, which is the
--     sensitive part.
--   - The anon key lives in the browser bundle and is public. These policies are
--     the ONLY thing standing between it and every coach's data, so this file is
--     not optional.
--
-- It runs as the signed-in user via `auth.uid()`. There is deliberately NO
-- policy allowing anonymous reads: an unsigned request matches none of these and
-- is rejected.
-- =============================================================================

begin;

-- Coach profile: keyed by the coach's own auth id.
drop policy if exists "own coach profile" on coach_profiles;
create policy "own coach profile" on coach_profiles
  for all
  using  (id = auth.uid())
  with check (id = auth.uid());

-- Clubs and age groups.
drop policy if exists "own clubs" on clubs;
create policy "own clubs" on clubs
  for all
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "own teams" on teams;
create policy "own teams" on teams
  for all
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Everything below hangs off a group, so each policy checks the parent row's
-- owner rather than repeating the rule.
drop policy if exists "own players" on players;
create policy "own players" on players
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = players.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = players.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "own sessions" on sessions;
create policy "own sessions" on sessions
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = sessions.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = sessions.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "own attendance" on attendance;
create policy "own attendance" on attendance
  for all
  using  (
    owner_id = auth.uid()
    or exists (
      select 1 from sessions s
      join teams t on t.id = s.team_id
      where s.id = attendance.session_id and t.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from sessions s
      join teams t on t.id = s.team_id
      where s.id = attendance.session_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "own lineups" on lineups;
create policy "own lineups" on lineups
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = lineups.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = lineups.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "own cotisations" on cotisations;
create policy "own cotisations" on cotisations
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = cotisations.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = cotisations.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "own expenses" on expenses;
create policy "own expenses" on expenses
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = expenses.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = expenses.team_id and t.owner_id = auth.uid())
  );

drop policy if exists "own evaluations" on evaluations;
create policy "own evaluations" on evaluations
  for all
  using  (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = evaluations.team_id and t.owner_id = auth.uid())
  )
  with check (
    owner_id = auth.uid()
    or exists (select 1 from teams t where t.id = evaluations.team_id and t.owner_id = auth.uid())
  );

commit;


-- =============================================================================
-- REPORT. Read-only. Should list 10 rows, one per table.
-- =============================================================================
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename;