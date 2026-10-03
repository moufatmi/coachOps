import { db, ALL_TABLES, type TableName, type Owned } from "./db";

/**
 * Row ownership.
 *
 * Rows created before auth existed carry no `owner_id`. Those rows are still in
 * the coach's browser, so signing in adopts them instead of starting from an
 * empty app. Rows that already have an owner are never reassigned.
 */

interface TableHandle {
  toArray(): Promise<Array<Record<string, unknown>>>;
  bulkPut(rows: Array<Record<string, unknown>>): Promise<unknown>;
}

function handle(name: TableName): TableHandle {
  return db[name] as unknown as TableHandle;
}

/**
 * `coach_profiles` is keyed by the auth user id and has no `owner_id`, so it is
 * excluded from ownership sweeps — otherwise every profile would look "orphaned".
 */
const SWEPT_TABLES = ALL_TABLES.filter((t) => t !== "coach_profiles");

/** Adopts every pre-auth row for `ownerId`. Safe to call on every sign-in. */
export async function claimUnownedRows(ownerId: string): Promise<number> {
  let claimed = 0;

  for (const table of SWEPT_TABLES) {
    const orphans = (await handle(table).toArray()).filter((r) => r.owner_id == null);
    if (orphans.length === 0) continue;
    await handle(table).bulkPut(orphans.map((r) => ({ ...r, owner_id: ownerId })));
    claimed += orphans.length;
  }

  if (claimed > 0) {
    console.info(`CoachOps: adopted ${claimed} pre-auth row(s) for this account.`);
  }
  return claimed;
}

/**
 * Predicate for rows visible to `ownerId`.
 *
 * Rows with no owner are treated as visible so that pre-auth data surfaces
 * before it has been adopted.
 */
export function ownedBy<T extends Owned>(ownerId: string): (row: T) => boolean {
  return (row) => row.owner_id == null || row.owner_id === ownerId;
}