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
import { db, type Lineup, type Team } from "@/lib/offline/db";
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

      const played = groupLineups.filter((l) => l.goals_for != null && l.goals_against != null);
      let w = 0, d = 0, l = 0, gf = 0, ga = 0;
      for (const m of played as Array<Lineup & { goals_for: number; goals_against: number }>) {
        gf += m.goals_for;
        ga += m.goals_against;
        if (m.goals_for > m.goals_against) w++;
        else if (m.goals_for < m.goals_against) l++;
        else d++;
      }

      const today = new Date().toISOString().slice(0, 10);
      const upcoming = groupSessions
        .filter((s) => s.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      return {
        players: squad.length,
        groups: groupIds.length,
        balance: income - spend,
        income,
        spend,
        record: { w, d, l, gf, ga, played: played.length },
        upcoming,
      };
    },
    [groupIds.join(",")],
    null,
  );

  const enterGroup = (clubId: string, group: Team) => {
    selectClub(clubId);
    selectGroup(group.id);
    setSelectedTeamId(group.id);
  };

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

        {tree.map(({ club, groups }) => (
          <section key={club.id} className="overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-slate-500" />
                <div>
                  <h3 className="font-bold">{club.name}</h3>
                  {club.city && <p className="text-xs text-slate-500">{club.city}</p>}
                </div>
              </div>
              <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs text-slate-700">
                {groups.length} {groups.length === 1 ? "فئة" : "فئات"}
              </span>
            </div>

            {groups.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                لا توجد فئات في هذا النادي بعد
              </p>
            ) : (
              <ul className="divide-y">
                {groups.map((group) => (
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
                      </div>
                      <ChevronLeft size={18} className="shrink-0 text-slate-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {stats?.upcoming && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h3 className="flex items-center gap-2 font-bold text-emerald-900">
            <CalendarDays size={18} /> الحصة القادمة
          </h3>
          <p className="mt-1 text-sm text-emerald-800">
            {stats.upcoming.type} — {stats.upcoming.date}
            {stats.upcoming.time ? ` · ${stats.upcoming.time}` : ""}
            {stats.upcoming.location ? ` · ${stats.upcoming.location}` : ""}
          </p>
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