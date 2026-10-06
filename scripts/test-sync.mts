/**
 * Verifies the three data-loss bugs that used to make the app look broken:
 *
 *   1. A deleted row came back on the next pull.
 *   2. Emptying the server had no effect, because the next push re-uploaded
 *      the entire local database.
 *   3. The same club under two device-generated ids stayed duplicated forever.
 *
 * Run with:  node --experimental-strip-types scripts/test-sync.mts
 *
 * Dexie needs a real IndexedDB, so fake-indexeddb stands in for it. Supabase is
 * replaced by a small in-memory table that honours the same `.upsert()`,
 * `.select()`, `.delete().in()` and `.delete().eq()` shapes the sync code uses.
 */
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import { db, newId } from "../lib/offline/db.ts";
import {
  pushToCloud,
  pullFromCloud,
  resetCloud,
  mergeDuplicateClubs,
} from "../lib/supabase/sync.ts";
import { addClub, deleteClub } from "../lib/offline/hierarchy.ts";
import { resetAllData, deletePlayerCascade } from "../lib/offline/data.ts";
import {
  stageDelete,
  stagedDeletes,
  syncedIdsFor,
} from "../lib/offline/sync-ledger.ts";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** Minimal stand-in for the subset of the Supabase client the sync uses. */
function fakeCloud() {
  const tables = new Map<string, Array<Record<string, unknown>>>();

  function rows(table: string) {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  }

  const client = {
    from(table: string) {
      const self = {
        upsert: async (payload: Array<Record<string, unknown>>) => {
          const store = rows(table);
          for (const row of payload) {
            const at = store.findIndex((r) => r.id === row.id);
            if (at >= 0) store[at] = { ...store[at], ...row };
            else store.push({ ...row });
          }
          return { error: null };
        },
        select: async () => {
          // RLS: a coach only ever sees their own rows.
          const visible = rows(table).filter(
            (r) => table === "coach_profiles" ? r.id === UID : r.owner_id === UID,
          );
          return { data: visible.map((r) => ({ ...r })), error: null };
        },
        delete: () => {
          let test: ((r: Record<string, unknown>) => boolean) | null = null;
          const finish = () => {
            const store = rows(table);
            const doomed = test ? store.filter(test) : [];
            if (test) tables.set(table, store.filter((r) => !test!(r)));
            return { error: null, count: doomed.length };
          };
          return {
            in: async (_column: string, ids: string[]) => {
              test = (r) => ids.includes(String(r.id));
              return finish();
            },
            eq: async (column: string, value: string) => {
              test = (r) => String(r[column]) === value;
              return finish();
            },
          };
        },
      };
      return self;
    },
  };

  return {
    client: client as never,
    rows,
    clear: () => tables.clear(),
  };
}

let cloud = fakeCloud();

async function reset() {
  await db.delete();
  await db.open();
  cloud.clear();
}

const passed: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  await reset();
  await fn();
  passed.push(name);
  console.log(`  ok  ${name}`);
}

/** Replaces the module-level cloud between tests. */
function useCloud(next: ReturnType<typeof fakeCloud>) {
  cloud = next;
}

console.log("\nsync reconciliation\n");

await test("deleting a player takes his payment records with him", async () => {
  const c = fakeCloud();
  useCloud(c);
  const teamId = newId();
  const playerId = newId();
  const sessionId = newId();
  await db.teams.add({
    id: teamId,
    name: "U13",
    category: "U13",
    season: "2026/2027",
    club_id: null,
    created_at: new Date().toISOString(),
    owner_id: UID,
  });
  await db.players.add({
    id: playerId,
    team_id: teamId,
    full_name: "Youssef",
    jersey_number: 9,
    position: "FWD",
    parent_phone: "",
    status: "نشط",
    owner_id: UID,
  });
  await db.sessions.add({
    id: sessionId,
    team_id: teamId,
    date: "2026-10-01",
    type: "تدريب",
    location: "Carbon",
    owner_id: UID,
  });
  await db.cotisations.add({
    id: newId(),
    team_id: teamId,
    player_id: playerId,
    month: "2026-10",
    season: "2026/2027",
    expected_amount: 200,
    paid_amount: 200,
    status: "paid",
    created_at: new Date().toISOString(),
    owner_id: UID,
  });
  await db.attendance.add({
    id: newId(),
    session_id: sessionId,
    player_id: playerId,
    status: "حاضر",
    owner_id: UID,
  });
  await db.evaluations.add({
    id: newId(),
    player_id: playerId,
    team_id: teamId,
    date: "2026-10-01",
    technique: 4,
    physique: 4,
    tactique: 3,
    mental: 5,
    created_at: new Date().toISOString(),
    owner_id: UID,
  });

  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("cotisations").length, 1, "precondition: synced");

  // The exact call the delete button makes in components/teams/player-directory.
  await deletePlayerCascade(playerId);

  // The local database must not keep rows for a player who is gone. This is the
  // regression: they used to survive here and were re-sent by the next push,
  // which the server rejected with cotisations_player_id_fkey.
  assert.equal((await db.players.toArray()).length, 0);
  assert.equal((await db.cotisations.toArray()).length, 0, "payment records must go");
  assert.equal((await db.attendance.toArray()).length, 0, "attendance must go");
  assert.equal((await db.evaluations.toArray()).length, 0, "evaluations must go");

  // And the push must now be accepted: no row references a missing player.
  const report = await pushToCloud(c.client as never, UID);
  assert.deepEqual(report.errors, [], `push should be clean, got: ${report.errors}`);
  assert.equal(c.rows("players").length, 0);
  assert.equal(c.rows("cotisations").length, 0);
  assert.equal(c.rows("attendance").length, 0);
  assert.equal(c.rows("evaluations").length, 0);
  // The session itself survives: only the player's attendance row was tied to him.
  assert.equal(c.rows("sessions").length, 1, "unrelated rows must be kept");
});

