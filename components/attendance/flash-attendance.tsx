"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "next/navigation";
import { MessageCircle, CalendarDays } from "lucide-react";
import { db, type AttendanceStatus, type TrainingSession , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

const STATUS_CYCLE: AttendanceStatus[] = ["حاضر", "غائب", "متأخر", "معذور"];

const STATUS_STYLES: Record<AttendanceStatus, { card: string; label: string }> = {
  حاضر: { card: "bg-emerald-100 border-emerald-400 text-emerald-800", label: "حاضر" },
  غائب: { card: "bg-red-100 border-red-400 text-red-800", label: "غائب" },
  متأخر: { card: "bg-amber-100 border-amber-400 text-amber-800", label: "متأخر" },
  معذور: { card: "bg-blue-100 border-blue-400 text-blue-800", label: "معذور" },
};

/**
 * The single attendance screen.
 *
 * This used to be one of two: the schedule's session modal could also set
 * statuses, which meant two places to do the same job with different
 * capabilities (only this one had the WhatsApp report) and different limits
 * (only the modal could open a past session). Marking attendance at the door
 * wants the big tap targets here; fixing a forgotten session wants to choose the
 * date. So the session picker below serves both, and the schedule now links here
 * instead of opening its own editor.
 */
/**
 * `useSearchParams` forces the client component to be dynamic, which Next
 * requires to sit behind a Suspense boundary. The fallback matches the shape of
 * the real screen so the layout does not jump once the query resolves.
 */
export default function FlashAttendance() {
  return (
    <Suspense fallback={<div className="h-10" />}>
      <AttendanceScreen />
    </Suspense>
  );
}

function AttendanceScreen() {
  const searchParams = useSearchParams();
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);
  const today = new Date().toISOString().slice(0, 10);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  /**
   * The session being marked. `null` means "follow today", which is what a coach
   * opening the page at training time wants. The schedule links here with
   * `?session=<id>` to open one specific session, often a past one.
   *
   * Seeded from the URL rather than read in an effect: Suspense above guarantees
   * the param is available on the first render, so there is no flash of "today"
   * before switching to the session that was actually asked for.
   */
  const [pickedSessionId, setPickedSessionId] = useState<string | null>(
    searchParams.get("session"),
  );

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [],
  );

  const sessions = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as TrainingSession[];
      const rows = await db.sessions.where("team_id").equals(selectedTeamId).toArray();
      return rows.sort((a, b) => b.date.localeCompare(a.date));
    },
    [selectedTeamId],
    [] as TrainingSession[],
  );

  const todaySession = useMemo(() => sessions.find((s) => s.date === today), [sessions, today]);
  const picked = pickedSessionId ? sessions.find((s) => s.id === pickedSessionId) : undefined;
  // A picked session that has since been deleted falls back to today rather than
  // leaving the page blank.
  const session = picked ?? todaySession;

  // Opening this page must not invent a scheduled session. A session row is
  // shared with /schedule, so creating one silently made the schedule claim a
  // session the coach never planned -- and it happened again every day the page
  // was opened. The coach is asked instead.
  async function createTodaySession(): Promise<void> {
    if (!selectedTeamId || creating) return;
    setCreating(true);
    setNotice("");
    try {
      await db.sessions.add({
        id: newId(),
        team_id: selectedTeamId,
        date: today,
        type: "تدريب",
        location: "",
        notes: "",
        owner_id: ownerId,
      });
    } catch (e) {
      console.error("Create session failed:", e);
      setNotice("تعذّر إنشاء الحصة. حاول مرة أخرى.");
    } finally {
      setCreating(false);
    }
  }

  // Once a session exists, seed one attendance row per player so every card
  // shows a status instead of appearing blank. This only fills in missing rows;
  // statuses the coach has already set are never overwritten.
  useEffect(() => {
    // Captured as consts: TypeScript cannot narrow optional ids across the
    // async closure boundary.
    const sessionId = session?.id;
    const teamId = selectedTeamId;
    if (sessionId == null || teamId == null) return;
    let cancelled = false;
    (async () => {
      const squad = await db.players.where("team_id").equals(teamId).toArray();
      const existing = await db.attendance.where("session_id").equals(sessionId).toArray();
      if (cancelled) return;
      const seen = new Set(existing.map((a) => a.player_id));
      const missing = squad.filter((p) => p.id != null && !seen.has(p.id));
      if (missing.length === 0) return;
      await db.attendance.bulkAdd(
        missing.map((p) => ({
          id: newId(),
          session_id: sessionId,
          player_id: p.id!,
          status: "حاضر" as const,
          owner_id: ownerId,
        })),
      );
    })().catch((e) => console.error("Seed attendance failed:", e));
    return () => {
      cancelled = true;
    };
  }, [session?.id, selectedTeamId, ownerId]);

  const records = useLiveQuery(
    () => (session?.id ? db.attendance.where("session_id").equals(session.id).toArray() : []),
    [session?.id],
    [],
  );

  const statusByPlayer = new Map<string, { status: AttendanceStatus; recordId?: string }>(
    records.map((r) => [r.player_id, { status: r.status, recordId: r.id }]),
  );

  const counts = { حاضر: 0, غائب: 0, متأخر: 0, معذور: 0 } as Record<AttendanceStatus, number>;
  for (const r of records) counts[r.status]++;

  async function cycleStatus(playerId: string) {
    const rec = statusByPlayer.get(playerId);
    if (!rec) return;
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(rec.status) + 1) % STATUS_CYCLE.length];
    if (rec.recordId != null) await db.attendance.update(rec.recordId, { status: next });
  }

  function shareWhatsApp() {
    // The report must describe the session on screen, not today: this page can
    // now be opened for a past date.
    const dateLabel = new Date(session?.date ?? today)
      .toLocaleDateString("ar", { day: "2-digit", month: "2-digit", year: "numeric" });
    const absents = players.filter((p) => statusByPlayer.get(p.id!)?.status === "غائب").map((p) => p.full_name);
    const retards = players.filter((p) => statusByPlayer.get(p.id!)?.status === "متأخر").map((p) => p.full_name);
    const lines = [
      `📋 *تقرير الحضور — ${team?.name ?? ""}*`,
      `📅 التاريخ: ${dateLabel}`,
      ``,
      `✅ الحاضرون: ${counts.حاضر}`,
      `❌ الغائبون: ${counts.غائب}`,
      `⏰ المتأخرون: ${counts.متأخر}`,
      `🔵 المعذورون: ${counts.معذور}`,
      `👥 الإجمالي: ${players.length}`,
    ];
    if (absents.length) lines.push(``, `❌ الغائبون: ${absents.join("، ")}`);
    if (retards.length) lines.push(`⏰ المتأخرون: ${retards.join("، ")}`);
    lines.push(``, `— CoachOps ⚽`);
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">تسجيل الحضور</h2>
          <p className="text-sm text-slate-500">
            {session
              ? `حصة ${session.date}${session.time ? ` · ${session.time}` : ""} — اضغط على اللاعب لتغيير حالته`
              : "اختر حصة أو أنشئ حصة اليوم"}
          </p>
        </div>
        {session && players.length > 0 && (
          <button
            onClick={shareWhatsApp}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 transition"
          >
            <MessageCircle size={18} />
            مشاركة التقرير عبر الواتساب
          </button>
        )}
      </div>

      {/* Session picker: defaults to today, can open any session. This is what
          replaced the schedule's own attendance editor. */}
      {players.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
          <label className="flex-1 text-xs font-medium">
            الحصة
            <select
              value={pickedSessionId ?? ""}
              onChange={(e) => setPickedSessionId(e.target.value || null)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">
                {todaySession
                  ? `اليوم · ${todaySession.date}${todaySession.time ? ` · ${todaySession.time}` : ""} — ${todaySession.type}`
                  : "اليوم — لا توجد حصة مسجّلة"}
              </option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date}
                  {s.time ? ` · ${s.time}` : ""} — {s.type}
                  {s.location ? ` · ${s.location}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!todaySession && (
            <button
              onClick={() => void createTodaySession()}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CalendarDays size={16} />
              {creating ? "جارٍ الإنشاء…" : "إنشاء حصة اليوم"}
            </button>
          )}
        </div>
      )}

      {/* No squad yet: explain before offering to create a session, so an empty
          roster is not mistaken for a broken page. */}
      {players.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
          <h3 className="font-bold">لا يوجد لاعبون في هذه الفئة بعد</h3>
          <p className="mt-1 text-sm text-slate-500">
            أضف اللاعبين من صفحة «الفرق واللاعبون» لتسجيل الحضور.
          </p>
          <a
            href="/teams"
            className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
          >
            الذهاب إلى اللاعبين
          </a>
        </div>
      )}

      {/* Nothing to mark: either no sessions exist yet, or none today and none
          picked from the list above. */}
      {!session && players.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h3 className="font-bold">
            {sessions.length === 0 ? "لا توجد حصص مسجّلة لهذه الفئة" : "لا توجد حصة مسجّلة لهذا اليوم"}
          </h3>
          <p className="mt-1 text-sm">
            {sessions.length === 0 ? (
              <>أنشئ أول حصة، أو أضفها من صفحة الجدول.</>
            ) : (
              <>
                لتسجيل الحضور، أنشئ حصة اليوم (ستظهر أيضاً في الجدول)، أو اختر حصة سابقة من القائمة
                أعلاه لتسجيلها متأخراً.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void createTodaySession()}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {creating ? "جارٍ الإنشاء…" : "إنشاء حصة اليوم"}
            </button>
            <a
              href="/schedule"
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm hover:bg-amber-50"
            >
              الذهاب إلى الجدول
            </a>
          </div>
          {notice && <p className="mt-2 text-sm text-red-700">{notice}</p>}
        </div>
      )}

      {session && players.length > 0 && (
        <>
      {/* Summary bar */}
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 rounded-xl border bg-white p-3 shadow-sm">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">✅ الحاضرون: {counts.حاضر}</span>
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-800">❌ الغائبون: {counts.غائب}</span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">⏰ المتأخرون: {counts.متأخر}</span>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">🔵 المعذورون: {counts.معذور}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">👥 الإجمالي: {players.length}</span>
      </div>

      {/* Player cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {players.map((p) => {
          const info = p.id != null ? statusByPlayer.get(p.id) : undefined;
          const status: AttendanceStatus = info?.status ?? "حاضر";
          const style = STATUS_STYLES[status];
          return (
            <button
              key={p.id}
              onClick={() => p.id != null && cycleStatus(p.id)}
              className={cn(
                "flex flex-col items-center rounded-xl border-2 p-4 text-center transition active:scale-95",
                style.card,
              )}
            >
              <span className="text-3xl font-black">#{p.jersey_number}</span>
              <span className="mt-1 text-sm font-bold leading-tight">{p.full_name}</span>
              <span className="text-xs opacity-80">{p.position}</span>
              <span className="mt-2 rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">
                {style.label}
              </span>
            </button>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}