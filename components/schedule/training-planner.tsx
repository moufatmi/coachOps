"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { Plus, Trash2, Pencil, CalendarDays } from "lucide-react";
import { db, type Attendance, type TrainingSession, type SessionType , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { stageDelete, stageDeleteMany } from "@/lib/offline/sync-ledger";

const TYPES: SessionType[] = ["تدريب", "مباراة", "لياقة"];
const emptyForm = { date: new Date().toISOString().slice(0, 10), time: "", type: "تدريب" as SessionType, location: "", notes: "" };

export default function TrainingPlanner() {
  const { selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const sessions = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as TrainingSession[];
      return db.sessions.where("team_id").equals(selectedTeamId).toArray().then((rows) => rows.sort((a, b) => b.date.localeCompare(a.date)));
    },
    [selectedTeamId],
    [] as TrainingSession[],
  );

  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<TrainingSession | null>(null);

  /**
   * Head count per session, shown read-only on each row.
   *
   * Attendance itself is marked on /attendance, which is the only editor. This
   * badge exists so the schedule can answer "who turned up?" at a glance without
   * becoming a second place to change statuses -- that duplication is exactly
   * what this replaced.
   */
  const presentBySession = useLiveQuery(
    async () => {
      if (!selectedTeamId) return new Map<string, number>();
      const mine = new Set(
        (await db.sessions.where("team_id").equals(selectedTeamId).toArray()).map((s) => s.id!),
      );
      const counts = new Map<string, number>();
      const rows = (await db.attendance.toArray()) as Attendance[];
      for (const r of rows) {
        if (r.status !== "حاضر" || !mine.has(r.session_id)) continue;
        counts.set(r.session_id, (counts.get(r.session_id) ?? 0) + 1);
      }
      return counts;
    },
    [selectedTeamId],
    new Map<string, number>(),
  );

  const squadSize = useLiveQuery(
    () =>
      selectedTeamId
        ? db.players.where("team_id").equals(selectedTeamId).count()
        : Promise.resolve(0),
    [selectedTeamId],
    0,
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTeamId) return;
    if (editing?.id != null) {
      await db.sessions.update(editing.id, { ...form });
      setEditing(null);
    } else {
      await db.sessions.add({ id: newId(), team_id: selectedTeamId, ...form, owner_id: ownerId });
    }
    setForm(emptyForm);
  }

  async function remove(id?: string) {
    if (id == null) return;
    if (!confirm("حذف الحصة؟")) return;
    const marked = await db.attendance.where("session_id").equals(id).toArray();
    await db.attendance.where("session_id").equals(id).delete();
    await db.sessions.delete(id);
    await stageDeleteMany(
      "attendance",
      marked.map((a) => a.id),
    );
    await stageDelete("sessions", id);
  }

  function edit(s: TrainingSession) {
    setEditing(s);
    setForm({ date: s.date, time: s.time ?? "", type: s.type, location: s.location, notes: s.notes ?? "" });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">الجدول</h2>

      <form onSubmit={save} className="rounded-xl border bg-white p-4 space-y-3">
        <h3 className="font-bold">{editing ? "تعديل الحصة" : "إضافة حصة"}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="text-xs font-medium">التاريخ
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" required />
          </label>
          <label className="text-xs font-medium">الوقت
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="text-xs font-medium">النوع
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SessionType })} className="mt-1 w-full rounded-lg border px-3 py-2">
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium">المكان
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="الملعب البلدي" className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
        </div>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="ملاحظات (اختياري)" className="w-full rounded-lg border px-3 py-2" />
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
            <Plus size={16} /> {editing ? "حفظ التعديل" : "إضافة"}
          </button>
          {editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); }} className="rounded-lg border px-4 py-2">إلغاء</button>}
        </div>
      </form>

      {sessions.length === 0 ? (
        <p className="text-sm text-slate-500">لا توجد حصص بعد.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {sessions.map((s) => {
            const present = presentBySession.get(s.id!) ?? 0;
            return (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-right">
                <p className="font-medium text-sm">
                  <CalendarDays size={14} className="inline -mt-0.5 me-1 text-slate-400" />
                  {s.date}{s.time ? ` · ${s.time}` : ""} — {s.type}
                  {s.date === today && <span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">اليوم</span>}
                </p>
                <p className="text-xs text-slate-500">{s.location || "—"}{s.notes ? ` · ${s.notes}` : ""}</p>
              </div>
              <span className="flex items-center gap-2">
                {/* Read-only head count; tapping it opens the attendance editor
                    for that specific session. */}
                <Link
                  href={`/attendance?session=${s.id}`}
                  className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  title="تسجيل الحضور لهذه الحصة"
                >
                  ✓ {present}/{squadSize}
                </Link>
                <button onClick={() => edit(s)} className="text-slate-500" aria-label="تعديل"><Pencil size={16} /></button>
                <button onClick={() => remove(s.id)} className="text-red-500" aria-label="حذف"><Trash2 size={16} /></button>
              </span>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
