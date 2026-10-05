-- =============================================================================
-- CoachOps — STEP 1 of 2: bring the database in line with the app
-- =============================================================================
-- RUN THIS FIRST, IN THE SUPABASE SQL EDITOR. Replace the editor contents
-- entirely with this file.
--
-- This is SAFE TO RUN AS MANY TIMES AS YOU LIKE. Every statement is either
-- `if not exists`, `if exists`, or a read-only SELECT. It cannot destroy data.
--
-- Why: the app is offline-first, so a coach can lose sight of the fact that the
-- cloud schema has drifted out of date. Two things break when that happens, and
-- both fail silently-ish:
--
--   1. A synced table missing `updated_at` makes the whole push fail with
--      PGRST204, because the sync engine compares that timestamp on every row.
--   2. A missing `owner_id` means row-level security has nothing to match, so
--      the coach cannot read their own data back.
--
-- `create table if not exists` is a NO-OP on a table that already exists, which
-- is why new columns have to be added explicitly by ALTER TABLE below.
--
-- After running this, look at the two result grids at the bottom and then run
-- STEP 2.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The sync timestamp. Missing on any synced table = the whole table fails.
-- -----------------------------------------------------------------------------
alter table teams       add column if not exists updated_at timestamptz;
alter table players     add column if not exists updated_at timestamptz;
alter table sessions    add column if not exists updated_at timestamptz;
alter table attendance  add column if not exists updated_at timestamptz;
alter table lineups     add column if not exists updated_at timestamptz;
alter table cotisations add column if not exists updated_at timestamptz;
alter table expenses    add column if not exists updated_at timestamptz;
alter table evaluations add column if not exists updated_at timestamptz;
alter table clubs       add column if not exists updated_at timestamptz;
alter table coach_profiles add column if not exists updated_at timestamptz;


-- -----------------------------------------------------------------------------
-- 2. Ownership. Row-level security scopes every row to the coach who created it.
--    This is the security boundary that keeps one coach off another's players'
--    phone numbers and payment records, so it must not be skipped.
-- -----------------------------------------------------------------------------
alter table teams       add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table players     add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table sessions    add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table attendance  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table lineups     add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table cotisations add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table expenses    add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table evaluations add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table clubs       add column if not exists owner_id uuid references auth.users(id) on delete cascade;


-- -----------------------------------------------------------------------------
-- 3. Club level of the hierarchy. Both are later additions, so an older
--    database will not have them even though `create table if not exists teams`
--    claims success.
-- -----------------------------------------------------------------------------
alter table teams add column if not exists club_id uuid references clubs(id) on delete set null;
alter table teams add column if not exists monthly_fee numeric;


-- -----------------------------------------------------------------------------
-- 4. Player photos. Stored inline as a base64 data URL rather than a Storage
--    object URL, so a photo added at training survives being offline and rides
--    along with the normal row sync.
-- -----------------------------------------------------------------------------
alter table players add column if not exists photo_url text;


-- -----------------------------------------------------------------------------
-- 5. Row Level Security must be ON. Without it the anon key in the browser can
--    read every coach's data, including parents' phone numbers.
-- -----------------------------------------------------------------------------
alter table teams         enable row level security;
alter table players       enable row level security;
alter table sessions      enable row level security;
alter table attendance    enable row level security;
alter table lineups       enable row level security;
alter table cotisations   enable row level security;
alter table expenses      enable row level security;
alter table evaluations   enable row level security;
alter table clubs         enable row level security;
alter table coach_profiles enable row level security;


-- -----------------------------------------------------------------------------
-- 6. Indexes. Speeds up the per-group reads the app makes on every page.
-- -----------------------------------------------------------------------------
create index if not exists idx_players_team        on players(team_id);
create index if not exists idx_sessions_team       on sessions(team_id);
create index if not exists idx_attendance_session  on attendance(session_id);
create index if not exists idx_attendance_player   on attendance(player_id);
create index if not exists idx_cotisations_team    on cotisations(team_id);
create index if not exists idx_expenses_team       on expenses(team_id);
create index if not exists idx_lineups_team        on lineups(team_id);
create index if not exists idx_teams_club          on teams(club_id);
create index if not exists idx_teams_owner         on teams(owner_id);
create index if not exists idx_players_owner       on players(owner_id);
create index if not exists idx_sessions_owner      on sessions(owner_id);
create index if not exists idx_attendance_owner    on attendance(owner_id);
create index if not exists idx_lineups_owner       on lineups(owner_id);
create index if not exists idx_cotisations_owner   on cotisations(owner_id);
create index if not exists idx_expenses_owner      on expenses(owner_id);
create index if not exists idx_evaluations_owner   on evaluations(owner_id);
create index if not exists idx_clubs_owner         on clubs(owner_id);


-- =============================================================================
-- 7. REPORT. Read-only. Send me these two tables.
-- =============================================================================

-- 7a. Column type of every id. THIS DECIDES WHETHER YOU NEED STEP 2.
--     `bigint` -> run step 2 (migrate to uuid)
--     `uuid`   -> skip step 2, the ids are already correct
select table_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name = 'id'
order by table_name;

-- 7b. Which optional columns exist. Every synced table needs updated_at.
--     Should list 11 rows; fewer means something above did not apply.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and column_name in ('updated_at', 'owner_id')
order by table_name, column_name;