/**
 * Archive history: finished sessions and finished matches, grouped by season.
 *
 * Pure functions over already-loaded rows, no Dexie access, so the grouping and
 * the season rollup can be reasoned about (and tested) without a database.
 *
 * Season is not stored on sessions or lineups. It comes from the owning team's
 * `season` string, which is why a finished season stays coherent: the coach
 * creates next season's age group, and its rows land under the new heading while
 * the old ones stay where they were.
 *
 * Nothing here deletes or moves anything. Archiving is a view, not a state.
 */

export interface ArchiveTeam {
  id: string;
  name: string;
  season: string;
  category: string;
}

export interface ArchiveSessionRow {
  id: string;
  team_id: string;
  date: string;
  type: string;
  location?: string;
  notes?: string;
}

export interface ArchiveLineupRow {
  id: string;
  team_id: string;
  date: string;
  opponent?: string;
  formation?: string;
  venue?: string;
  goals_for?: number | null;
  goals_against?: number | null;
}

export interface ArchiveAttendanceRow {
  session_id: string;
  status: string;
}

export interface ArchiveSession extends ArchiveSessionRow {
  teamName: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Attendance rows recorded. 0 means nobody was ever marked. */
  marked: number;
}

export interface ArchiveMatch extends ArchiveLineupRow {
  teamName: string;
  /** True once a scoreline has been entered. */
  played: boolean;
  /** Win / draw / loss, or null while the result is missing. */
  outcome: "w" | "d" | "l" | null;
}

export interface ArchiveSeason {
  season: string;
  teamNames: string[];
  sessions: ArchiveSession[];
  matches: ArchiveMatch[];
  record: {
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
}

export interface Archive {
  seasons: ArchiveSeason[];
  /** Every season present, newest label first, for the picker. */
  availableSeasons: string[];
  totals: ArchiveSeason["record"];
}

/** Sorts a "2025/2026"-style label newest first. Falls back to string order. */
function compareSeasonsDesc(a: string, b: string): number {
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const [ay, by] = [nums(a), nums(b)];
  // A season label like "2025/2026" should sort by its first year.
  if (ay.length > 0 && by.length > 0 && ay[0] !== by[0]) return by[0] - ay[0];
  return b.localeCompare(a, "en", { numeric: true });
}

function compareDatesDesc(a: { date: string }, b: { date: string }): number {
  return b.date.localeCompare(a.date);
}

/**
 * Builds the whole archive.
 *
 * @param teams      every age group across all clubs
 * @param sessions   every session across those groups
 * @param lineups    every saved lineup/match across those groups
 * @param attendance attendance rows for those sessions
 */
export function buildArchive(
  teams: ArchiveTeam[],
  sessions: ArchiveSessionRow[],
  lineups: ArchiveLineupRow[],
  attendance: ArchiveAttendanceRow[],
): Archive {
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Attendance is counted per session. Counting every row directly would be
  // wrong: a session nobody marked has 0 rows and must not read as "0 present of
  // 0", which would otherwise imply full attendance.
  const attBySession = new Map<string, { present: number; late: number; absent: number; excused: number; marked: number }>();
  for (const a of attendance) {
    const bucket = attBySession.get(a.session_id) ?? { present: 0, late: 0, absent: 0, excused: 0, marked: 0 };
    bucket.marked++;
    if (a.status === "حاضر") bucket.present++;
    else if (a.status === "متأخر") bucket.late++;
    else if (a.status === "غائب") bucket.absent++;
    else if (a.status === "معذور") bucket.excused++;
    attBySession.set(a.session_id, bucket);
  }

  const blank = () => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });

  const bySeason = new Map<string, ArchiveSeason>();

  function seasonFor(teamId: string): string {
    // A team with no season still needs a bucket, or its history would vanish.
    return teamById.get(teamId)?.season?.trim() || "بدون موسم";
  }

  for (const s of sessions) {
    const season = seasonFor(s.team_id);
    const entry = bySeason.get(season) ?? {
      season,
      teamNames: [],
      sessions: [],
      matches: [],
      record: blank(),
    };
    const counts = attBySession.get(s.id) ?? { present: 0, late: 0, absent: 0, excused: 0, marked: 0 };
    entry.sessions.push({
      ...s,
      teamName: teamById.get(s.team_id)?.name ?? "فئة محذوفة",
      ...counts,
    });
    bySeason.set(season, entry);
  }

  for (const l of lineups) {
    const season = seasonFor(l.team_id);
    const entry = bySeason.get(season) ?? {
      season,
      teamNames: [],
      sessions: [],
      matches: [],
      record: blank(),
    };
    // `played` requires both figures. A lineup saved with only one of them is a
    // half-entered result and must not count as a 0-0 draw.
    const played = l.goals_for != null && l.goals_against != null;
    let outcome: ArchiveMatch["outcome"] = null;
    if (played) {
      const gf = l.goals_for as number;
      const ga = l.goals_against as number;
      outcome = gf > ga ? "w" : gf < ga ? "l" : "d";
      entry.record.played++;
      entry.record.goalsFor += gf;
      entry.record.goalsAgainst += ga;
      if (outcome === "w") entry.record.wins++;
      else if (outcome === "d") entry.record.draws++;
      else entry.record.losses++;
    }
    entry.matches.push({
      ...l,
      teamName: teamById.get(l.team_id)?.name ?? "فئة محذوفة",
      played,
      outcome,
    });
    bySeason.set(season, entry);
  }

  const seasons = [...bySeason.values()];
  for (const s of seasons) {
    const names = new Set<string>();
    for (const t of teams) if (seasonFor(t.id) === s.season) names.add(t.name);
    s.teamNames = [...names];
    s.sessions.sort(compareDatesDesc);
    s.matches.sort(compareDatesDesc);
  }
  seasons.sort((a, b) => compareSeasonsDesc(a.season, b.season));

  const totals = seasons.reduce<ArchiveSeason["record"]>((acc, s) => {
    acc.played += s.record.played;
    acc.wins += s.record.wins;
    acc.draws += s.record.draws;
    acc.losses += s.record.losses;
    acc.goalsFor += s.record.goalsFor;
    acc.goalsAgainst += s.record.goalsAgainst;
    return acc;
  }, blank());

  return {
    seasons,
    availableSeasons: seasons.map((s) => s.season),
    totals,
  };
}

/**
 * Filters one season down to a text query.
 *
 * Deliberately matches opponent *and* team name, because a coach looking for
 * "الرجاء" wants every match against them across their groups, not just the one
 * group they happen to be looking at.
 */
export function filterSeason(
  season: ArchiveSeason,
  query: string,
  kinds: { sessions: boolean; matches: boolean },
): { sessions: ArchiveSession[]; matches: ArchiveMatch[] } {
  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) =>
    q === "" || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  return {
    sessions: kinds.sessions
      ? season.sessions.filter((s) =>
          hit(s.date, s.type, s.location, s.notes, s.teamName),
        )
      : [],
    matches: kinds.matches
      ? season.matches.filter((m) =>
          hit(m.date, m.opponent, m.formation, m.venue, m.teamName),
        )
      : [],
  };
}