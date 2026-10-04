import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, getFreshSession, SUPABASE_UNCONFIGURED_MESSAGE } from "./client";
import { db, ALL_TABLES, type TableName } from "@/lib/offline/db";

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
 * Known limitation: deletions are not propagated between devices (there are no
 * tombstones). Deleting a player on one device leaves it in the cloud and it
 * will come back on the next pull from another device.
 */

export type SyncTable = TableName;

export interface SyncReport {
  pushed: Partial<Record<SyncTable, number>>;
  pulled: Partial<Record<SyncTable, number>>;
  /** Human-readable, table-prefixed problems. Empty means the sync fully succeeded. */
  errors: string[];
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
 */
async function currentUserId(supabase: SupabaseClient | null): Promise<SessionCheck> {
  if (!supabase) return { ok: false, error: SUPABASE_UNCONFIGURED_MESSAGE };
  const user = (await getFreshSession())?.user;
  if (!user) {
    return {
      ok: false,
      error: "انتهت صلاحية الجلسة. سجّل الدخول من جديد للمتابعة.",
    };
  }
  return { ok: true, uid: user.id };
}

export async function pushToCloud(): Promise<SyncReport> {
  const report: SyncReport = { pushed: {}, pulled: {}, errors: [] };
  const supabase = getSupabase();
  if (!supabase) {
    report.errors.push(SUPABASE_UNCONFIGURED_MESSAGE);
    return report;
  }
  const session = await currentUserId(supabase);
  if (!session.ok) {
    report.errors.push(session.error);
    return report;
  }

  for (const table of ALL_TABLES) {
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

    if (rows.length === 0) continue;

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
      continue;
    }

    // Persist the stamp locally so the next pull can compare timestamps.
    await local[table].bulkPut(payload);
    report.pushed[table] = payload.length;
  }

  return report;
}

export async function pullFromCloud(): Promise<SyncReport> {
  const report: SyncReport = { pushed: {}, pulled: {}, errors: [] };
  const supabase = getSupabase();
  if (!supabase) {
    report.errors.push(SUPABASE_UNCONFIGURED_MESSAGE);
    return report;
  }
  const session = await currentUserId(supabase);
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
    if (!data || data.length === 0) continue;

    const remote = data as SyncRow[];
    const localRows = await local[table].toArray();
    const localById = new Map<string | number, SyncRow>();
    for (const row of localRows) {
      if (row.id != null) localById.set(row.id, row);
    }

    const toApply: SyncRow[] = [];
    for (const row of remote) {
      if (row.id == null) continue;
      // RLS already hides other coaches' rows; this guards against a stale or
      // mis-scoped response landing in this device's local database.
      if (row.owner_id != null && row.owner_id !== session.uid) continue;
      const mine = localById.get(row.id);
      if (!mine || stamp(row) > stamp(mine)) toApply.push(row);
    }

    if (toApply.length > 0) {
      await local[table].bulkPut(toApply);
      report.pulled[table] = toApply.length;
    }
  }

  return report;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Renders a report as a single Arabic line for the settings banner. */
export function summarize(report: SyncReport): string {
  if (report.errors.length > 0) {
    return `تمت المزامنة مع أخطاء: ${report.errors.join(" | ")}`;
  }
  const pushed = Object.values(report.pushed).reduce((s, n) => s + (n ?? 0), 0);
  const pulled = Object.values(report.pulled).reduce((s, n) => s + (n ?? 0), 0);
  if (pushed === 0 && pulled === 0) return "لا توجد تغييرات للمزامنة.";
  return `تمت المزامنة: ${pushed} سجل مرفوع · ${pulled} سجل محدّث محلياً ☁️`;
}