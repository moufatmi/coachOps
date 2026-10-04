"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, Search, Trophy, CalendarDays, Users } from "lucide-react";
import { db, type Team, type TrainingSession, type Lineup, type Attendance } from "@/lib/offline/db";
import { buildArchive, filterSeason, type ArchiveSeason } from "@/lib/offline/archive";
import { usePyramid } from "@/components/pyramid-provider";
import { cn } from "@/lib/utils";

/** Outcome keys are non-nullable so they can key a Record; null maps to "none". */
type Outcome = "w" | "d" | "l";

const OUTCOME_STYLE: Record<Outcome | "none", string> = {
  w: "bg-emerald-100 text-emerald-800",
  d: "bg-slate-200 text-slate-700",
  l: "bg-red-100 text-red-800",
  none: "border border-dashed border-slate-300 text-slate-400",
};

const OUTCOME_LABEL: Record<Outcome | "none", string> = {
  w: "فوز",
  d: "تعادل",
  l: "خسارة",
  none: "بلا نتيجة",
};

/**
 * Read-only history, grouped by season.
 *
 * Nothing is deleted or moved here. A coach ends a season by creating the next
 * season's age group in Settings; this page then shows the two side by side, so
 * last year's numbers stay readable instead of being overwritten in place.
 */
export default function ArchiveBrowser() {
  // The whole coach, not the selected group: an archive that only showed the
  // currently-selected age group would hide most of a coach's history whenever
  // they were looking at the wrong group.
  const { clubs } = usePyramid();
  const [season, setSeason] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState({ sessions: true, matches: true });

  const data = useLiveQuery(
    async () => {
      const [teams, sessions, lineups, attendance] = await Promise.all([
        db.teams.toArray(),
        db.sessions.toArray(),
        db.lineups.toArray(),
        db.attendance.toArray(),
      ]);
      return {
        teams: teams as Team[],
        sessions: sessions as TrainingSession[],
        lineups: lineups as Lineup[],
        attendance: attendance as Attendance[],
      };
    },
    [clubs.length],
    null,
  );

  const archive = useMemo(() => {
    if (!data) return null;
    // `Team.id` is optional on the row type but every real row has one; a group
    // without an id cannot own sessions, so it contributes nothing anyway.
    const teams = data.teams
      .filter((t): t is Team & { id: string } => t.id != null)
      .map((t) => ({ id: t.id, name: t.name, season: t.season, category: t.category }));
    return buildArchive(
      teams,
      data.sessions.filter((s): s is TrainingSession & { id: string } => s.id != null),
      data.lineups.filter((l): l is Lineup & { id: string } => l.id != null),
      data.attendance,
    );
  }, [data]);

  // Default to the newest season, but follow the coach if they pick another.
  const activeSeason: ArchiveSeason | undefined = useMemo(() => {
    if (!archive || archive.seasons.length === 0) return undefined;
    const wanted = season ?? archive.availableSeasons[0];
    return archive.seasons.find((s) => s.season === wanted) ?? archive.seasons[0];
  }, [archive, season]);

  const shown = useMemo(
    () => (activeSeason ? filterSeason(activeSeason, query, kinds) : null),
    [activeSeason, query, kinds],
  );

  if (!data) {
    return <div className="py-16 text-center text-sm text-slate-400">جارٍ تحميل الأرشيف…</div>;
  }

  if (!archive || archive.seasons.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white p-10 text-center">
        <Archive className="mx-auto text-slate-300" size={32} />
        <p className="mt-3 font-semibold">لا يوجد أرشيف بعد</p>
        <p className="mt-1 text-sm text-slate-500">
          سيظهر هنا سجل الحصص والمباريات السابقة. سجّل حصصك من صفحة الجدول وستظهر هنا تلقائياً.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">الأرشيف</h2>
        <p className="text-sm text-slate-500">
          سجل سابق للكل، مقسّم حسب الموسم. لا يُحذف شيء — لتبدأ موسماً جديداً أنشئ فئة جديدة من الإعدادات.
        </p>
      </div>

      {/* Season + search */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <label className="min-w-40 text-xs font-medium text-slate-500">
          الموسم
          <select
            value={activeSeason?.season ?? ""}
            onChange={(e) => setSeason(e.target.value)}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
          >
            {archive.availableSeasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="min-w-48 flex-1 text-xs font-medium text-slate-500">
          بحث
          <span className="relative mt-1 block">
            <Search size={14} className="absolute top-1/2 -translate-y-1/2 text-slate-400" style={{ insetInlineStart: 8 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اسم الخصم، المكان، النوع، التاريخ…"
              className="w-full rounded-lg border px-3 py-2 pe-8 text-sm"
            />
          </span>
        </label>

        <div className="flex gap-2 pb-0.5">
          <button
            onClick={() => setKinds({ sessions: !kinds.sessions, matches: kinds.matches })}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium",
              kinds.sessions ? "bg-emerald-600 text-white" : "bg-white text-slate-600",
            )}
          >
            <CalendarDays size={14} /> الحصص
          </button>
          <button
            onClick={() => setKinds({ sessions: kinds.sessions, matches: !kinds.matches })}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium",
              kinds.matches ? "bg-emerald-600 text-white" : "bg-white text-slate-600",
            )}
          >
            <Trophy size={14} /> المباريات
          </button>
        </div>
      </div>

      {activeSeason && (
        <>
          {/* Season summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">سجل الموسم</p>
              <p className="mt-1 text-xl font-black">
                {activeSeason.record.wins}-{activeSeason.record.draws}-{activeSeason.record.losses}
              </p>
              <p className="text-xs text-slate-400">
                {activeSeason.record.played} مباراة مسجّلة
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">لنا / ضدنا</p>
              <p className="mt-1 text-xl font-black">
                {activeSeason.record.goalsFor} / {activeSeason.record.goalsAgainst}
              </p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">الحصص</p>
              <p className="mt-1 text-xl font-black">{activeSeason.sessions.length}</p>
              <p className="text-xs text-slate-400">{activeSeason.teamNames.join(" · ")}</p>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="text-xs text-slate-500">المباريات</p>
              <p className="mt-1 text-xl font-black">{activeSeason.matches.length}</p>
              <p className="text-xs text-slate-400">
                {activeSeason.matches.filter((m) => !m.played).length} بلا نتيجة
              </p>
            </div>
          </div>

          {/* Matches */}
          {kinds.matches && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-bold">
                <Trophy size={16} /> المباريات
              </h3>
              {shown!.matches.length === 0 ? (
                <EmptyRow text="لا توجد مباريات مطابقة." />
              ) : (
                <ul className="divide-y rounded-xl border bg-white">
                  {shown!.matches.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="font-medium">{m.date}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">
                        ضد {m.opponent || "؟"} <span className="text-slate-400">({m.formation ?? "—"}, {m.venue ?? "—"})</span>
                      </span>
                      <span className="text-xs text-slate-400">{m.teamName}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", OUTCOME_STYLE[m.outcome ?? "none"])}>
                        {m.played ? `${m.goals_for} - ${m.goals_against}` : OUTCOME_LABEL[m.outcome ?? "none"]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Sessions */}
          {kinds.sessions && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-bold">
                <Users size={16} /> الحصص
              </h3>
              {shown!.sessions.length === 0 ? (
                <EmptyRow text="لا توجد حصص مطابقة." />
              ) : (
                <ul className="divide-y rounded-xl border bg-white">
                  {shown!.sessions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="font-medium">{s.date}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-600">
                        {s.type} <span className="text-slate-400">· {s.location || "—"}</span>
                      </span>
                      <span className="text-xs text-slate-400">{s.teamName}</span>
                      {s.marked === 0 ? (
                        <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-400">
                          لم يُسجّل الحضور
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-slate-600">
                          <span className="text-emerald-700">{s.present + s.late}</span>/
                          {s.marked} حاضر
                          {s.absent > 0 && <span className="text-red-600"> · {s.absent} غائب</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed bg-white px-4 py-6 text-center text-sm text-slate-400">{text}</p>;
}