"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { db, type Lineup, type Player } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";

interface Props {
  lineup: Lineup | null;
  onClose: () => void;
}

export default function MatchResultEditor({ lineup, onClose }: Props) {
  // Remounting on `id` resets the draft state for each match, which is cheaper
  // and more predictable than syncing it back out of props in an effect.
  if (!lineup?.id) return null;
  return <ResultForm key={lineup.id} lineup={lineup} onClose={onClose} />;
}

function ResultForm({ lineup, onClose }: { lineup: Lineup; onClose: () => void }) {
  const { selectedTeamId } = useTeam();
  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [] as Player[],
  );

  const [goalsFor, setGoalsFor] = useState(lineup.goals_for ?? 0);
  const [goalsAgainst, setGoalsAgainst] = useState(lineup.goals_against ?? 0);
  const [scorerMap, setScorerMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const s of lineup.scorers ?? []) m[s.player_id] = s.goals;
    return m;
  });
  const [mvpId, setMvpId] = useState<string | null>(lineup.mvp_id ?? null);

  function bump(id: string, delta: number) {
    setScorerMap((prev) => {
      const next = { ...prev };
      next[id] = Math.max(0, (next[id] ?? 0) + delta);
      if (next[id] === 0) delete next[id];
      return next;
    });
  }

  async function save() {
    await db.lineups.update(lineup.id!, {
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      scorers: Object.entries(scorerMap).map(([pid, goals]) => ({ player_id: pid, goals })),
      mvp_id: mvpId,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-bold">نتيجة المباراة — ضد {lineup.opponent || "?"}</h4>
          <button onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </div>

        <div className="flex items-center justify-center gap-6">
          <div className="text-center">
            <p className="text-xs text-slate-500">لنا</p>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => setGoalsFor(Math.max(0, goalsFor - 1))} className="h-8 w-8 rounded-lg border">−</button>
              <span className="text-3xl font-black w-8">{goalsFor}</span>
              <button onClick={() => setGoalsFor(goalsFor + 1)} className="h-8 w-8 rounded-lg border">+</button>
            </div>
          </div>
          <span className="text-2xl font-bold text-slate-300">:</span>
          <div className="text-center">
            <p className="text-xs text-slate-500">لهم</p>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => setGoalsAgainst(Math.max(0, goalsAgainst - 1))} className="h-8 w-8 rounded-lg border">−</button>
              <span className="text-3xl font-black w-8">{goalsAgainst}</span>
              <button onClick={() => setGoalsAgainst(goalsAgainst + 1)} className="h-8 w-8 rounded-lg border">+</button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium">أفضل لاعب في المباراة ⭐
            <select value={mvpId ?? ""} onChange={(e) => setMvpId(e.target.value || null)} className="mt-1 w-full rounded-lg border px-3 py-2">
              <option value="">—</option>
              {players.map((p) => <option key={p.id} value={p.id}>#{p.jersey_number} {p.full_name}</option>)}
            </select>
          </label>
        </div>

        <div>
          <p className="text-sm font-bold mb-2">الهدافون</p>
          <ul className="max-h-48 overflow-y-auto divide-y">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>#{p.jersey_number} {p.full_name}</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => bump(p.id!, -1)} className="h-7 w-7 rounded-lg border">−</button>
                  <span className="w-4 text-center font-bold">{scorerMap[p.id!] ?? 0}</span>
                  <button onClick={() => bump(p.id!, 1)} className="h-7 w-7 rounded-lg border">+</button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <button onClick={save} className="w-full rounded-lg bg-emerald-600 py-2 text-white hover:bg-emerald-700">حفظ النتيجة</button>
      </div>
    </div>
  );
}
