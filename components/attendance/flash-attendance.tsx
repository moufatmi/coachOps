"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle } from "lucide-react";
import { db, type AttendanceStatus , newId } from "@/lib/offline/db";
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

export default function FlashAttendance() {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);
  const today = new Date().toISOString().slice(0, 10);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

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

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [],
  );

  const session = useLiveQuery(async () => {
    if (!selectedTeamId) return undefined;
    const sessions = await db.sessions.where("team_id").equals(selectedTeamId).toArray();
    return sessions.find((s) => s.date === today);
  }, [selectedTeamId, today]);

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
    const dateLabel = new Date().toLocaleDateString("ar", { day: "2-digit", month: "2-digit", year: "numeric" });
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
            حصة يوم {new Date().toLocaleDateString("ar")} — اضغط على اللاعب لتغيير حالته
          </p>
        </div>
        <button
          onClick={shareWhatsApp}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white font-medium hover:bg-green-700 transition"
        >
          <MessageCircle size={18} />
          مشاركة التقرير عبر الواتساب
        </button>
      </div>

      {/* No squad yet: explain before offering to create a session, so an empty
          roster is not mistaken for a broken page. */}
      {players.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center">
          <h3 className="font-bold">لا يوجد لاعبون في هذه الفئة بعد</h3>
          <p className="mt-1 text-sm text-slate-500">
            أضف اللاعبين من صفحة «الفرق واللاعبين» لتسجيل الحضور.
          </p>
          <a
            href="/teams"
            className="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
          >
            الذهاب إلى اللاعبين
          </a>
        </div>
      )}

      {/* No session for today: ask before writing anything to the schedule. */}
      {!session && players.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h3 className="font-bold">لا توجد حصة مسجّلة لهذا اليوم</h3>
          <p className="mt-1 text-sm">
            لتسجيل الحضور، أنشئ حصة اليوم (ستظهر أيضاً في الجدول). يمكنك تحديد الوقت والمكان
            لاحقاً من صفحة الجدول.
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
