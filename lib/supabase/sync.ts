import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, getFreshSession, SUPABASE_UNCONFIGURED_MESSAGE } from "./client";
import { db, ALL_TABLES, type TableName } from "@/lib/offline/db";
import {
  clearStagedDeletes,
  forgetAllStagedDeletes,
  forgetAllSynced,
  forgetSynced,
  recordSynced,
  stageDelete,
  stagedDeletes,
  syncedIdsFor,
} from "@/lib/offline/sync-ledger";

/**
 * Sync strategy: local-first with last-write-wins on `updated_at`, scoped to the
 * signed-in coach via `owner_id`.
 *
 * Pulling used to `clear()` every local table before writing the cloud rows,
 * which silently destroyed unsynced local edits. It now merges row by row and
 * only overwrites a local row when the cloud copy is strictly newer, so pulling
 * can never lose data.
 *
 * RLS on the server independently enforces that a coach can only ever touch
 * their own rows, so this client-side filter is a convenience rather than the
 * security boundary.
 *
 * Deletions travel both ways, via the ledger in lib/offline/sync-ledger.ts:
 *
 *   Up   A local delete stages a tombstone; the next push issues a real DELETE.
 *        Until then the row is still on the server, so the push runs before any
 *        pull to avoid a tombstoned row being resurrected by a merge.
 *
 *   Down A pull removes any local row that `synced_rows` says the server once
 *        confirmed but that the server no longer returns. Rows the server has
 *        never confirmed are local-only work and are never touched.
 *
 * Without both halves a delete looked rejected (it was restored by the next
 * pull) and clearing the cloud tables was pointless (the next push re-uploaded
 * everything).
 */

export type SyncTable = TableName;

export interface SyncReport {
  pushed: Partial<Record<SyncTable, number>>;
  pulled: Partial<Record<SyncTable, number>>;
  /** Rows this device deleted that were then removed from the server. */
  deleted: Partial<Record<SyncTable, number>>;
  /** Local rows removed because the server no longer has them. */
  pruned: Partial<Record<SyncTable, number>>;
  /** Duplicate local rows merged together. */
  merged: number;
  /** Age groups re-attached after their club vanished. */
  detached: number;
  /** Human-readable, table-prefixed problems. Empty means the sync fully succeeded. */
  errors: string[];
}

function emptyReport(): SyncReport {
  return { pushed: {}, pulled: {}, deleted: {}, pruned: {}, merged: 0, detached: 0, errors: [] };
}

interface SyncRow {
  /** Numbers for most tables; `coach_profiles.id` is the coach's auth uuid. */
  id?: number | string;
  owner_id?: string;
  updated_at?: string;
  [key: string]: unknown;
}

interface SyncTableHandle {
  toArray(): Promise<SyncRow[]>;
  bulkPut(rows: SyncRow[]): Promise<unknown>;
  bulkDelete(keys: Array<string | number>): Promise<unknown>;
}

const local = db as unknown as Record<SyncTable, SyncTableHandle>;

type SessionCheck = { ok: true; uid: string } | { ok: false; error: string };

