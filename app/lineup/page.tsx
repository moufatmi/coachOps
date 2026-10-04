"use client";

import { GraduationCap, Trophy } from "lucide-react";
import TacticalBoard from "@/components/lineup/tactical-board";
import MatchTimer from "@/components/match/match-timer";
import { useTeam } from "@/components/pyramid-provider";

/**
 * Match day: pick the XI, run the clock, record the result.
 *
 * The old page carried its own "training mode / official match" toggle, which
 * only did one thing -- show the match timer. That is now the whole job of this
 * page, and it lives under the top-level match mode, so the toggle would have
 * been a second, contradictory way to express the same choice.
 */
export default function MatchCentrePage() {
  const { selectedTeamId } = useTeam();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Trophy size={22} /> مركز المباراة
        </h2>
        <p className="text-sm text-slate-500">
          اختر التشكيلة، شغّل المؤقت، ثم سجّل النتيجة. كل ذلك في مكان واحد يوم المباراة.
        </p>
      </div>

      <MatchTimer />
      {selectedTeamId != null ? (
        <TacticalBoard key={selectedTeamId} />
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
          <GraduationCap size={20} className="mx-auto mb-2" />
          اختر فئة عمرية من القائمة الجانبية لعرض الملعب.
        </p>
      )}
    </div>
  );
}