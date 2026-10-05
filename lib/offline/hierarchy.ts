import { db, newId, type Club, type CoachProfile, type Team } from "./db";
import { ownedBy } from "./ownership";
import { stageDelete } from "./sync-ledger";

/**
 * The pyramid: coach -> club -> age group (team) -> squad and activity rows.
 *
 * Age groups created before clubs existed have no `club_id`. Rather than
 * forcing the coach to re-enter them, they are folded into a default club on
 * first load so the hierarchy is always walkable end to end.
 */

const DEFAULT_CLUB_NAME = "ناديي";

export interface ClubWithGroups {
  club: Club;
  groups: Team[];
}

/** Creates the coach's profile row if it does not exist yet. */
export async function ensureCoachProfile(
  ownerId: string,
  fullName?: string,
): Promise<CoachProfile> {
  const existing = await db.coach_profiles.get(ownerId);
  if (existing) return existing;
  const profile: CoachProfile = {
    id: ownerId,
    full_name: fullName ?? "",
    phone: "",
    created_at: new Date().toISOString(),
  };
  await db.coach_profiles.put(profile);
  return profile;
}

export async function saveCoachProfile(
  ownerId: string,
  patch: { full_name?: string; phone?: string },
): Promise<void> {
  const current = await ensureCoachProfile(ownerId);
  await db.coach_profiles.put({
    ...current,
    full_name: patch.full_name?.trim() ?? current.full_name,
    phone: patch.phone?.trim() ?? current.phone,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Ensures every age group belongs to a club, creating a default club for any
 * that were made before the club level existed.
 *
 * Returns the coach's clubs and groups, ordered by name.
 */
export async function loadHierarchy(
  ownerId: string,
): Promise<{ clubs: Club[]; groups: Team[] }> {
  const visible = ownedBy(ownerId);

  let clubs = (await db.clubs.toArray()).filter(visible);
  let groups = (await db.teams.toArray()).filter(visible);

  const orphans = groups.filter((g) => g.club_id == null);

  if (orphans.length > 0) {
    // Reuse an existing default club if a previous run already made one.
    let club = clubs.find((c) => c.name === DEFAULT_CLUB_NAME);
    if (!club) {
      const id = newId();
      await db.clubs.add({
        id,
        name: DEFAULT_CLUB_NAME,
        city: "",
        created_at: new Date().toISOString(),
        owner_id: ownerId,
      });
      club = { id, name: DEFAULT_CLUB_NAME, city: "", created_at: new Date().toISOString(), owner_id: ownerId };
      clubs = [...clubs, club];
    }
    await db.teams.bulkPut(orphans.map((g) => ({ ...g, club_id: club!.id! })));
    groups = await db.teams.toArray();
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "ar");
  return { clubs: clubs.sort(byName), groups: groups.sort(byName) };
}

/** The full tree: each club with the age groups nested inside it. */
export function nestGroups(clubs: Club[], groups: Team[]): ClubWithGroups[] {
  return clubs.map((club) => ({
    club,
    groups: groups.filter((g) => g.club_id === club.id),
  }));
}

/** Groups with no club, which should be empty once `loadHierarchy` has run. */
export function unattachedGroups(groups: Team[], clubs: Club[]): Team[] {
  const known = new Set(clubs.map((c) => c.id));
  return groups.filter((g) => g.club_id == null || !known.has(g.club_id));
}

/**
 * Builds an age group's display name from its category and season, e.g.
 * "U15 · 2026/2027". Derived rather than typed, so a group cannot end up with a
 * name that contradicts its own category, and renaming stays consistent.
 */
export function suggestGroupName(category: string, season?: string): string {
  const cat = category.trim();
  const sea = season?.trim();
  if (cat && sea) return `${cat} · ${sea}`;
  return cat || sea || "فئة";
}

export async function addClub(
  ownerId: string,
  name: string,
  city?: string,
): Promise<string> {
  const id = newId();
  await db.clubs.add({
    id,
    name: name.trim(),
    city: city?.trim() ?? "",
    created_at: new Date().toISOString(),
    owner_id: ownerId,
  });
  return id;
}

export async function updateClub(id: string, patch: Partial<Pick<Club, "name" | "city">>): Promise<void> {
  await db.clubs.update(id, { ...patch, updated_at: new Date().toISOString() });
}

/**
 * Deletes a club, detaching its age groups.
 *
 * Dexie has no foreign keys, so the groups would otherwise keep a `club_id`
 * pointing at a row that no longer exists and vanish from every screen: the
 * server's `on delete set null` never runs locally. Detaching them here mirrors
 * what the server does on the way up, and `loadHierarchy` then folds them under
 * a default club, so a mis-click cannot destroy a squad.
 */
export async function deleteClub(clubId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", [db.clubs, db.teams], async () => {
    await db.teams.where("club_id").equals(clubId).modify({ club_id: null, updated_at: now });
    await db.clubs.delete(clubId);
  });
  await stageDelete("clubs", clubId);
}