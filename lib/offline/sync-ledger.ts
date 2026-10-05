import { db, type TableName } from "./db";

/**
 * Delete bookkeeping for the sync engine.
 *
 * The app is local-first, so a delete is a purely local event and used to never
 * reach the server. That produced the two most confusing bugs in the app:
 *
 *   1. Deleting a club looked rejected. The row left Dexie but survived in
 *      Supabase, so the next pull -- which fires on window focus, on tab
 *      visibility, on sign-in and every two minutes -- restored it.
 *   2. Emptying the tables in the Supabase dashboard changed nothing. The next
 *      push re-uploaded the entire local database, because Dexie, not Supabase,
 *      is the source of truth.
 *
 * Every destructive local operation now records a tombstone here, and
 * `lib/supabase/sync.ts` turns those tombstones into real DELETE statements. The
 * mirror-image problem -- a row deleted on another device coming back -- is
 * handled by `synced_rows`, which records the ids the server has confirmed.
 */

/** Queues one row for deletion on the server. A no-op without an id. */
export async function stageDelete(table: TableName, rowId?: string | null): Promise<void> {
  if (rowId == null || rowId === "") return;
  const key = [table, String(rowId)];
  // Re-deleting the same row must not pile up tombstones, and this has to be a
  // no-op-safe upsert rather than a plain put on an auto-increment key.
  const existing = await db.pending_deletes.where("[table_name+row_id]").equals(key).first();
  if (existing) return;
  await db.pending_deletes.add({
    table_name: table,
    row_id: String(rowId),
    deleted_at: new Date().toISOString(),
  });
}

/**
 * Queues many rows at once, for cascade deletes. Written inside the caller's
 * Dexie transaction so a tombstone can never outlive a half-applied cascade.
 */
export async function stageDeleteMany(
  table: TableName,
  rowIds: ReadonlyArray<string | number | null | undefined>,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = rowIds
    .filter((id): id is string | number => id != null && id !== "")
    .map((id) => ({ table_name: table, row_id: String(id), deleted_at: now }));
  if (rows.length === 0) return;
  await db.pending_deletes.bulkAdd(rows);
}

/** Every outstanding tombstone, oldest first. */
export async function stagedDeletes(): Promise<Array<{ table_name: TableName; row_id: string }>> {
  const rows = await db.pending_deletes.orderBy("deleted_at").toArray();
  return rows.map((r) => ({ table_name: r.table_name, row_id: r.row_id }));
}

/** Drops tombstones that the server has now honoured. */
export async function clearStagedDeletes(
  rows: ReadonlyArray<{ table_name: TableName; row_id: string }>,
): Promise<void> {
  if (rows.length === 0) return;
  const keys = rows.map((r) => [r.table_name, r.row_id]);
  const doomed = await db.pending_deletes
    .where("[table_name+row_id]")
    .anyOf(keys)
    .primaryKeys();
  if (doomed.length > 0) await db.pending_deletes.bulkDelete(doomed);
}

/** Forgets every tombstone, for the paths that wipe the cloud outright. */
export async function forgetAllStagedDeletes(): Promise<void> {
  await db.pending_deletes.clear();
}

/**
 * Records that the server now holds these rows. Only called after an upsert
 * that actually succeeded, so a failed push never makes a row look synced.
 */
export async function recordSynced(
  table: TableName,
  rowIds: ReadonlyArray<string | number | null | undefined>,
  ownerId: string | null,
): Promise<void> {
  const rows = rowIds
    .filter((id): id is string | number => id != null && id !== "")
    .map((id) => ({ table_name: table, row_id: String(id), owner_id: ownerId }));
  if (rows.length === 0) return;
  // bulkPut cannot target the compound index, so existing entries are cleared
  // first. Recording the same id twice is harmless anyway: the ledger is only
  // ever read as a set.
  const keys = rows.map((r) => [r.table_name, r.row_id]);
  const stale = await db.synced_rows
    .where("[table_name+row_id]")
    .anyOf(keys)
    .primaryKeys();
  if (stale.length > 0) await db.synced_rows.bulkDelete(stale);
  await db.synced_rows.bulkAdd(rows);
}

/**
 * Ids the server has confirmed for `table` under this coach. Pull compares these
 * against the server response to find rows that were deleted elsewhere.
 */
export async function syncedIdsFor(table: TableName, ownerId: string): Promise<Set<string>> {
  const rows = await db.synced_rows.where("table_name").equals(table).toArray();
  return new Set(rows.filter((r) => r.owner_id === ownerId).map((r) => r.row_id));
}

/** Stops tracking ids that no longer exist on the server. */
export async function forgetSynced(
  table: TableName,
  rowIds: ReadonlyArray<string>,
): Promise<void> {
  if (rowIds.length === 0) return;
  const keys = rowIds.map((id) => [table, id]);
  const doomed = await db.synced_rows
    .where("[table_name+row_id]")
    .anyOf(keys)
    .primaryKeys();
  if (doomed.length > 0) await db.synced_rows.bulkDelete(doomed);
}

/**
 * Clears the ledger for a table. Used by "reset all data": after that the local
 * database is empty and the server rows are being deleted, so nothing should be
 * treated as synced any more.
 */
export async function forgetAllSynced(): Promise<void> {
  await db.synced_rows.clear();
}