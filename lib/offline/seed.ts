import { db, newId, type Player } from "./db";

const SAMPLE_PLAYERS: Array<Omit<Player, "id" | "team_id" | "status" | "photo_url">> = [
  { full_name: "يوسف العمراني", jersey_number: 1, position: "حارس مرمى", parent_phone: "+212612000001" },
  { full_name: "آدم بنعلي", jersey_number: 2, position: "ظهير أيمن", parent_phone: "+212612000002" },
  { full_name: "ريان الإدريسي", jersey_number: 3, position: "قلب دفاع", parent_phone: "+212612000003" },
  { full_name: "أيوب تازي", jersey_number: 4, position: "قلب دفاع", parent_phone: "+212612000004" },
  { full_name: "أنس برادة", jersey_number: 5, position: "ظهير أيسر", parent_phone: "+212612000005" },
  { full_name: "عمر الفاسي", jersey_number: 6, position: "وسط دفاعي", parent_phone: "+212612000006" },
  { full_name: "نبيل الشرقاوي", jersey_number: 8, position: "وسط مركزي", parent_phone: "+212612000007" },
  { full_name: "زكرياء بوعالة", jersey_number: 10, position: "صانع ألعاب", parent_phone: "+212612000008" },
  { full_name: "إلياس منصوري", jersey_number: 7, position: "وسط مركزي", parent_phone: "+212612000009" },
  { full_name: "حمزة آيت لحسن", jersey_number: 9, position: "رأس حربة", parent_phone: "+212612000010" },
  { full_name: "مهدي المالكي", jersey_number: 11, position: "جناح أيمن", parent_phone: "+212612000011" },
  { full_name: "سفيان أوكيلي", jersey_number: 14, position: "جناح أيسر", parent_phone: "+212612000012" },
];

/**
 * Creates the demo team for `ownerId`, but only if that coach has no team yet.
 *
 * This must NOT use `db.teams.count()`: that counts every team in the browser,
 * including other accounts' teams. A second coach signing in on the same device
 * would be skipped, end up with no team, and be unable to save any players.
 *
 * The group is attached to the coach's first club (creating one if needed) so
 * the demo data sits correctly inside the club -> age group hierarchy.
 */
export async function seedDatabase(ownerId: string): Promise<boolean> {
  const mine = (await db.teams.toArray()).filter(
    (t) => t.owner_id == null || t.owner_id === ownerId,
  );
  if (mine.length > 0) return false;

  let clubs = (await db.clubs.toArray()).filter(
    (c) => c.owner_id == null || c.owner_id === ownerId,
  );
  let club = clubs[0];
  if (!club) {
    const id = newId();
    await db.clubs.add({
      id,
      name: "ناديي",
      city: "",
      created_at: new Date().toISOString(),
      owner_id: ownerId,
    });
    club = { id, name: "ناديي", city: "", created_at: new Date().toISOString(), owner_id: ownerId };
    clubs = [club];
  }

  const teamId = newId();
  await db.teams.add({
    id: teamId,
    name: "فئة أقل من 15 سنة - U15",
    category: "U15",
    season: "2026/2027",
    club_id: club.id!,
    created_at: new Date().toISOString(),
    owner_id: ownerId,
  });

  await db.players.bulkAdd(
    SAMPLE_PLAYERS.map((p) => ({
      ...p,
      id: newId(),
      team_id: teamId,
      status: "نشط" as const,
      photo_url: "",
      owner_id: ownerId,
    })),
  );

  return true;
}