await test("a deleted club is removed from the server, not restored", async () => {
  const c = fakeCloud();
  useCloud(c);
  const clubId = await addClub(UID, "Raja", "Casablanca");
  await db.teams.add({
    id: newId(),
    name: "U13",
    category: "U13",
    season: "2026/2027",
    club_id: clubId,
    created_at: new Date().toISOString(),
    owner_id: UID,
  });

  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 1, "club should reach the server");

  await deleteClub(clubId);
  const push = await pushToCloud(c.client as never, UID);
  assert.equal(push.deleted.clubs, 1, "delete should be reported");
  assert.equal(c.rows("clubs").length, 0, "server should no longer hold the club");

  // The regression: a pull must not bring it back.
  await pullFromCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 0);
  assert.equal(
    (await db.clubs.toArray()).length,
    0,
    "the deleted club must stay gone locally",
  );
});

await test("a delete from another device is applied locally", async () => {
  const c = fakeCloud();
  useCloud(c);
  await addClub(UID, "Wydad", "Casablanca");
  const playerId = newId();
  await db.players.add({
    id: playerId,
    team_id: newId(),
    full_name: "Youssef",
    jersey_number: 9,
    position: "FWD",
    parent_phone: "",
    status: "نشط",
    owner_id: UID,
  });

  await pushToCloud(c.client as never, UID);
  assert.ok((await syncedIdsFor("players", UID)).has(playerId));

  // Another device deletes it.
  c.rows("players").length = 0;

  const pull = await pullFromCloud(c.client as never, UID);
  assert.equal(pull.pruned.players, 1, "the missing row should be pruned");
  assert.equal(
    (await db.players.toArray()).length,
    0,
    "the player should not survive a deletion made elsewhere",
  );
});

await test("unpushed local work survives a pull", async () => {
  const c = fakeCloud();
  useCloud(c);
  await addClub(UID, "Raja", "Casablanca");
  await pushToCloud(c.client as never, UID);

  // Created offline, never pushed.
  const offline = await addClub(UID, "Olympic", "Safi");

  await pullFromCloud(c.client as never, UID);

  const names = (await db.clubs.toArray()).map((x) => x.name);
  assert.ok(names.includes("Olympic"), "an unpushed club must not be pruned");
  assert.ok(names.includes("Raja"));
  assert.equal(offline.length, 36, "sanity: uuid length");
});

await test("a row resurrected by a pull is still deleted by the next push", async () => {
  const c = fakeCloud();
  useCloud(c);
  const clubId = await addClub(UID, "Raja", "Casablanca");
  await pushToCloud(c.client as never, UID);

  // Deleted here, tombstoned, but the push has not run yet.
  await db.clubs.delete(clubId);
  await stageDelete("clubs", clubId);

  // A stale device re-sends it, so a pull brings it back locally.
  await pullFromCloud(c.client as never, UID);
  assert.equal((await db.clubs.toArray()).length, 1, "precondition: it is back");

  const push = await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 0, "the tombstone must win");
  assert.equal(push.deleted.clubs, 1);
  assert.equal(
    (await stagedDeletes()).length,
    0,
    "a honoured tombstone should be cleared",
  );
});