/** Rows with no `updated_at` sort as oldest, so they never clobber a tracked row. */
function stamp(row: SyncRow): number {
  if (!row.updated_at) return 0;
  const t = Date.parse(row.updated_at);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Resolves the signed-in coach, or explains why sync is unavailable.
 *
 * Reads the session through `getFreshSession`, which refreshes an expired access
 * token first. This is what fixes the "JWT expired" wall: `getSession()` returns
 * whatever token is cached without checking it, and Supabase access tokens last
 * one hour. The library's own auto-refresh only runs while the document is
 * visible, so a coach who closed the tab or locked the phone came back to a long
 * expired token and every table request 401'd -- the app looked broken and the
 * data was fine.
 *
 * Returns null when the session really is gone (signed out, or the refresh token
 * itself rejected), which is the only case that should ask for a sign-in.
 *
 * `overrideUid` short-circuits the lookup so the merge rules can be exercised in
 * tests without a live auth session. It is never passed in production.
 */
async function currentUserId(
  supabase: SupabaseClient | null,
  overrideUid?: string,
): Promise<SessionCheck> {
  if (!supabase) return { ok: false, error: SUPABASE_UNCONFIGURED_MESSAGE };
  if (overrideUid) return { ok: true, uid: overrideUid };
  const user = (await getFreshSession())?.user;
  if (!user) {
    return {
      ok: false,
      error: "انتهت صلاحية الجلسة. سجّل الدخول من جديد للمتابعة.",
    };
  }
  return { ok: true, uid: user.id };
}

/**
 * Upserts local rows, then issues the pending deletes.
 *
 * Order matters: if a pull had restored a row the coach deleted here, the
 * tombstone has to be applied last, otherwise the upsert would put the row back
 * on the server immediately after the delete removed it.
 *
 * `client` is injectable so the reconciliation rules can be tested against an
 * in-memory stand-in rather than a live project.
 */
export async function pushToCloud(
  client?: SupabaseClient | null,
  overrideUid?: string,
): Promise<SyncReport> {
  const report = emptyReport();
  const supabase = client === undefined ? getSupabase() : client;
  if (!supabase) {
    report.errors.push(SUPABASE_UNCONFIGURED_MESSAGE);
    return report;
  }
  const session = await currentUserId(supabase, overrideUid);
  if (!session.ok) {
    report.errors.push(session.error);
    return report;
  }

  const staged = new Map<SyncTable, Set<string>>();
  for (const { table_name, row_id } of await stagedDeletes()) {
    if (!staged.has(table_name)) staged.set(table_name, new Set());
    staged.get(table_name)!.add(row_id);
  }

  for (const table of ALL_TABLES) {
    const dead = staged.get(table) ?? new Set<string>();
    let rows: SyncRow[];
    try {
      rows = await local[table].toArray();
    } catch (e) {
      report.errors.push(`${table}: فشل قراءة البيانات المحلية (${describe(e)})`);
      continue;
    }
    // On a device shared between accounts, skip rows owned by someone else.
    // Sending them would violate RLS and fail the whole table, taking this
    // coach's own rows down with it. `coach_profiles` has no owner_id column --
    // its id *is* the coach's auth id -- so it is filtered by comparing that.
    rows =
      table === "coach_profiles"
        ? rows.filter((r) => String(r.id) === session.uid)
        : rows.filter((r) => r.owner_id == null || r.owner_id === session.uid);

    // A tombstoned id that somehow exists locally again (a merge won the race)
    // must not be pushed, or the delete would be undone.
    rows = rows.filter((r) => !dead.has(String(r.id)));

    if (rows.length > 0) {
      const now = new Date().toISOString();
      // Stamp `owner_id` so RLS accepts the write, and `updated_at` so the next
      // pull can compare timestamps. `coach_profiles` is exempt: its primary key
      // *is* the coach's auth id and the table has no owner_id column, so adding
      // one would make every write fail.
      const payload =
        table === "coach_profiles"
          ? rows.map((r) => ({ ...r, updated_at: r.updated_at ?? now }))
          : rows.map((r) => ({
              ...r,
              owner_id: r.owner_id ?? session.uid,
              updated_at: r.updated_at ?? now,
            }));

      const { error } = await supabase.from(table).upsert(payload);
      if (error) {
        report.errors.push(`${table}: ${error.message}`);
        // Leave the tombstones alone so the next push retries the delete.
        continue;
      }

      // Persist the stamp locally so the next pull can compare timestamps.
      await local[table].bulkPut(payload);
      // Only now is the server known to hold these rows, so only now may a pull
      // treat their absence as a deletion.
      await recordSynced(
        table,
        payload.map((r) => r.id),
        session.uid,
      );
      report.pushed[table] = payload.length;
    }

    // Deletes run even when the upsert above found nothing to send, otherwise a
    // table whose last local row was just deleted would never be cleaned up.
    if (dead.size > 0) {
      const ids = [...dead];
      const { error } = await supabase.from(table).delete().in("id", ids);
      if (error) {
        report.errors.push(`${table}: ${error.message}`);
        continue;
      }
      await clearStagedDeletes(ids.map((row_id) => ({ table_name: table, row_id })));
      // The row is gone from both sides, so it must not stay in the ledger: left
      // there, the next pull would treat it as a deletion made elsewhere and go
      // looking for it again.
      await forgetSynced(table, ids);
      report.deleted[table] = ids.length;
    }
  }

  return report;
}

export async function pullFromCloud(
  client?: SupabaseClient | null,
  overrideUid?: string,
): Promise<SyncReport> {
  const report = emptyReport();
  const supabase = client === undefined ? getSupabase() : client;
  if (!supabase) {
    report.errors.push(SUPABASE_UNCONFIGURED_MESSAGE);
    return report;
  }
  const session = await currentUserId(supabase, overrideUid);
  if (!session.ok) {
    report.errors.push(session.error);
    return report;
  }

  for (const table of ALL_TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      report.errors.push(`${table}: ${error.message}`);
      continue;
    }

    // An empty result is a legitimate answer here: it is how a deletion shows
    // up. The old `if (!data || data.length === 0) continue` skipped it, which
    // is precisely why a deleted row always came back.
    const remote = (data ?? []) as SyncRow[];
    const localRows = await local[table].toArray();
    const localById = new Map<string, SyncRow>();
    for (const row of localRows) {
      if (row.id != null) localById.set(String(row.id), row);
    }

    const toApply: SyncRow[] = [];
    for (const row of remote) {
      if (row.id == null) continue;
      // RLS already hides other coaches' rows; this guards against a stale or
      // mis-scoped response landing in this device's local database.
      if (row.owner_id != null && row.owner_id !== session.uid) continue;
      const mine = localById.get(String(row.id));
      if (!mine || stamp(row) > stamp(mine)) toApply.push(row);
    }

    if (toApply.length > 0) {
      await local[table].bulkPut(toApply);
      report.pulled[table] = toApply.length;
    }

    // Downward deletions. `syncedRows` holds ids this coach's server has
    // confirmed before. Anything in there that the server no longer returns was
    // deleted here or on another device, so it goes. A local row absent from
    // `syncedRows` is unpushed work and is deliberately left alone.
    const syncedRows = await syncedIdsFor(table, session.uid);
    const remoteIds = new Set(remote.map((r) => String(r.id)));
    const gone = [...syncedRows].filter((id) => !remoteIds.has(id));

    if (gone.length > 0) {
      const doomed = localRows.filter(
        (r) => r.id != null && gone.includes(String(r.id)),
      );
      if (doomed.length > 0) {
        await local[table].bulkDelete(doomed.map((r) => r.id as string | number));
        report.pruned[table] = doomed.length;
      }
      await forgetSynced(table, gone);
      // Nothing local references these any more, so they are no longer pending.
      await clearStagedDeletes(gone.map((row_id) => ({ table_name: table, row_id })));
    }

    await recordSynced(
      table,
      remote.map((r) => r.id),
      session.uid,
    );
  }

  report.merged = await mergeDuplicateClubs(session.uid);
  report.detached = await repairDanglingClubLinks(session.uid);

  return report;
}

