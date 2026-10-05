import {
  db,
  ALL_TABLES,
  type Attendance,
  type Club,
  type Cotisation,
  type Evaluation,
  type Expense,
  type Lineup,
  type Player,
  type TableName,
  type Team,
  type TrainingSession,
} from "./db";
import { forgetAllSynced, stageDeleteMany } from "./sync-ledger";

/**
 * Narrow an untrusted JSON value to an array of `T`. Backup files are user
 * supplied and can come from an older version of the app, so every table is
 * validated before it reaches Dexie.
 */
function rowsOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * `owner_id` is intentionally omitted from backups: a file restored on another
 * account must be re-adopted by whoever imports it, not carry the previous
 * owner's tag. `coach_profiles` is keyed by the auth user id, so it is left out
 * of backups entirely — the profile belongs to the signed-in coach.
 */
function stripOwner<T extends { owner_id?: string }>(rows: T[]): T[] {
  return rows.map((row) => {
    const copy: T = { ...row };
    delete copy.owner_id;
    return copy;
  });
}

export async function exportAllData() {
  const [clubs, teams, players, sessions, attendance, lineups, cotisations, expenses, evaluations] =
    await Promise.all([
      db.clubs.toArray(),
      db.teams.toArray(),
      db.players.toArray(),
      db.sessions.toArray(),
      db.attendance.toArray(),
      db.lineups.toArray(),
      db.cotisations.toArray(),
      db.expenses.toArray(),
      db.evaluations.toArray(),
    ]);

  return {
    app: "CoachOps",
    version: 2,
    exported_at: new Date().toISOString(),
    data: {
      clubs: stripOwner(clubs),
      teams: stripOwner(teams),
      players: stripOwner(players),
      sessions: stripOwner(sessions),
      attendance: stripOwner(attendance),
      lineups: stripOwner(lineups),
      cotisations: stripOwner(cotisations),
      expenses: stripOwner(expenses),
      evaluations: stripOwner(evaluations),
    },
  };
}

export async function importAllData(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("ملف غير صالح");
  }
  const d = (payload as { data: Record<string, unknown> }).data;
  if (!d || typeof d !== "object") {
    throw new Error("ملف غير صالح");
  }

  const tables = [db.clubs, db.teams, db.players, db.sessions, db.attendance, db.lineups, db.cotisations, db.expenses, db.evaluations];

  // A restore replaces the whole database, so any row the backup does not
  // mention is a deletion and has to be tombstoned. Otherwise it would come back
  // from the cloud on the next pull, leaving a mixture of the backup and the old
  // data that the coach never asked for.
  const before = new Map<TableName, Set<string>>();
  for (const table of ALL_TABLES) {
    before.set(
      table,
      new Set((await db[table].toArray()).map((r) => String(r.id))),
    );
  }

  await db.transaction("rw", tables, async () => {
    // Clubs first so a team's club_id still resolves after the restore.
    await Promise.all(tables.map((t) => t.clear()));
    await db.clubs.bulkPut(rowsOf<Club>(d.clubs));
    await db.teams.bulkPut(rowsOf<Team>(d.teams));
    await db.players.bulkPut(rowsOf<Player>(d.players));
    await db.sessions.bulkPut(rowsOf<TrainingSession>(d.sessions));
    await db.attendance.bulkPut(rowsOf<Attendance>(d.attendance));
    await db.lineups.bulkPut(rowsOf<Lineup>(d.lineups));
    await db.cotisations.bulkPut(rowsOf<Cotisation>(d.cotisations));
    await db.expenses.bulkPut(rowsOf<Expense>(d.expenses));
    await db.evaluations.bulkPut(rowsOf<Evaluation>(d.evaluations));
  });

  for (const table of ALL_TABLES) {
    const kept = new Set(
      rowsOf<{ id?: string }>(d[table]).map((r) => String(r.id)),
    );
    await stageDeleteMany(
      table,
      [...before.get(table)!].filter((id) => !kept.has(id)),
    );
  }
}

