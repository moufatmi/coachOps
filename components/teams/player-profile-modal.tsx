"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCircle, Printer, X } from "lucide-react";
import { db, type Evaluation, type Player } from "@/lib/offline/db";
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

  const attendance = useLiveQuery(
    async () => (player?.id ? db.attendance.where("player_id").equals(player.id).toArray() : []),
    [player?.id],
    [],
  );

  const cotisations = useLiveQuery(
    async () => (player?.id ? db.cotisations.where("player_id").equals(player.id).toArray() : []),
    [player?.id],
    [],
  );

  const attendanceStats = useMemo(() => {
    const present = attendance.filter((a) => a.status === "حاضر").length;
    const late = attendance.filter((a) => a.status === "متأخر").length;
    const absent = attendance.filter((a) => a.status === "غائب").length;
    return { present, late, absent, total: attendance.length };
  }, [attendance]);

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
          <div className="flex items-start justify-between">
            <div>
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