/**
 * Detaches age groups whose club no longer exists.
 *
 * Dexie has no foreign keys, so deleting a club -- here or on another device --
 * leaves every group under it pointing at an id that resolves to nothing. Those
 * groups then show up in no list at all, which is how a deleted club could take
 * its whole squad out of sight. `teams.club_id` is nullable and `loadHierarchy`
 * folds orphans under a default club, so nulling the column puts them back.
 *
 * Runs after the merge so a club that lost a duplicate is handled the same way.
 */
async function repairDanglingClubLinks(ownerId: string): Promise<number> {
  const clubIds = new Set(
    (await db.clubs.toArray())
      .filter((c) => c.owner_id == null || c.owner_id === ownerId)
      .map((c) => String(c.id)),
  );

  const orphans = (await db.teams.toArray()).filter(
    (t) =>
      (t.owner_id == null || t.owner_id === ownerId) &&
      t.club_id != null &&
      !clubIds.has(String(t.club_id)),
  );
  if (orphans.length === 0) return 0;

  const now = new Date().toISOString();
  await db.teams.bulkPut(
    orphans.map((t) => ({ ...t, club_id: null, updated_at: now })),
  );
  // The rewritten teams need to reach the server, and they no longer have to
  // point at a club the server is about to be told about.
  await recordSynced(
    "teams",
    orphans.map((t) => t.id),
    ownerId,
  );

  return orphans.length;
}

/**
 * Normalised identity of a club, used to spot duplicates.
 *
 * Case and surrounding whitespace are ignored because two devices mint their own
 * uuid for what the coach typed as the same club, and " Raja " versus "Raja"
 * should not read as two different academies. The separator keeps a name that
 * ends where the other begins from colliding.
 */
function clubKey(row: { name?: unknown; city?: unknown }): string {
  const name = String(row.name ?? "").trim().toLowerCase();
  const city = String(row.city ?? "").trim().toLowerCase();
  return `${name}\u0000${city}`;
}

