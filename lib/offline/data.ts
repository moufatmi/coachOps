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
  type Team,
  type TrainingSession,
} from "./db";

/**
 * Narrows an untrusted JSON value to an array of `T`. Backup files are user
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
}

export interface EmptySessionScan {
  /** Sessions that carry no real detail: no time, no location, no notes. */
  empty: TrainingSession[];
  /** Attendance rows that would be destroyed alongside them. */
  attendanceRows: number;
}

/**
 * Finds sessions that look auto-generated rather than planned: the attendance
 * page used to insert a bare session for "today" every time it was opened, so
 * some coaches have blank rows with no time, location or notes.
 *
 * Read-only: nothing is deleted, because a genuinely-planned session can also
 * have those fields empty. `hasAttendance` is reported so a real session with
 * recorded attendance is easy to exclude before cleaning up.
 */
export async function findProbablyEmptySessions(teamId?: string): Promise<EmptySessionScan> {
  const all = await db.sessions.toArray();
  const scoped = teamId == null ? all : all.filter((s) => s.team_id === teamId);

  const empty = scoped.filter(
    (s) =>
      s.type === "تدريب" &&
      !s.time?.trim() &&
      !s.location?.trim() &&
      !s.notes?.trim(),
  );

  let attendanceRows = 0;
  for (const s of empty) {
    if (s.id == null) continue;
    attendanceRows += await db.attendance.where("session_id").equals(s.id).count();
  }

  return { empty, attendanceRows };
}

/**
 * Deletes the sessions found by `findProbablyEmptySessions`, together with
 * their attendance rows. Attendance is removed too: orphaning it would keep
 * attendance percentages (which count every row) permanently skewed.
 */
export async function deleteSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await db.transaction("rw", [db.sessions, db.attendance], async () => {
    await db.attendance.where("session_id").anyOf(sessionIds).delete();
    await db.sessions.bulkDelete(sessionIds);
  });
}

/**
 * Erases every table in the local database. Used when an account is deleted,
 * so a shared device is not left holding the previous coach's roster, payment
 * records and parents' phone numbers.
 */
export async function wipeLocalData(): Promise<void> {
  const tables = ALL_TABLES.map((name) => db[name]);
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}

/** Number of rows per table, for the "storage used" panel in Settings. */
export async function localDataStats(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of ALL_TABLES) {
    out[name] = await db[name].count();
  }
  return out;
}

export async function resetAllData() {
  const tables = ALL_TABLES.map((name) => db[name]);
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}

export async function deleteTeamCascade(teamId: string) {
  const players = await db.players.where("team_id").equals(teamId).toArray();
  const playerIds = players.map((p) => p.id!).filter(Boolean);
  const sessions = await db.sessions.where("team_id").equals(teamId).toArray();
  const sessionIds = sessions.map((s) => s.id!).filter(Boolean);
  await db.transaction("rw", [db.teams, db.players, db.sessions, db.attendance, db.lineups, db.cotisations, db.expenses, db.evaluations], async () => {
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
  });
}