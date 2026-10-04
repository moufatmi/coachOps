import { db, newId, ALL_TABLES, type Lineup } from "./db";

/**
 * One-time migration from integer primary keys to UUIDs.
 *
 * Dexie's version-7 schema drops the `++` auto-increment, but rows written under
 * earlier versions still hold integer keys. Simply letting the app read them
 * would break every foreign key, so this rewrites ids *and* every reference to
 * them, including the player ids nested inside lineup `slots`, `substitutes`
 * and `scorers`.
 *
 * Safe to run repeatedly: it only touches rows whose id is still numeric.
 */

const FLAG = "coachops:uuid-migrated";

function needsMigration(v: unknown): boolean {
  return typeof v === "number";
}

/** FK columns per table, plus nested paths handled separately. */
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

export interface MigrationResult {
  migrated: boolean;
  rowsRewritten: number;
  brokenRefs: number;
}

export async function migrateIdsToUuids(): Promise<MigrationResult> {
  if (typeof window !== "undefined" && window.localStorage.getItem(FLAG) === "done") {
    return { migrated: false, rowsRewritten: 0, brokenRefs: 0 };
  }

  // Read everything first so remapping is not order-dependent.
  const data: Record<string, Array<Record<string, unknown>>> = {};
  let pending = 0;
  for (const table of ALL_TABLES) {
    const rows = (await db[table].toArray()) as unknown as Array<Record<string, unknown>>;
    data[table] = rows;
    if (rows.some((r) => needsMigration(r.id))) pending += rows.length;
  }

  if (pending === 0) {
    if (typeof window !== "undefined") window.localStorage.setItem(FLAG, "done");
    return { migrated: false, rowsRewritten: 0, brokenRefs: 0 };
  }

  // old id (as string) -> new uuid, built per table before rewriting.
  const map: Record<string, Map<string, string>> = {};
  for (const table of ALL_TABLES) {
    const m = new Map<string, string>();
    for (const row of data[table]) {
      if (needsMigration(row.id)) m.set(String(row.id), newId());
    }
    map[table] = m;
  }

  const remap = (table: string, value: unknown): unknown => {
    if (!needsMigration(value)) return value;
    return map[table].get(String(value)) ?? null;
  };

  let rewritten = 0;
  let brokenRefs = 0;

  const tables = ALL_TABLES.map((n) => db[n]);

  await db.transaction("rw", tables, async () => {
    for (const table of ALL_TABLES) {
      const rows = data[table];
      if (rows.length === 0) continue;

      const updated = rows.map((row) => {
        if (!needsMigration(row.id)) return row;
        const next: Record<string, unknown> = { ...row, id: map[table].get(String(row.id)) };

        for (const col of FK_COLUMNS[table] ?? []) {
          if (!(col in next)) continue;
          const remapped = remap(fkTarget(col), next[col]);
          // A null here would silently orphan the row; count it for the report.
          if (remapped === null && next[col] != null) brokenRefs++;
          next[col] = remapped;
        }

        // Player ids nested inside lineup documents.
        if (table === "lineups") {
          next.slots = mapPlayerIds((next.slots as Lineup["slots"]) ?? [], map);
          next.substitutes = ((next.substitutes as unknown[]) ?? []).map((id) =>
            needsMigration(id) ? (map.players.get(String(id)) ?? null) : id,
          );
          const scorers = (next.scorers as Lineup["scorers"]) ?? [];
          next.scorers = scorers.map((s) => ({
            ...s,
            player_id: needsMigration(s.player_id)
              ? (map.players.get(String(s.player_id)) ?? s.player_id)
              : s.player_id,
          }));
        }

        rewritten++;
        return next;
      });

      // Clear then re-add: the primary key changed, so put() cannot update in place.
      await db[table].clear();
      await (db[table] as unknown as { bulkPut(rows: unknown[]): Promise<unknown> }).bulkPut(updated);
    }
  });

  if (typeof window !== "undefined") window.localStorage.setItem(FLAG, "done");
  console.info(
    `CoachOps: migrated ${rewritten} row(s) to UUID ids` +
      (brokenRefs > 0 ? ` (${brokenRefs} reference(s) had no match)` : ""),
  );
  return { migrated: true, rowsRewritten: rewritten, brokenRefs };
}

function mapPlayerIds(
  slots: Lineup["slots"],
  map: Record<string, Map<string, string>>,
): Lineup["slots"] {
  return slots.map((s) =>
    needsMigration(s.player_id)
      ? { ...s, player_id: (map.players.get(String(s.player_id)) ?? null) as string | null }
      : s,
  );
}

/** Which table a foreign key column points at. */
function fkTarget(col: string): string {
  if (col === "club_id") return "clubs";
  if (col === "team_id") return "teams";
  if (col === "player_id" || col === "captain_id" || col === "mvp_id") return "players";
  if (col === "session_id") return "sessions";
  return "teams";
}