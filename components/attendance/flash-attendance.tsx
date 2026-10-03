"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle } from "lucide-react";
import { db, type AttendanceStatus, type TrainingSession } from "@/lib/offline/db";
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

  // Ensure today's session + default attendance rows exist
  useEffect(() => {
    if (!selectedTeamId) return;
    (async () => {
      const sessions = await db.sessions.where("team_id").equals(selectedTeamId).toArray();
      let session: TrainingSession | undefined = sessions.find((s) => s.date === today);
      if (!session) {
        const id = (await db.sessions.add({
          team_id: selectedTeamId,
          date: today,
          type: "تدريب",
          location: "",
          notes: "",
          owner_id: ownerId,
        })) as number;
        session = { id, team_id: selectedTeamId, date: today, type: "تدريب", location: "", notes: "" };
      }
      const players = await db.players.where("team_id").equals(selectedTeamId).toArray();
      for (const p of players) {
        if (p.id == null || session.id == null) continue;
        const existing = await db.attendance
          .where("session_id")
          .equals(session.id)
          .and((a) => a.player_id === p.id)
          .first();
        if (!existing) {
          await db.attendance.add({
            session_id: session.id,
            player_id: p.id,
            status: "حاضر",
            owner_id: ownerId,
          });
        }
      }
    })();
  }, [selectedTeamId, today, ownerId]);

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

  const records = useLiveQuery(
    () => (session?.id ? db.attendance.where("session_id").equals(session.id).toArray() : []),
    [session?.id],
    [],
  );

  const statusByPlayer = new Map(records.map((r) => [r.player_id, { status: r.status, recordId: r.id }]));

  const counts = { حاضر: 0, غائب: 0, متأخر: 0, معذور: 0 } as Record<AttendanceStatus, number>;
  for (const r of records) counts[r.status]++;

  async function cycleStatus(playerId: number) {
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
    </div>
  );
}
