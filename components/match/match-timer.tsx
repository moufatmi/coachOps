"use client";

import { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, Square, Coffee } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "firstHalf" | "halftime" | "secondHalf" | "finished";

function fmt(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function MatchTimer() {
  const [status, setStatus] = useState<Status>("idle");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [firstExtra, setFirstExtra] = useState(0);
  const [secondExtra, setSecondExtra] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const minute = Math.floor(elapsed / 60);
  const firstHalfLimit = 45 + firstExtra;
  const matchLimit = 90 + secondExtra;
  const overtimeFirstHalf = status === "firstHalf" && minute > firstHalfLimit;
  const overtimeMatch = status === "secondHalf" && minute > matchLimit;

  function matchClock() {
    if (status === "finished") return "النهاية";
    if (status === "idle") return "00:00";
    return fmt(elapsed);
  }

  function matchMinute() {
    if (status === "firstHalf") {
      return minute <= 45 ? `الدقيقة ${minute}` : `45+${minute - 45}`;
    }
    if (status === "secondHalf") {
      return minute <= 90 ? `الدقيقة ${minute}` : `90+${minute - 90}`;
    }
    if (status === "halftime") return "استراحة الشوطين";
    if (status === "finished") return "انتهت المباراة";
    return "لم تبدأ بعد";
  }

  const PHASE_LABEL: Record<Status, string> = {
    idle: "في انتظار انطلاق المباراة",
    firstHalf: "الشوط الأول",
    halftime: "الشوط الأول",
    secondHalf: "الشوط الثاني",
    finished: "المباراة",
  };

  function start() {
    setElapsed(0);
    setStatus("firstHalf");
    setRunning(true);
  }
  function pause() {
    setRunning(false);
  }
  function resume() {
    setRunning(true);
  }
  function endFirstHalf() {
    setRunning(false);
    setStatus("halftime");
  }
  function startSecondHalf() {
    setStatus("secondHalf");
    setRunning(true);
  }
  function finish() {
    setRunning(false);
    setStatus("finished");
  }
  function reset() {
    setRunning(false);
    setStatus("idle");
    setElapsed(0);
  }

  const playing = status === "firstHalf" || status === "secondHalf";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-slate-900 p-8 text-center text-white">
        <p className="text-sm text-slate-400">{PHASE_LABEL[status]} · {matchMinute()}</p>
        <p className={cn("mt-2 font-mono text-6xl font-black tabular-nums", running && "text-emerald-400")}>
          {matchClock()}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          نهاية الشوط الأول: 45+{firstExtra} دقيقة · نهاية المباراة: 90+{secondExtra} دقيقة
        </p>
        {(overtimeFirstHalf || overtimeMatch) && (
          <p className="mt-3 inline-block rounded-full bg-amber-500/20 px-4 py-1 text-sm font-bold text-amber-300">
            {overtimeFirstHalf
              ? `⏱ الوقت الإضافي للشوط الأول (+${minute - 45} دقيقة)`
              : `⏱ الوقت الإضافي للمباراة (+${minute - 90} دقيقة)`}
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {status === "idle" && (
          <button onClick={start} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-white hover:bg-emerald-700">
            <Play size={18} /> بداية المباراة
          </button>
        )}
        {playing && running && (
          <button onClick={pause} className="inline-flex items-center gap-2 rounded-lg border bg-white px-6 py-3 hover:bg-slate-50">
            <Pause size={18} /> إيقاف مؤقت
          </button>
        )}
        {status !== "halftime" && playing && !running && (
          <button onClick={resume} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-white hover:bg-emerald-700">
            <Play size={18} /> استئناف
          </button>
        )}
        {status === "firstHalf" && (
          <button onClick={endFirstHalf} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-white hover:bg-amber-600">
            <Coffee size={18} /> نهاية الشوط الأول
          </button>
        )}
        {status === "halftime" && (
          <button onClick={startSecondHalf} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-white hover:bg-emerald-700">
            <Play size={18} /> بداية الشوط الثاني
          </button>
        )}
        {(status === "secondHalf" || status === "firstHalf" || status === "halftime") && (
          <button onClick={finish} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-white hover:bg-red-700">
            <Square size={18} /> نهاية المباراة
          </button>
        )}
        <button onClick={reset} className="inline-flex items-center gap-2 rounded-lg border bg-white px-6 py-3 text-slate-700 hover:bg-slate-50">
          <RotateCcw size={18} /> تصفير
        </button>
      </div>

      <div className="mx-auto grid max-w-xl grid-cols-2 gap-4">
        <label className="rounded-xl border bg-white p-4 text-sm font-medium">
          وقت إضافي الشوط الأول
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => setFirstExtra(Math.max(0, firstExtra - 1))} className="h-9 w-9 rounded-lg border text-lg">−</button>
            <span className="text-xl font-bold">+{firstExtra}</span>
            <button onClick={() => setFirstExtra(firstExtra + 1)} className="h-9 w-9 rounded-lg border text-lg">+</button>
          </div>
        </label>
        <label className="rounded-xl border bg-white p-4 text-sm font-medium">
          وقت إضافي المباراة
          <div className="mt-2 flex items-center gap-3">
            <button onClick={() => setSecondExtra(Math.max(0, secondExtra - 1))} className="h-9 w-9 rounded-lg border text-lg">−</button>
            <span className="text-xl font-bold">+{secondExtra}</span>
            <button onClick={() => setSecondExtra(secondExtra + 1)} className="h-9 w-9 rounded-lg border text-lg">+</button>
          </div>
        </label>
      </div>

      <p className="text-center text-xs text-slate-400">
        نصيحة: ضع الهاتف/الـ iPad على الجانب بجانب اللاعبين — شاشة سوداء كبيرة التوقيت بالأبيض والأخضر.
      </p>
    </div>
  );
}
