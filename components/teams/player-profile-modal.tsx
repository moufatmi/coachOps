"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle, Printer, X } from "lucide-react";
import { db, type Evaluation, type Player , newId } from "@/lib/offline/db";
import {
  getPlayerAttendanceHistory,
  ATTENDANCE_DOT,
  ATTENDANCE_STYLE,
  type PlayerAttendanceHistory,
} from "@/lib/offline/attendance";
import PlayerAvatar from "./player-avatar";
import { formatDate } from "@/lib/offline/finance";
import { cn } from "@/lib/utils";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";

interface Props {
  player: Player | null;
  onClose: () => void;
}

const STATUS_BADGE: Record<Player["status"], string> = {
  نشط: "bg-emerald-100 text-emerald-800",
  مصاب: "bg-amber-100 text-amber-800",
  غائب: "bg-red-100 text-red-800",
};

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span>{value}/5</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(value / 5) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Per-session attendance record. Answering "did he come last time, and how
 * often does he come?" needs the dated list, which the summary tiles above
 * cannot convey.
 */
function AttendanceHistory({
  history,
}: {
  history: PlayerAttendanceHistory | null;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!history) {
    return (
      <div className="mt-5">
        <h4 className="font-bold">سجل الحضور</h4>
        <p className="mt-2 text-sm text-slate-400">جارٍ التحميل…</p>
      </div>
    );
  }

  const { stats, entries } = history;

  if (entries.length === 0) {
    return (
      <div className="mt-5">
        <h4 className="font-bold">سجل الحضور</h4>
        <p className="mt-2 text-sm text-slate-400">
          لا توجد حصص مسجّلة لهذا اللاعب بعد.
        </p>
      </div>
    );
  }

  const shown = showAll ? entries : entries.slice(0, 8);

  return (
    <div className="mt-5">
      <h4 className="font-bold">سجل الحضور</h4>

      {/* At-a-glance */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            stats.rate >= 75
              ? "bg-emerald-100 text-emerald-800"
              : stats.rate >= 50
                ? "bg-amber-100 text-amber-800"
                : "bg-red-100 text-red-800",
          )}
        >
          النسبة: {stats.rate}% ({stats.present + stats.late}/{stats.total})
        </span>
        {stats.currentStreak > 0 && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
            🔥 {stats.currentStreak} حصة متتالية
          </span>
        )}
        {stats.longestStreak > stats.currentStreak && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
            أطول سلسلة: {stats.longestStreak}
          </span>
        )}
        {stats.excused > 0 && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
            بعذر: {stats.excused}
          </span>
        )}
      </div>

      {/* Last attended / last missed, the two questions a coach asks most */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {stats.lastAttended && (
          <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            آخر حضور: <b>{formatDate(stats.lastAttended.date)}</b> ·{" "}
            {stats.lastAttended.type}
          </p>
        )}
        {stats.lastMissed && (
          <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-900">
            آخر غياب: <b>{formatDate(stats.lastMissed.date)}</b> ·{" "}
            {stats.lastMissed.type}
          </p>
        )}
      </div>

      {/* Recent form dots */}
      {stats.recentForm.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-500">آخر {stats.recentForm.length} حصص:</span>
          <span className="flex gap-1">
            {stats.recentForm.map((s, i) => (
              <span
                key={i}
                title={s}
                className={cn("h-3 w-3 rounded-full", ATTENDANCE_DOT[s])}
              />
            ))}
          </span>
          <span className="text-xs text-slate-400">← الأحدث أولاً</span>
        </div>
      )}

      {/* Dated list */}
      <ul className="mt-3 divide-y rounded-lg border">
        {shown.map((e) => (
          <li key={e.sessionId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", ATTENDANCE_DOT[e.status])} />
              <span className="tabular-nums">{formatDate(e.date)}</span>
              <span className="truncate text-xs text-slate-500">{e.type}</span>
              {e.location && (
                <span className="hidden truncate text-xs text-slate-400 sm:inline">
                  · {e.location}
                </span>
              )}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                ATTENDANCE_STYLE[e.status],
              )}
            >
              {e.status}
            </span>
          </li>
        ))}
      </ul>

      {entries.length > 8 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-slate-500 hover:underline"
        >
          {showAll ? "إظهار آخر 8 حصص فقط" : `عرض كل الحصص (${entries.length})`}
        </button>
      )}
    </div>
  );
}

