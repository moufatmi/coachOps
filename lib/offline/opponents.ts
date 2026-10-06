import { db, newId, type OpponentCrest } from "./db";
import { stageDelete } from "./sync-ledger";

/**
 * Opponent crests, stored once per club.
 *
 * The opponent on a lineup is free text the coach types, so the crest is keyed by
 * that text rather than by lineup id. Consequences worth knowing:
 *
 *  - The same rival is uploaded once, not once per fixture.
 *  - Fixtures already saved gain a crest as soon as one is added, because the
 *    lookup happens at render time from the name that is already on the row.
 *  - Spelling matters. "الرجاء" and "رجاء" are different keys. The picker shows
 *    "no crest yet" rather than silently showing the wrong one, and saving under
 *    a slightly different name creates a second entry rather than overwriting.
 */

/**
 * Lookup form of an opponent name.
 *
 * Case and surrounding whitespace are collapsed so a coach who types the same
 * name slightly differently between fixtures still hits the same crest. Arabic
 * has no case, so this mostly protects the Latin names clubs often carry
 * ("Raja", "Wydad") and trailing spaces.
 *
 * Internal whitespace is collapsed to a single space rather than removed, so
 * "Raja Casablanca" and "RajaCasablanca" stay distinct.
 */
export function opponentKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The crest for an opponent name, or undefined if none has been added. */
export async function findCrest(name: string): Promise<OpponentCrest | undefined> {
  const key = opponentKey(name);
  if (!key) return undefined;
  return db.opponent_crests.where("key").equals(key).first();
}

/**
 * Stores a crest for an opponent name, replacing any existing one.
 *
 * Replaces by key rather than adding, so re-picking a new logo for a club the
 * coach has already added does not accumulate duplicates.
 */
export async function saveCrest(name: string, crestUrl: string): Promise<string> {
  const typed = name.trim();
  const key = opponentKey(typed);
  if (!key || !crestUrl) throw new Error("اسم الخصم أو الصورة مفقود");

  const existing = await db.opponent_crests.where("key").equals(key).first();
  const row: OpponentCrest = {
    // Reuse the existing id so this is an update rather than a new row, which
    // keeps the sync ledger entry valid across devices.
    id: existing?.id ?? newId(),
    name: typed,
    key,
    crest_url: crestUrl,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.opponent_crests.put(row);
  return row.id!;
}

/** Removes a club's crest. Fixtures that referenced it fall back to text. */
export async function deleteCrest(id: string): Promise<void> {
  await db.opponent_crests.delete(id);
  await stageDelete("opponent_crests", id);
}

/**
 * Crests for a set of opponent names, in one read.
 *
 * Used by the saved-lineups list, which would otherwise fire one query per row.
 * Names with no crest are simply absent from the map.
 */
export async function crestsFor(names: readonly string[]): Promise<Map<string, OpponentCrest>> {
  const keys = [...new Set(names.map(opponentKey).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const rows = await db.opponent_crests.where("key").anyOf(keys).toArray();
  return new Map(rows.map((r) => [r.key, r]));
}