/**
 * Erases every table in the local database. Used when an account is deleted,
 * so a shared device is not left holding the previous coach's roster, payment
 * records and parents' phone numbers.
 *
 * No tombstones are staged: the account and, through the RLS cascade on
 * `owner_id`, the cloud rows are destroyed with it.
 */
export async function wipeLocalData(): Promise<void> {
  const tables = ALL_TABLES.map((name) => db[name]);
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
  await forgetAllSynced();
}

/**
 * Local half of "reset all data".
 *
 * The cloud half lives in lib/supabase/sync.ts and must run too. Clearing only
 * Dexie was the reason emptying the Supabase tables looked impossible: the very
 * next push re-uploaded everything this function had just discarded.
 */
export async function resetAllData() {
  const tables = ALL_TABLES.map((name) => db[name]);
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
  await forgetAllSynced();
}

export async function deleteTeamCascade(teamId: string) {
  const players = await db.players.where("team_id").equals(teamId).toArray();
  const playerIds = players.map((p) => p.id!).filter(Boolean);
  const sessions = await db.sessions.where("team_id").equals(teamId).toArray();
  const sessionIds = sessions.map((s) => s.id!).filter(Boolean);

  // Every id that is about to disappear is collected first, so the tombstones are
  // written in the same transaction as the delete. A cascade that removes rows
  // without leaving a trace on the server is how a deleted age group used to
  // reappear on the next pull.
  const gone = new Map<TableName, string[]>([
    ["attendance", []],
    ["cotisations", []],
    ["expenses", []],
    ["evaluations", []],
    ["lineups", []],
    ["sessions", sessionIds],
    ["players", playerIds],
  ]);

  await db.transaction(
    "rw",
    [db.teams, db.players, db.sessions, db.attendance, db.lineups, db.cotisations, db.expenses, db.evaluations],
    async () => {
      const attendanceBySession = await db.attendance
        .where("session_id")
        .anyOf(sessionIds)
        .toArray();
      const attendanceByPlayer = await db.attendance
        .where("player_id")
        .anyOf(playerIds)
        .toArray();
      const cotisationsByTeam = await db.cotisations.where("team_id").equals(teamId).toArray();
      const cotisationsByPlayer = await db.cotisations
        .where("player_id")
        .anyOf(playerIds)
        .toArray();
      const expensesByTeam = await db.expenses.where("team_id").equals(teamId).toArray();
      const evaluationsByTeam = await db.evaluations.where("team_id").equals(teamId).toArray();
      const evaluationsByPlayer = await db.evaluations
        .where("player_id")
        .anyOf(playerIds)
        .toArray();
      const lineupsByTeam = await db.lineups.where("team_id").equals(teamId).toArray();

      gone.set("attendance", [
        ...attendanceBySession.map((r) => String(r.id)),
        ...attendanceByPlayer.map((r) => String(r.id)),
      ]);
      gone.set("cotisations", [
        ...cotisationsByTeam.map((r) => String(r.id)),
        ...cotisationsByPlayer.map((r) => String(r.id)),
      ]);
      gone.set("expenses", expensesByTeam.map((r) => String(r.id)));
      gone.set("evaluations", [
        ...evaluationsByTeam.map((r) => String(r.id)),
        ...evaluationsByPlayer.map((r) => String(r.id)),
      ]);
      gone.set("lineups", lineupsByTeam.map((r) => String(r.id)));
      gone.set("teams", [teamId]);

      await db.attendance.where("session_id").anyOf(sessionIds).delete();
      await db.attendance.where("player_id").anyOf(playerIds).delete();
      await db.cotisations.where("team_id").equals(teamId).delete();
      await db.cotisations.where("player_id").anyOf(playerIds).delete();
      await db.expenses.where("team_id").equals(teamId).delete();
      await db.evaluations.where("team_id").equals(teamId).delete();
      await db.evaluations.where("player_id").anyOf(playerIds).delete();
      await db.lineups.where("team_id").equals(teamId).delete();
      await db.sessions.where("team_id").equals(teamId).delete();
      await db.players.where("team_id").equals(teamId).delete();
      await db.teams.delete(teamId);

      for (const [table, ids] of gone) {
        await stageDeleteMany(table, ids);
      }
    },
  );
}