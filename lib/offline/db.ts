import Dexie, { type EntityTable } from "dexie";

export type TeamCategory = "U13" | "U15" | "U17" | "Seniors";
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
  id?: number;
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
  player_id: number;
  team_id: number;
  date: string;
  technique: number; // 1-5
  physique: number; // 1-5
  tactique: number; // 1-5
  mental: number; // 1-5
  notes?: string;
  created_at: string;
}

export interface Cotisation extends Owned {
  team_id: number;
  player_id: number;
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
  team_id: number;
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
  player_id: number | null;
}

export interface LineupScorer {
  player_id: number;
  goals: number;
}

export interface Lineup extends Owned {
  team_id: number;
  formation: string;
  opponent: string;
  date: string;
  venue: LineupVenue;
  captain_id: number | null;
  slots: LineupSlot[];
  substitutes: number[];
  created_at: string;
  goals_for?: number;
  goals_against?: number;
  scorers?: LineupScorer[];
  mvp_id?: number | null;
}

export interface Team extends Owned {
  name: string;
  category: TeamCategory;
  season: string;
  /** The club this age group belongs to. Null only for pre-club rows. */
  club_id?: number | null;
  created_at: string;
}

export interface Player extends Owned {
  team_id: number;
  full_name: string;
  jersey_number: number;
  position: PlayerPosition;
  parent_phone: string;
  status: PlayerStatus;
  photo_url?: string;
  birth_date?: string;
}

export interface TrainingSession extends Owned {
  team_id: number;
  date: string;
  type: SessionType;
  location: string;
  notes?: string;
  time?: string;
}

export interface Attendance extends Owned {
  session_id: number;
  player_id: number;
  status: AttendanceStatus;
  notes?: string;
}

const db = new Dexie("CoachOpsDB") as Dexie & {
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