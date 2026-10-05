import Dexie, { type EntityTable } from "dexie";

/**
 * Primary keys are UUIDs, not auto-increment integers.
 *
 * With sequential ids, two devices signed into the same account each generate
 * the sequence 1, 2, 3... independently. The sync then treats device B's
 * "player 3" as the same row as device A's "player 3" and one silently
 * overwrites the other. UUIDs are generated per row, so collisions are
 * impossible and a coach can use a phone and a tablet safely.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers / non-secure contexts.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Free-form on purpose. `category` is `text` in the database and Dexie does not
 * validate it, and academies do not all use the same age bands (a club might
 * run U8, U11, U18 and "فريق terminology" of its own). The suggested values in
 * SUGGESTED_TEAM_CATEGORIES are only a starting point; the category picker also
 * offers any category already in use by the coach's own age groups.
 */
export type TeamCategory = string;

/** Common age bands, offered as suggestions only. */
export const SUGGESTED_TEAM_CATEGORIES = [
  "U8",
  "U10",
  "U12",
  "U13",
  "U15",
  "U17",
  "U19",
  "U21",
  "Seniors",
] as const;
// Free-form on purpose: the field is `text` in the database and Dexie does not
// validate it, so a coach can keep using whatever wording they like. The
// canonical choices live in the `POSITIONS` constant in
// components/teams/player-directory.tsx, and tactical-board.tsx maps any value
// back to a pitch line (GK/DEF/MID/FWD) for auto-placement.
export type PlayerPosition = string;
export type PlayerStatus = "نشط" | "مصاب" | "غائب";
export type SessionType = "تدريب" | "مباراة" | "لياقة";
export type AttendanceStatus = "حاضر" | "غائب" | "متأخر" | "معذور";
export type LineupVenue = "ملعبنا" | "خارج";
export type LineupLine = "GK" | "DEF" | "MID" | "FWD";
export type PaymentMethod = "نقدي" | "تحويل";
export type CotisationStatus = "paid" | "partial" | "unpaid";
export type ExpenseCategory = "نقل" | "معدات" | "تحكيم" | "صحة وإسعاف" | "متنوع";

/**
 * Fields shared by every table.
 *
 * `owner_id` is the Supabase auth user id of the coach who owns the row. It is
 * mirrored locally so the app can tell whose data it is showing, and so a
 * shared device does not leak one coach's roster to the next. Rows created
 * before auth existed have no `owner_id` and are claimed on first sign-in.
 *
 * `updated_at` drives the last-write-wins merge in lib/supabase/sync.ts.
 */
export interface Owned {
  id?: string;
  owner_id?: string;
  updated_at?: string;
}

/**
 * The coach at the apex of the hierarchy. Keyed by the auth user id, so there
 * is exactly one profile per coach.
 */
export interface CoachProfile {
  id: string;
  full_name?: string;
  phone?: string;
  created_at?: string;
  updated_at?: string;
}

/** A club the coach works for. An age group always belongs to a club. */
export interface Club extends Owned {
  name: string;
  city?: string;
  created_at: string;
}

export interface Evaluation extends Owned {
  player_id: string;
  team_id: string;
  date: string;
  technique: number; // 1-5
  physique: number; // 1-5
  tactique: number; // 1-5
  mental: number; // 1-5
  notes?: string;
  created_at: string;
}

export interface Cotisation extends Owned {
  team_id: string;
  player_id: string;
  month: string; // YYYY-MM
  season: string;
  expected_amount: number;
  paid_amount: number;
  status: CotisationStatus;
  method?: PaymentMethod;
  receipt_number?: string;
  last_payment_date?: string;
  created_at: string;
}

export interface Expense extends Owned {
  team_id: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  created_at: string;
}

export interface LineupSlot {
  key: string;
  line: LineupLine;
  position: string;
  x: number; // 0-100 across pitch
  y: number; // 0-100 down pitch (our goal at bottom)
  player_id: string | null;
}

export interface LineupScorer {
  player_id: string;
  goals: number;
}

export interface Lineup extends Owned {
  team_id: string;
  formation: string;
  opponent: string;
  date: string;
  venue: LineupVenue;
  captain_id: string | null;
  slots: LineupSlot[];
  substitutes: string[];
  created_at: string;
  goals_for?: number;
  goals_against?: number;
  scorers?: LineupScorer[];
  mvp_id?: string | null;
}

export interface Team extends Owned {
  name: string;
  category: TeamCategory;
  season: string;
  /** The club this age group belongs to. Null only for pre-club rows. */
  club_id?: string | null;
  /**
   * Default monthly subscription in dirhams, used when creating a player's
   * cotisation for a new month. Per age group because a club may charge
   * younger players less. Null falls back to FALLBACK_MONTHLY_FEE.
   */
  monthly_fee?: number | null;
  created_at: string;
}

/** Used when a group has no fee configured. */
export const FALLBACK_MONTHLY_FEE = 200;

export interface Player extends Owned {
  team_id: string;
  full_name: string;
  jersey_number: number;
  position: PlayerPosition;
  parent_phone: string;
  status: PlayerStatus;
  photo_url?: string;
  birth_date?: string;
}

export interface TrainingSession extends Owned {
  team_id: string;
  date: string;
  type: SessionType;
  location: string;
  notes?: string;
  time?: string;
}

export interface Attendance extends Owned {
  session_id: string;
  player_id: string;
  status: AttendanceStatus;
  notes?: string;
}

/**
 * A local deletion waiting to be sent to the server. `row_id` is the id of the row
 * that was removed from its own table.
 */
export interface PendingDelete {
  id?: number;
  table_name: TableName;
  row_id: string;
  deleted_at: string;
}

