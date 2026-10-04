"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Pencil, CalendarDays } from "lucide-react";
import { db, type TrainingSession, type SessionType , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import SessionDetail from "./session-detail";

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
    await db.attendance.where("session_id").equals(id).delete();
    await db.sessions.delete(id);
  }

  function edit(s: TrainingSession) {
    setEditing(s);
    setForm({ date: s.date, time: s.time ?? "", type: s.type, location: s.location, notes: s.notes ?? "" });
  }

  const [selectedSession, setSelectedSession] = useState<TrainingSession | null>(null);
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
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <button className="text-right" onClick={() => setSelectedSession(s)}>
                <p className="font-medium text-sm">
                  <CalendarDays size={14} className="inline -mt-0.5 me-1 text-slate-400" />
                  {s.date}{s.time ? ` · ${s.time}` : ""} — {s.type}
                  {s.date === today && <span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">اليوم</span>}
                </p>
                <p className="text-xs text-slate-500">{s.location || "—"}{s.notes ? ` · ${s.notes}` : ""}</p>
              </button>
              <span className="flex gap-2">
                <button onClick={() => edit(s)} className="text-slate-500" aria-label="تعديل"><Pencil size={16} /></button>
                <button onClick={() => remove(s.id)} className="text-red-500" aria-label="حذف"><Trash2 size={16} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  );
}