/**
 * Collapses clubs that are the same club under two ids.
 *
 * This is the "adding a club replicates it" symptom. Ids are generated on the
 * device, so a club created on the phone and again on the laptop -- or before and
 * after a browser reset -- is two unrelated rows with the same name. Both sync
 * happily and nothing ever reconciled them.
 *
 * The oldest row wins and every age group is re-pointed at it, so no squad is
 * lost. The losing row is tombstoned, which also removes it from the server on
 * the next push. Runs inside one transaction so a failure cannot leave groups
 * pointing at a club that was just deleted.
 */
export async function mergeDuplicateClubs(ownerId: string): Promise<number> {
  const clubs = (await db.clubs.toArray()).filter(
    (c) => c.owner_id == null || c.owner_id === ownerId,
  );

  type Candidate = (typeof clubs)[number];
  const buckets = new Map<string, Candidate[]>();
  for (const club of clubs) {
    if (club.id == null) continue;
    const key = clubKey(club);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(club);
    else buckets.set(key, [club]);
  }

  const losers: string[] = [];
  const remap: Array<{ from: string; to: string }> = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    // Oldest first, then by id so the winner is stable across devices.
    const ordered = [...bucket].sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      String(a.id).localeCompare(String(b.id)),
    );
    const winner = ordered[0];
    for (const loser of ordered.slice(1)) {
      losers.push(String(loser.id));
      remap.push({ from: String(loser.id), to: String(winner.id) });
    }
  }

  if (losers.length === 0) return 0;

  const now = new Date().toISOString();
  await db.transaction("rw", [db.clubs, db.teams], async () => {
    for (const { from, to } of remap) {
      await db.teams
        .where("club_id")
        .equals(from)
        .modify({ club_id: to, updated_at: now });
    }
    await db.clubs.bulkDelete(losers);
  });

  for (const id of losers) {
    await stageDelete("clubs", id);
  }

  return losers.length;
}

/**
 * Deletes every row this coach owns, on the server, and forgets the ledger.
 *
 * This is the cloud half of "reset all data". Clearing Dexie alone could never
 * work: the next push re-uploaded the entire local database, so emptying the
 * tables in the Supabase dashboard was undone within seconds.
 */
export async function resetCloud(
  client?: SupabaseClient | null,
  overrideUid?: string,
): Promise<SyncReport> {
  const report = emptyReport();
  const supabase = client === undefined ? getSupabase() : client;
  if (!supabase) {
    report.errors.push(SUPABASE_UNCONFIGURED_MESSAGE);
    return report;
  }
  const session = await currentUserId(supabase, overrideUid);
  if (!session.ok) {
    report.errors.push(session.error);
    return report;
  }

  for (const table of ALL_TABLES) {
    const column = table === "coach_profiles" ? "id" : "owner_id";
    const value = table === "coach_profiles" ? session.uid : session.uid;
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .eq(column, value);
    if (error) {
      report.errors.push(`${table}: ${error.message}`);
      continue;
    }
    if (count != null && count > 0) report.deleted[table] = count;
  }

  await forgetAllStagedDeletes();
  await forgetAllSynced();

  return report;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Renders a report as a single Arabic line for the settings banner.
 *
 * Deletions are reported separately from upserts: a coach who deletes a club
 * needs to see that it was removed, otherwise the row silently disappearing is
 * indistinguishable from a bug.
 */
export function summarize(report: SyncReport): string {
  if (report.errors.length > 0) {
    return `تمت المزامنة مع أخطاء: ${report.errors.join(" | ")}`;
  }
  const pushed = sum(report.pushed);
  const pulled = sum(report.pulled);
  const deleted = sum(report.deleted);
  const pruned = sum(report.pruned);

  const parts: string[] = [];
  if (pushed > 0) parts.push(`${pushed} سجل مرفوع`);
  if (pulled > 0) parts.push(`${pulled} سجل محدّث محلياً`);
  if (deleted > 0) parts.push(`${deleted} سجل محذوف من السحابة`);
  if (pruned > 0) parts.push(`${pruned} سجل محذوف من هذا الجهاز`);
  if (report.merged > 0) parts.push(`${report.merged} نادي مكرر تم دمجه`);
  if (report.detached > 0) parts.push(`${report.detached} فئة أُعيد ربطها`);

  if (parts.length === 0) return "لا توجد تغييرات للمزامنة.";
  return `تمت المزامنة: ${parts.join(" · ")} ☁️`;
}

function sum(counts: Partial<Record<SyncTable, number>>): number {
  return Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
}