await test("two ids for the same club collapse into one", async () => {
  const c = fakeCloud();
  useCloud(c);
  const first = await addClub(UID, "Raja", "Casablanca");
  const groupId = newId();
  await db.teams.add({
    id: groupId,
    name: "U13",
    category: "U13",
    season: "2026/2027",
    club_id: first,
    created_at: new Date().toISOString(),
    owner_id: UID,
  });

  // The same club created again on another device, days later.
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const second = newId();
  await db.clubs.add({
    id: second,
    name: "  raja  ",
    city: "Casablanca",
    created_at: later,
    owner_id: UID,
  });
  await db.teams.add({
    id: newId(),
    name: "U15",
    category: "U15",
    season: "2026/2027",
    club_id: second,
    created_at: later,
    owner_id: UID,
  });

  const merged = await mergeDuplicateClubs(UID);
  assert.equal(merged, 1, "one duplicate should be merged");

  const clubs = await db.clubs.toArray();
  assert.equal(clubs.length, 1, "only one club should remain");
  assert.equal(clubs[0].id, first, "the oldest club should win");

  const teams = await db.teams.toArray();
  assert.equal(teams.length, 2, "no squad may be lost");
  for (const t of teams) {
    assert.equal(t.club_id, first, "every group should point at the survivor");
  }

  // And the loser leaves the server too.
  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 1);
});

await test("groups orphaned by a deleted club are re-attached", async () => {
  const c = fakeCloud();
  useCloud(c);
  const clubId = await addClub(UID, "Raja", "Casablanca");
  const groupId = newId();
  await db.teams.add({
    id: groupId,
    name: "U13",
    category: "U13",
    season: "2026/2027",
    club_id: clubId,
    created_at: new Date().toISOString(),
    owner_id: UID,
  });
  await pushToCloud(c.client as never, UID);

  // A stale server copy of the group still references the club.
  c.rows("clubs").length = 0;

  const pull = await pullFromCloud(c.client as never, UID);
  assert.ok(pull.detached >= 1, "the dangling link should be repaired");

  const groups = await db.teams.toArray();
  assert.equal(groups.length, 1, "the group must survive");
  assert.equal(groups[0].club_id, null, "and must not point at a missing club");
});

await test("reset sticks: local wipe plus cloud wipe, in that order", async () => {
  const c = fakeCloud();
  useCloud(c);
  await addClub(UID, "Raja", "Casablanca");
  await addClub(UID, "Olympic", "Safi");
  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 2);

  // This is the sequence the settings button performs.
  await resetAllData();
  await resetCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 0, "the server should be empty");
  assert.equal((await db.clubs.toArray()).length, 0, "and so should the device");

  // The regression: neither half undoes the other afterwards. Dexie alone used to
  // re-upload everything on the next push, which is why emptying the Supabase
  // tables by hand appeared to have no effect.
  await pullFromCloud(c.client as never, UID);
  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 0, "reset must not be undone by a push");
  assert.equal((await db.clubs.toArray()).length, 0);
});

await test("resetCloud alone does not resurrect the local database", async () => {
  const c = fakeCloud();
  useCloud(c);
  await addClub(UID, "Raja", "Casablanca");
  await pushToCloud(c.client as never, UID);

  // Cloud-only wipe, local rows untouched. The push puts them back, which is
  // correct: it is the local wipe that decides the data is gone.
  await resetCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 0);
  await pushToCloud(c.client as never, UID);
  assert.equal(c.rows("clubs").length, 1, "local rows are the source of truth");
});

await test("another coach's rows are never read or deleted", async () => {
  const c = fakeCloud();
  useCloud(c);
  await addClub(UID, "Raja", "Casablanca");
  await pushToCloud(c.client as never, UID);

  // Same name, different owner: not a duplicate, and not visible.
  await db.clubs.add({
    id: newId(),
    name: "Raja",
    city: "Casablanca",
    created_at: new Date().toISOString(),
    owner_id: OTHER,
  });

  const merged = await mergeDuplicateClubs(UID);
  assert.equal(merged, 0, "another coach's club is not a duplicate");
  assert.equal((await db.clubs.toArray()).length, 2);

  const pull = await pullFromCloud(c.client as never, UID);
  assert.equal(pull.pruned.clubs ?? 0, 0, "their row must not be pruned");
  assert.equal(c.rows("clubs").length, 1, "and must not be deleted");
  assert.equal(
    (await db.clubs.toArray()).length,
    2,
    "both clubs remain: a shared name is not a duplicate",
  );
});

await db.delete();

console.log(`\n${passed.length} passed\n`);