export default function PlayerProfileModal({ player, onClose }: Props) {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);

  const evaluations = useLiveQuery(
    async () => {
      if (!player?.id) return [] as Evaluation[];
      return db.evaluations.where("player_id").equals(player.id).toArray().then((rows) => rows.sort((a, b) => b.date.localeCompare(a.date)));
    },
    [player?.id],
    [] as Evaluation[],
  );

  // Resolved against sessions so each row carries its date -- the coach needs
  // to know *when*, not just how many.
  const history = useLiveQuery(
    () => (player?.id ? getPlayerAttendanceHistory(player.id) : null),
    [player?.id],
    null,
  );

  const cotisations = useLiveQuery(
    async () => (player?.id ? db.cotisations.where("player_id").equals(player.id).toArray() : []),
    [player?.id],
    [],
  );

  const attendanceStats = useMemo(() => {
    if (!history) return { present: 0, late: 0, absent: 0, total: 0 };
    const s = history.stats;
    return { present: s.present, late: s.late, absent: s.absent, total: s.total };
  }, [history]);

  const paymentStats = useMemo(() => {
    const paid = cotisations.reduce((s, c) => s + c.paid_amount, 0);
    const debt = cotisations.reduce((s, c) => s + Math.max(c.expected_amount - c.paid_amount, 0), 0);
    return { paid, debt };
  }, [cotisations]);

  const latest = evaluations[0];

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [technique, setTechnique] = useState(3);
  const [physique, setPhysique] = useState(3);
  const [tactique, setTactique] = useState(3);
  const [mental, setMental] = useState(3);
  const [notes, setNotes] = useState("");

  if (!player) return null;

  async function saveEvaluation(e: React.FormEvent) {
    e.preventDefault();
    if (!player?.id || !selectedTeamId) return;
    await db.evaluations.add({
      id: newId(),
      player_id: player.id,
      team_id: selectedTeamId,
      date,
      technique,
      physique,
      tactique,
      mental,
      notes,
      created_at: new Date().toISOString(),
      owner_id: ownerId,
    });
    setNotes("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:static print:p-0">
      <div className="absolute inset-0 bg-black/40 no-print" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-5 shadow-xl print:shadow-none print:max-h-none">
        {/* Screen layout */}
        <div className="no-print">
          <div className="flex items-start justify-between gap-3">
            <PlayerAvatar
              photo={player.photo_url}
              name={player.full_name}
              jerseyNumber={player.jersey_number}
              className="h-16 w-16 text-sm"
              ring="ring-1 ring-slate-200"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold">#{player.jersey_number} — {player.full_name}</h3>
              <p className="text-sm text-slate-500">{player.position} · {player.birth_date ? `تاريخ الميلاد: ${player.birth_date}` : "تاريخ الميلاد غير مسجل"}</p>
            </div>
            <button onClick={onClose} aria-label="Fermer"><X size={18} /></button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[player.status]}`}>{player.status}</span>
            <a href={waLink(player.parent_phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700">
              <MessageCircle size={14} /> التواصل مع ولي الأمر
            </a>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
              <Printer size={14} /> طباعة بطاقة اللاعب
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border p-2 text-center"><p className="text-lg font-bold">{attendanceStats.present}</p><p className="text-xs text-slate-500">حضور</p></div>
            <div className="rounded-lg border p-2 text-center"><p className="text-lg font-bold">{attendanceStats.late}</p><p className="text-xs text-slate-500">تأخير</p></div>
            <div className="rounded-lg border p-2 text-center"><p className="text-lg font-bold text-emerald-700">{paymentStats.paid}</p><p className="text-xs text-slate-500">مؤدى (درهم)</p></div>
            <div className="rounded-lg border p-2 text-center"><p className="text-lg font-bold text-red-700">{paymentStats.debt}</p><p className="text-xs text-slate-500">متأخرات</p></div>
          </div>

          {/* Attendance record, session by session */}
          <AttendanceHistory history={history} />

          <h4 className="mt-5 font-bold">التقييم التقني</h4>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Bar label="التقنيات (التحكم، التمرير، المراوغة، التسديد)" value={latest?.technique ?? 0} />
            <Bar label="اللياقة البدنية (السرعة، التحمل، القوة)" value={latest?.physique ?? 0} />
            <Bar label="التكتيك (التمركز، رؤية اللعب)" value={latest?.tactique ?? 0} />
            <Bar label="الانضباط والروح الجماعية (المواظبة، الروح الرياضية)" value={latest?.mental ?? 0} />
          </div>

          <form onSubmit={saveEvaluation} className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border p-3">
            <label className="text-xs font-medium">التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" /></label>
            {[
              ["التقنيات", technique, setTechnique],
              ["اللياقة", physique, setPhysique],
              ["التكتيك", tactique, setTactique],
              ["الانضباط", mental, setMental],
            ].map(([label, value, setter]) => (
              <label key={label as string} className="text-xs font-medium">
                {label as string}
                <select value={value as number} onChange={(e) => (setter as (n: number) => void)(Number(e.target.value))} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm">
                  {[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
            ))}
            <label className="col-span-2 sm:col-span-4 text-xs font-medium">
              ملاحظات المدرب
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات الحصة، إصابة، محاور التطور…" className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm" />
            </label>
            <button type="submit" className="col-span-2 sm:col-span-4 rounded-lg bg-emerald-600 py-2 text-sm text-white hover:bg-emerald-700">حفظ التقييم</button>
          </form>

          <h4 className="mt-5 font-bold">مذكرة المدرب</h4>
          {evaluations.filter((e) => e.notes).length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد ملاحظات بعد.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {evaluations.filter((e) => e.notes).map((e) => (
                <li key={e.id} className="rounded-lg border p-2 text-sm">
                  <p className="text-xs text-slate-500">{e.date} — التقنيات {e.technique}/5 · اللياقة {e.physique}/5 · التكتيك {e.tactique}/5 · الانضباط {e.mental}/5</p>
                  <p>{e.notes}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Printable sheet */}
        <div className="hidden print:block text-black">
          <h1 className="text-center text-2xl font-bold">بطاقة اللاعب — {team?.name}</h1>
          <p className="text-center">{player.full_name} · #{player.jersey_number} · {player.position} · {player.status}</p>
          <p className="text-center text-sm">ولي الأمر: {player.parent_phone} · تاريخ الميلاد: {player.birth_date ?? "—"}</p>
          <h2 className="mt-4 font-bold">ملخص الحضور والأداء المالي</h2>
          <p className="text-sm">الحضور: {attendanceStats.present} · التأخيرات: {attendanceStats.late} · الغيابات: {attendanceStats.absent} · المؤدى: {paymentStats.paid} درهم · المتأخرات: {paymentStats.debt} درهم</p>
          {history && history.entries.length > 0 && (
            <>
              <p className="mt-2 text-sm">
                نسبة الحضور: {history.stats.rate}% ({history.stats.present + history.stats.late}/
                {history.stats.total})
                {history.stats.currentStreak > 0 && ` · سلسلة حالية: ${history.stats.currentStreak}`}
              </p>
              <h3 className="mt-4 font-bold">سجل الحضور التفصيلي</h3>
              <table className="w-full border-collapse border text-sm">
                <thead>
                  <tr>
                    <th className="border p-1 text-right">التاريخ</th>
                    <th className="border p-1 text-right">النوع</th>
                    <th className="border p-1 text-right">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {history.entries.slice(0, 20).map((e) => (
                    <tr key={e.sessionId}>
                      <td className="border p-1">{formatDate(e.date)}</td>
                      <td className="border p-1">{e.type}</td>
                      <td className="border p-1">{e.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history.entries.length > 20 && (
                <p className="mt-1 text-xs">تُعرض أول 20 حصة من {history.entries.length}.</p>
              )}
            </>
          )}
          <h2 className="mt-4 font-bold">آخر تقييم ({latest?.date ?? "—"})</h2>
          <table className="w-full border-collapse border text-sm">
            <tbody>
              <tr><td className="border p-1">التقنيات</td><td className="border p-1">{latest?.technique ?? "—"}/5</td></tr>
              <tr><td className="border p-1">اللياقة البدنية</td><td className="border p-1">{latest?.physique ?? "—"}/5</td></tr>
              <tr><td className="border p-1">التكتيك</td><td className="border p-1">{latest?.tactique ?? "—"}/5</td></tr>
              <tr><td className="border p-1">الانضباط والروح الجماعية</td><td className="border p-1">{latest?.mental ?? "—"}/5</td></tr>
            </tbody>
          </table>
          <h2 className="mt-4 font-bold">آخر الملاحظات</h2>
          <ul className="list-disc pr-5 text-sm">
            {evaluations.filter((e) => e.notes).slice(0, 5).map((e) => (
              <li key={e.id}>{e.date}: {e.notes}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