/**
 * Proof that the server once confirmed this row exists. Used to tell "deleted
 * here or elsewhere" apart from "created here and not pushed yet".
 */
export interface SyncedRow {
  id?: number;
  table_name: TableName;
  row_id: string;
  owner_id: string | null;
}

// The database name changed at v7 because Dexie cannot alter a primary key on
// an existing store ("Not yet support for changing primary key"). The previous
// database is left untouched; migrateFromLegacyDb() copies it across on first
// load and then removes it, so nothing is silently abandoned.
const DB_NAME = "CoachOpsDB_v7";

/** The pre-v7 database, read once to migrate data out of it. */
export const LEGACY_DB_NAME = "CoachOpsDB";

const db = new Dexie(DB_NAME) as Dexie & {
  teams: EntityTable<Team, "id">;
  clubs: EntityTable<Club, "id">;
  coach_profiles: EntityTable<CoachProfile, "id">;
  players: EntityTable<Player, "id">;
  sessions: EntityTable<TrainingSession, "id">;
  attendance: EntityTable<Attendance, "id">;
  lineups: EntityTable<Lineup, "id">;
  cotisations: EntityTable<Cotisation, "id">;
  expenses: EntityTable<Expense, "id">;
  evaluations: EntityTable<Evaluation, "id">;
  pending_deletes: EntityTable<PendingDelete, "id">;
  synced_rows: EntityTable<SyncedRow, "id">;
};

db.version(1).stores({
  teams: "++id, name, category, season, created_at",
  players: "++id, team_id, full_name, jersey_number, position, status",
  sessions: "++id, team_id, date, type",
  attendance: "++id, session_id, player_id, status",
});

db.version(2).stores({
  lineups: "++id, team_id, date, opponent, venue, formation",
});

db.version(3).stores({
  cotisations: "++id, team_id, player_id, month, season, status",
  expenses: "++id, team_id, category, date",
});

db.version(4).stores({
  evaluations: "++id, player_id, team_id, date",
});

// v5 adds the `owner_id` index used to scope local queries to the signed-in
// coach. Existing rows are left untouched (owner_id stays undefined) so that
// pre-auth data can still be claimed on first sign-in.
db.version(5).stores({
  teams: "++id, name, category, season, created_at, owner_id",
  players: "++id, team_id, full_name, jersey_number, position, status, owner_id",
  sessions: "++id, team_id, date, type, owner_id",
  attendance: "++id, session_id, player_id, status, owner_id",
  lineups: "++id, team_id, date, opponent, venue, formation, owner_id",
  cotisations: "++id, team_id, player_id, month, season, status, owner_id",
  expenses: "++id, team_id, category, date, owner_id",
  evaluations: "++id, player_id, team_id, date, owner_id",
});

// v6 introduces the club level of the hierarchy (coach -> club -> age group)
// and the coach profile. Existing teams keep `club_id` undefined; the app
// assigns them to a default club on first load rather than dropping data.
db.version(6).stores({
  teams: "++id, name, category, season, created_at, owner_id, club_id",
  clubs: "++id, name, city, created_at, owner_id",
  coach_profiles: "id, updated_at",
});

// v7 switches every primary key from an auto-increment integer to a
// client-generated UUID, so two devices signed into the same account cannot
// mint the same id and silently overwrite each other. Rows written under v6 and
// earlier still carry integer keys; migrateIdsToUuids() in lib/offline/migrate.ts
// rewrites them and remaps every foreign key before the app reads them.
db.version(7).stores({
  teams: "id, name, category, season, created_at, owner_id, club_id",
  clubs: "id, name, city, created_at, owner_id",
  coach_profiles: "id, updated_at",
  players: "id, team_id, full_name, jersey_number, position, status, owner_id",
  sessions: "id, team_id, date, type, owner_id",
  attendance: "id, session_id, player_id, status, owner_id",
  lineups: "id, team_id, date, opponent, venue, formation, owner_id",
  cotisations: "id, team_id, player_id, month, season, status, owner_id",
  expenses: "id, team_id, category, date, owner_id",
  evaluations: "id, player_id, team_id, date, owner_id",
});

// v8 adds two bookkeeping tables. They are local-only and deliberately NOT in
// ALL_TABLES, so they are never pushed to Supabase.
//
// `pending_deletes` is the tombstone queue. Deleting a row locally used to be a
// silent, one-device event: the row vanished from Dexie but stayed on the server,
// and the next pull (which runs on focus, on visibility change, on sign-in and
// every two minutes) happily wrote it back. That is why deletes looked rejected
// and why wiping the cloud tables reappeared a moment later. Now a delete leaves
// a tombstone behind and lib/supabase/sync.ts issues a real DELETE for it.
//
// `synced_rows` remembers which ids the server has confirmed for this coach. It
// is what makes deletions work in the other direction too: on a pull, a local row
// that is in this list but missing from the server response has genuinely been
// deleted (here or on another device) and is removed. A row that is *not* in this
// list is an unsynced local edit and is never touched, which is what stops a
// pull from destroying work that has not been pushed yet.
db.version(8).stores({
  pending_deletes: "++id, table_name, row_id, deleted_at, [table_name+row_id]",
  synced_rows: "++id, table_name, row_id, owner_id, [table_name+row_id]",
});

/** Every table, for use by backup, export and ownership sweeps. */
export const ALL_TABLES = [
  "clubs",
  "coach_profiles",
  "teams",
  "players",
  "sessions",
  "attendance",
  "lineups",
  "cotisations",
  "expenses",
  "evaluations",
] as const;

export type TableName = (typeof ALL_TABLES)[number];

export { db };