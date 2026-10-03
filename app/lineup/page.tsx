"use client";

import { useState } from "react";
import { GraduationCap, Trophy } from "lucide-react";
import TacticalBoard from "@/components/lineup/tactical-board";
import MatchTimer from "@/components/match/match-timer";
import { useTeam } from "@/components/pyramid-provider";
import { cn } from "@/lib/utils";

export default function LineupPage() {
  const [mode, setMode] = useState<"training" | "match">("training");
  const { selectedTeamId } = useTeam();

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("training")}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium",
            mode === "training" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
          )}
        >
          <GraduationCap size={16} /> وضع التدريب
        </button>
        <button
          onClick={() => setMode("match")}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium",
            mode === "match" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
          )}
        >
          <Trophy size={16} /> وضع المباراة الرسمية
        </button>
      </div>

      {mode === "match" && <MatchTimer />}
      {selectedTeamId != null && <TacticalBoard key={selectedTeamId} />}
    </div>
  );
}
