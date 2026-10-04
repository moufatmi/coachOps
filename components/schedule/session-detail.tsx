"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db, type AttendanceStatus, type TrainingSession , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

const STATUS_CYCLE: AttendanceStatus[] = ["حاضر", "غائب", "متأخر", "معذور"];
const STATUS_STYLE: Record<AttendanceStatus, string> = {
  حاضر: "bg-emerald-100 text-emerald-800",
  غائب: "bg-red-100 text-red-800",
  متأخر: "bg-amber-100 text-amber-800",
  معذور: "bg-blue-100 text-blue-800",
};

interface Props {
  session: TrainingSession | null;
  onClose: () => void;
}

export default function SessionDetail({ session, onClose }: Props) {
  const { selectedTeamId } = useTeam();
  const ownerId = useOwnerId();

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [],
  );

  const rows = useLiveQuery(
    async () => (session?.id ? db.attendance.where("session_id").equals(session.id).toArray() : []),
    [session?.id],
    [],
  );

  if (!session) return null;

  const byPlayer = new Map(rows.map((r) => [r.player_id, r]));

  async function cycle(playerId: string) {
    const existing = byPlayer.get(playerId);
    const nextStatus = existing
      ? STATUS_CYCLE[(STATUS_CYCLE.indexOf(existing.status) + 1) % STATUS_CYCLE.length]
      : "حاضر";
    if (existing?.id != null) {
      await db.attendance.update(existing.id, { status: nextStatus });
    } else {
      await db.attendance.add({
        id: newId(),
        session_id: session!.id!,
        player_id: playerId,
        status: nextStatus,
        owner_id: ownerId,
      });
    }
  }

  const present = rows.filter((r) => r.status === "حاضر").length;
  const absent = rows.filter((r) => r.status === "غائب").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-bold">{session.date}{session.time ? ` · ${session.time}` : ""} — {session.type}</h4>
          <button onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500">اضغط على حالة اللاعب لتغييرها · حاضر {present} / غائب {absent}</p>
        <ul className="max-h-80 overflow-y-auto divide-y">
          {players.map((p) => {
            const row = byPlayer.get(p.id!);
            return (
              <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                <span>#{p.jersey_number} {p.full_name}</span>
                <button
                  onClick={() => cycle(p.id!)}
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold", row ? STATUS_STYLE[row.status] : "border text-slate-400")}
                >
                  {row ? row.status : "—"}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
