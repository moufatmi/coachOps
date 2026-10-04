import Dexie from "dexie";
import { db, newId, ALL_TABLES, LEGACY_DB_NAME, type Lineup } from "./db";

/**
 * One-time migration from the pre-v7 database.
 *
 * v7 moved from auto-increment integer primary keys to client-generated UUIDs.
 * Two problems had to be solved:
 *
 *  1. Dexie refuses to change a primary key on an existing store, so the app now
 *     opens a *new* database (`CoachOpsDB_v7`) and this copies the rows across.
 *  2. Integer ids and their references have to be rewritten, otherwise every
 *     foreign key breaks. That includes the player ids nested inside lineup
 *     `slots`, `substitutes` and `scorers`.
 *
 * Safe to run repeatedly: it does nothing once the legacy database is gone or
 * the new one already has rows.
 */

const FLAG = "coachops:uuid-migrated";

function needsMigration(v: unknown): boolean {
  return typeof v === "number";
}

/** FK columns per table. Lineup jsonb paths are handled separately. */
const FK_COLUMNS: Record<string, string[]> = {
  teams: ["club_id"],
  players: ["team_id"],
  sessions: ["team_id"],
  attendance: ["session_id", "player_id"],
  lineups: ["team_id", "captain_id", "mvp_id"],
  cotisations: ["team_id", "player_id"],
  expenses: ["team_id"],
  evaluations: ["player_id", "team_id"],
};

/** Which table a foreign key column points at. */
function fkTarget(col: string): string {
  if (col === "club_id") return "clubs";
  if (col === "team_id") return "teams";
  if (col === "player_id" || col === "captain_id" || col === "mvp_id") return "players";
  if (col === "session_id") return "sessions";
  return "teams";
}

export interface MigrationResult {
  migrated: boolean;
  rowsCopied: number;
  brokenRefs: number;
}

/**
 * Copies any pre-v7 data into the new UUID-keyed database.
 *
 * Called before the app renders. Blocks on the migration so no page can read a
 * half-copied database.
 */
export async function migrateFromLegacyDb(): Promise<MigrationResult> {
  const none: MigrationResult = { migrated: false, rowsCopied: 0, brokenRefs: 0 };

  if (typeof window !== "undefined" && window.localStorage.getItem(FLAG) === "done") {
    return none;
  }

  let legacy: Dexie | null = null;
  try {
    // Opening is lazy: Dexie only touches IndexedDB on first query.
    legacy = new Dexie(LEGACY_DB_NAME);
    legacy.open();
  } catch {
    return none;
  }

  // Read the old rows. Any failure here means there is nothing to migrate.
  const data: Record<string, Array<Record<string, unknown>>> = {};
  let hasRows = false;
  try {
    for (const table of ALL_TABLES) {
      if (!legacy.tables.some((t) => t.name === table)) continue;
      const rows = (await legacy.table(table).toArray()) as unknown as Array<
        Record<string, unknown>
      >;
      data[table] = rows;
      if (rows.length > 0) hasRows = true;
    }
  } catch {
    return none;
  } finally {
    try {
      legacy.close();
    } catch {
      /* already closed */
    }
  }

  if (!hasRows) {
    markDone();
    return none;
  }

  // Build old id -> new uuid maps per table before rewriting anything.
  const map: Record<string, Map<string, string>> = {};
  for (const table of ALL_TABLES) {
    const m = new Map<string, string>();
    for (const row of data[table] ?? []) {
      if (needsMigration(row.id)) m.set(String(row.id), newId());
    }
    map[table] = m;
  }

  const remap = (table: string, value: unknown): unknown => {
    if (!needsMigration(value)) return value;
    return map[table]?.get(String(value)) ?? null;
  };

  let copied = 0;
  let brokenRefs = 0;
  const tables = ALL_TABLES.map((n) => db[n]);

  await db.transaction("rw", tables, async () => {
    for (const table of ALL_TABLES) {
      const rows = data[table] ?? [];
      if (rows.length === 0) continue;

      const updated = rows.map((row) => {
        const next: Record<string, unknown> = {
          ...row,
          id: needsMigration(row.id) ? map[table].get(String(row.id)) : row.id,
        };

        for (const col of FK_COLUMNS[table] ?? []) {
          if (!(col in next)) continue;
          const remapped = remap(fkTarget(col), next[col]);
          if (remapped === null && next[col] != null) brokenRefs++;
          next[col] = remapped;
        }

        if (table === "lineups") {
          next.slots = ((next.slots as Lineup["slots"]) ?? []).map((s) =>
            needsMigration(s.player_id)
              ? { ...s, player_id: (map.players.get(String(s.player_id)) ?? null) as string | null }
              : s,
          );
          next.substitutes = ((next.substitutes as unknown[]) ?? []).map(
            (id) => (needsMigration(id) ? map.players.get(String(id)) ?? null : id),
          );
          next.scorers = ((next.scorers as Lineup["scorers"]) ?? []).map((s) => ({
            ...s,
            player_id: needsMigration(s.player_id)
              ? map.players.get(String(s.player_id)) ?? s.player_id
              : s.player_id,
          }));
        }

        copied++;
        return next;
      });

      const handle = db[table] as unknown as {
        bulkPut(rows: unknown[]): Promise<unknown>;
      };
      await handle.bulkPut(updated);
    }
  });

  markDone();
  console.info(`CoachOps: copied ${copied} row(s) from the previous database.`);
  return { migrated: true, rowsCopied: copied, brokenRefs };
}

function markDone() {
  if (typeof window !== "undefined") window.localStorage.setItem(FLAG, "done");
}

/** Removes the pre-v7 database once its data has been copied across. */
export async function deleteLegacyDb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    // Another tab may still hold it open; either way, resolve rather than hang.
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}