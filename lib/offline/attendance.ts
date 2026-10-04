import { db, type Attendance, type AttendanceStatus, type Player } from "./db";

/**
 * Attendance history for one player.
 *
 * The raw rows already carry everything needed (`session_id` + `status`), but
 * they only mean anything once joined to the session they belong to -- a coach
 * asking "did he come last time?" needs the date, and that lives on the session
 * row, not the attendance row.
 */

export interface AttendanceEntry {
  sessionId: number;
  date: string;
  /** yyyy-mm, for grouping a month together. */
  month: string;
  type: string;
  location?: string;
  status: AttendanceStatus;
  notes?: string;
}

export interface PlayerAttendanceHistory {
  entries: AttendanceEntry[];
  stats: {
    total: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    /** Present + late over total, as a percentage. */
    rate: number;
    /** Consecutive most-recent sessions attended; 0 once one is missed. */
    currentStreak: number;
    longestStreak: number;
    /** Sessions attended out of the last five, most recent first. */
    recentForm: AttendanceStatus[];
    lastAttended?: AttendanceEntry;
    lastMissed?: AttendanceEntry;
  };
}

const ATTENDED: AttendanceStatus[] = ["حاضر", "متأخر"];

/** Resolves attendance rows into dated entries, newest session first. */
export async function getPlayerAttendanceHistory(
  playerId: number,
): Promise<PlayerAttendanceHistory> {
  const rows = await db.attendance.where("player_id").equals(playerId).toArray();
  if (rows.length === 0) {
    return {
      entries: [],
      stats: {
        total: 0,
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        rate: 0,
        currentStreak: 0,
        longestStreak: 0,
        recentForm: [],
      },
    };
  }

  const sessionIds = [...new Set(rows.map((r) => r.session_id))];
  const sessions = await db.sessions.bulkGet(sessionIds);
  const sessionById = new Map(
    sessions.filter(Boolean).map((s) => [s!.id!, s!] as const),
  );

  // A session that has since been deleted leaves its attendance row orphaned;
  // skip those rather than showing an entry with no date.
  const entries: AttendanceEntry[] = rows
    .filter((r) => sessionById.has(r.session_id))
    .map((r) => {
      const s = sessionById.get(r.session_id)!;
      return {
        sessionId: r.session_id,
        date: s.date,
        month: s.date.slice(0, 7),
        type: s.type,
        location: s.location || undefined,
        status: r.status,
        notes: r.notes || undefined,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  for (const e of entries) {
    if (e.status === "حاضر") present++;
    else if (e.status === "متأخر") late++;
    else if (e.status === "غائب") absent++;
    else excused++;
  }

  // Streaks ignore "معذور": an excused absence should not break a run, since the
  // player was not at fault.
  let currentStreak = 0;
  for (const e of entries) {
    if (ATTENDED.includes(e.status)) currentStreak++;
    else if (e.status === "غائب") break;
  }

  let longestStreak = 0;
  let run = 0;
  for (const e of entries) {
    if (ATTENDED.includes(e.status)) {
      run++;
      longestStreak = Math.max(longestStreak, run);
    } else if (e.status === "غائب") {
      run = 0;
    }
  }

  const counted = present + late + absent;
  const lastAttended = entries.find((e) => ATTENDED.includes(e.status));
  const lastMissed = entries.find((e) => e.status === "غائب");

  return {
    entries,
    stats: {
      total: entries.length,
      present,
      late,
      absent,
      excused,
      rate: counted > 0 ? Math.round(((present + late) / counted) * 100) : 0,
      currentStreak,
      longestStreak,
      recentForm: entries.slice(0, 5).map((e) => e.status),
      lastAttended,
      lastMissed,
    },
  };
}

export const ATTENDANCE_STYLE: Record<AttendanceStatus, string> = {
  حاضر: "bg-emerald-100 text-emerald-800",
  غائب: "bg-red-100 text-red-800",
  متأخر: "bg-amber-100 text-amber-800",
  معذور: "bg-blue-100 text-blue-800",
};

export const ATTENDANCE_DOT: Record<AttendanceStatus, string> = {
  حاضر: "bg-emerald-500",
  غائب: "bg-red-500",
  متأخر: "bg-amber-500",
  معذور: "bg-blue-500",
};

/** Quick counts for the player directory cards, without resolving sessions. */
export async function attendanceCountsFor(
  playerIds: number[],
): Promise<Record<number, { present: number; total: number }>> {
  const out: Record<number, { present: number; total: number }> = {};
  if (playerIds.length === 0) return out;
  const rows = await db.attendance
    .where("player_id")
    .anyOf(playerIds)
    .toArray();
  for (const r of rows as Attendance[]) {
    const cur = (out[r.player_id] ??= { present: 0, total: 0 });
    cur.total += 1;
    if (ATTENDED.includes(r.status)) cur.present += 1;
  }
  return out;
}

/** Exported for callers that need the shared attendance rows type. */
export type { Player };