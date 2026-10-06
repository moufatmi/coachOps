"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Users,
  CalendarDays,
  Wallet,
  Trophy,
  Building2,
  ChevronLeft,
  MessageCircle,
  TrendingUp,
} from "lucide-react";
import { db, lineupKind, type Lineup, type Team, type TrainingSession } from "@/lib/offline/db";
import { usePyramid, useTeam } from "@/components/pyramid-provider";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

/**
 * Apex of the pyramid. Everything hangs off one coach: clubs, the age groups
 * inside them, and the totals rolled up across all of them.
 */
export default function Home() {
  const { profile, tree, ready, selectClub, selectGroup } = usePyramid();
  const { setSelectedTeamId } = useTeam();
  const { user } = useAuth();

  const groupIds = useMemo(
    () => tree.flatMap(({ groups }) => groups.map((g) => g.id!).filter(Boolean)),
    [tree],
  );

  /** Next session per age group, keyed by team id. Empty until the query lands. */
  

  const stats = useLiveQuery(
    async () => {
      if (groupIds.length === 0) return null;
      const ids = new Set<string>(groupIds);
      const [players, sessions, cotisations, expenses, lineups] = await Promise.all([
        db.players.toArray(),
        db.sessions.toArray(),
        db.cotisations.toArray(),
        db.expenses.toArray(),
        db.lineups.toArray(),
      ]);
      const inScope = <T extends { team_id?: string }>(rows: T[]) =>
        rows.filter((r) => r.team_id != null && ids.has(r.team_id));

      const squad = inScope(players);
      const groupSessions = inScope(sessions);
      const groupCotisations = inScope(cotisations);
      const groupExpenses = inScope(expenses);
      const groupLineups = inScope(lineups);

      const income = groupCotisations.reduce((s, c) => s + c.paid_amount, 0);
      const spend = groupExpenses.reduce((s, e) => s + e.amount, 0);

      // Only official fixtures count towards the season record. Training matches are
      // saved the same way but are live experiments, and a 6-0 drill showing up
      // as the club's worst defeat of the season would be indefensible.
      const played = groupLineups.filter(
        (l) => l.goals_for != null && l.goals_against != null && lineupKind(l) === "official",
      );
      let w = 0, d = 0, l = 0, gf = 0, ga = 0;
      for (const m of played as Array<Lineup & { goals_for: number; goals_against: number }>) {
        gf += m.goals_for;
        ga += m.goals_against;
        if (m.goals_for > m.goals_against) w++;
        else if (m.goals_for < m.goals_against) l++;
        else d++;
      }

      const today = new Date().toISOString().slice(0, 10);

      /**
       * Next session per age group.
       *
       * A single "next session" across the whole pyramid was misleading: a club
       * with three age groups trains three times a week, so the one nearest
       * session usually belonged to whichever group happened to be scheduled
       * first and the other groups looked like they had nothing planned. Keying
       * by team_id lets each group report its own, which is also the only useful
       * answer when deciding where to go today.
       *
       * Today counts as upcoming, since a session this afternoon is still ahead.
       */
      const nextByGroup = new Map<string, TrainingSession>();
      for (const s of groupSessions) {
        if (s.team_id == null || s.date < today) continue;
        const held = nextByGroup.get(s.team_id);
        if (!held || sessionSortKey(s) < sessionSortKey(held)) {
          nextByGroup.set(s.team_id, s);
        }
      }

      return {
        players: squad.length,
        groups: groupIds.length,
        balance: income - spend,
        income,
        spend,
        record: { w, d, l, gf, ga, played: played.length },
        nextByGroup: [...nextByGroup] as Array<[string, TrainingSession]>,
      };
    },
    [groupIds.join(",")],
    null,
  );

  /**
   * Resolves a session's age group back to the club and team rows, so the
   * upcoming list can label and open each entry. Built from `tree` rather than
   * looked up per row, because the pyramid is already in memory and a
   * per-session query would re-read the whole table for every row.
   */
  const { upcomingList, groupClubId, groupTeam } = useMemo(() => {
    const clubById = new Map<string | undefined, string>(
      tree.map(({ club }) => [club.id, club.name]),
    );
    const teamById = new Map<string, Team>();
    const owner = new Map<string, string>();

    for (const { club, groups } of tree) {
      for (const g of groups) {
        if (!g.id) continue;
        teamById.set(g.id, g);
        if (club.id) owner.set(g.id, club.id);
      }
    }

    const rows = (stats?.nextByGroup ?? [])
      .map(([teamId, session]) => {
        const group = teamById.get(teamId);
        if (!group) return null;
        const clubId = owner.get(teamId);
        return {
          session,
          group: group.name,
          club: (clubId ? clubById.get(clubId) : undefined) ?? "—",
          sortKey: sessionSortKey(session),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return { upcomingList: rows, groupClubId: owner, groupTeam: teamById };
  }, [tree, stats]);

  const enterGroup = (clubId: string, group: Team) => {
    selectClub(clubId);
    selectGroup(group.id);
    setSelectedTeamId(group.id);
  };

  /**
   * Next session per age group, keyed by team id. Derived after `stats` lands,
   * so it is an empty map until the first query resolves and every group falls
   * back to "no session scheduled" rather than flickering a stale value.
   */
  const nextByGroup = useMemo(
    () => new Map<string, TrainingSession>(stats?.nextByGroup ?? []),
    [stats],
  );

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-slate-900 p-6 text-white">
        <p className="text-sm text-slate-400">لوحة المدرب</p>
        <h1 className="mt-1 text-2xl font-black">
          {profile?.full_name?.trim() || user?.email || "CoachOps"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {profile?.phone?.trim() ? `📞 ${profile.phone} · ` : ""}
          {tree.length === 0
            ? "لا توجد أندية بعد — ابدأ بإضافة نادي"
            : `${tree.length} ${tree.length === 1 ? "نادٍ" : "أندية"} · ${stats?.groups ?? 0} ${stats?.groups === 1 ? "فئة" : "فئات"}`}
        </p>
      </header>

      {/* Totals across every club and age group */}
      {stats && stats.groups > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={Users}
            label="إجمالي اللاعبين"
            value={stats.players}
            sub={`${stats.groups} فئة`}
          />
          <Stat
            icon={Trophy}
            label="سجل الموسم"
            value={`${stats.record.w}-${stats.record.d}-${stats.record.l}`}
            sub={`لنا ${stats.record.gf} · ضدنا ${stats.record.ga}`}
          />
          <Stat
            icon={Wallet}
            label="المداخيل"
            value={stats.income}
            sub="درهم"
            tone="emerald"
          />
          <Stat
            icon={TrendingUp}
            label="الرصيد"
            value={stats.balance}
            sub="درهم"
            tone={stats.balance >= 0 ? "emerald" : "red"}
          />
        </div>
      )}

      {/* Level 2 + 3: clubs, each containing its age groups */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">الأندية والفئات</h2>

        {tree.length === 0 && (
          <div className="rounded-xl border border-dashed bg-white p-8 text-center">
            <Building2 className="mx-auto text-slate-300" size={32} />
            <p className="mt-3 font-semibold">ابدأ بإضافة نادي</p>
            <p className="mt-1 text-sm text-slate-500">
              النادي يجمع فئاتك العمرية، بأي تسميات تناسبك (U10, U15, U19…).
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-5 py-2 text-sm text-white hover:bg-emerald-700"
            >
              إدارة الأندية
            </Link>
          </div>
        )}

        {tree.map(({ club, groups }) => {
          // Soonest session across this club's age groups, for the header line.
          const clubNext = groups
            .map((g) => (g.id ? nextByGroup.get(g.id) : undefined))
            .filter((s): s is TrainingSession => s != null)
            .sort((a, b) => sessionSortKey(a).localeCompare(sessionSortKey(b)))[0];

          return (
          <section key={club.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-slate-500" />
                <div>
                  <h3 className="font-bold">{club.name}</h3>
                  {club.city && <p className="text-xs text-slate-500">{club.city}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs text-slate-700">
                  {groups.length} {groups.length === 1 ? "فئة" : "فئات"}
                </span>
                {/* The club's soonest session across its age groups, so the two
                    levels agree: each group shows its own, the club header shows
                    the first of them. */}
                {clubNext && (
                  <span className="flex items-center gap-1 text-xs text-emerald-700">
                    <CalendarDays size={12} />
                    {relativeDay(clubNext.date)}
                    {clubNext.time ? ` · ${clubNext.time}` : ""}
                  </span>
                )}
              </div>
            </div>

            {groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                لا توجد فئات في هذا النادي بعد
              </p>
            ) : (
              <ul className="divide-y">
                {groups.map((group) => {
                  const next = group.id ? nextByGroup.get(group.id) : undefined;
                  return (
                    <li key={group.id}>
                      <button
                        onClick={() => enterGroup(club.id!, group)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{group.name}</p>
                          <p className="text-xs text-slate-500">
                            {group.category}
                            {group.season ? ` · موسم ${group.season}` : ""}
                          </p>
                          {/* Each age group reports its own next session, so a
                              coach with several groups can see at a glance which
                              one trains next instead of guessing. */}
                          {next ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
                              <CalendarDays size={12} className="shrink-0" />
                              <span className="truncate">
                                {relativeDay(next.date)} · {next.type}
                                {next.time ? ` · ${next.time}` : ""}
                                {next.location ? ` · ${next.location}` : ""}
                              </span>
                            </p>
                          ) : (
                            <p className="mt-1 text-xs text-slate-400">
                              لا توجد حصة مبرمجة
                            </p>
                          )}
                        </div>
                        <ChevronLeft size={18} className="shrink-0 text-slate-400" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          );
        })}
      </div>

      {/*
        Everything upcoming, ordered. The pyramid above now shows the next
        session per age group, which answers "when does this group train next",
        but a coach with several groups still needs one ordered list to answer
        "where am I going today", and that is what this is. It is the same data,
        keyed differently, so the two can never disagree.
      */}
      {upcomingList.length > 0 && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 font-bold">
            <CalendarDays size={18} /> الحصص القادمة
          </h3>
          <ul className="mt-3 divide-y">
            {upcomingList.map(({ club, group, session }) => (
              <li key={session.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {relativeDay(session.date)} · {session.type}
                    {session.time ? ` · ${session.time}` : ""}
                  </p>
                  {/* The club and age group each session belongs to, so a
                      combined list is still unambiguous. */}
                  <p className="truncate text-xs text-slate-500">
                    {club} · {group}
                    {session.location ? ` · ${session.location}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const clubId = groupClubId.get(group);
                    const target = groupTeam.get(group);
                    if (clubId && target) enterGroup(clubId, target);
                  }}
                  className="shrink-0 rounded-lg border px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  فتح
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h3 className="font-bold">تذكير أولياء الأمور</h3>
        <p className="mt-1 text-sm text-slate-500">رسالة جماعية سريعة عبر واتساب.</p>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(
            `تذكير: جلسة تدريب غداً إن شاء الله. الحضور إلزامي.\n${profile?.full_name?.trim() ?? ""} — CoachOps`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          <MessageCircle size={16} /> إرسال تذكير
        </a>
      </div>

      {!ready && <p className="text-center text-xs text-slate-400">جارٍ تحميل الهرم…</p>}
    </div>
  );
}

/**
 * Sort key for a session: date, then time.
 *
 * `time` is free-form text typed by the coach, so it is normalised here rather
 * than trusted: "9:00" and "09:00" have to compare as equal, and a session with
 * no time must sort last within its day instead of jumping to the front. Anything
 * unparseable also sorts last, which is why the fallback is a high sentinel
 * rather than an empty string.
 */
function sessionSortKey(s: { date: string; time?: string }): string {
  const raw = (s.time ?? "").trim();
  const parsed = /^(\d{1,2})[:h.]?(\d{2})?/.exec(raw);
  const time = parsed
    ? `${String(parsed[1]).padStart(2, "0")}:${(parsed[2] ?? "00").padStart(2, "0")}`
    : "99:99";
  return `${s.date} ${time}`;
}

/**
 * A session date relative to today, falling back to the raw date once it is far
 * enough away that "in 12 days" stops being useful.
 */
function relativeDay(date: string, today = new Date().toISOString().slice(0, 10)): string {
  if (date === today) return "اليوم";
  const target = new Date(`${date}T00:00:00`);
  const base = new Date(`${today}T00:00:00`);
  const days = Math.round((target.getTime() - base.getTime()) / 86_400_000);
  if (days === 1) return "غداً";
  if (days > 1 && days <= 6) return `بعد ${days} أيام`;
  return date;
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "slate",
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "slate" | "emerald" | "red";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  } as const;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className={cn("inline-flex rounded-lg p-2", tones[tone])}>
        <Icon size={18} />
      </div>
      <p className="mt-2 text-xl font-bold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}