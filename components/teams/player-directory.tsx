"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Edit2, Plus, Trash2, MessageCircle } from "lucide-react";
import { db, type Player, type PlayerPosition, type PlayerStatus , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { attendanceCountsFor } from "@/lib/offline/attendance";
import { stageDelete } from "@/lib/offline/sync-ledger";
import PlayerProfileModal from "./player-profile-modal";
import PlayerPhotoPicker from "./player-photo-picker";
import PlayerAvatar from "./player-avatar";

const POSITIONS: PlayerPosition[] = [
  "حارس مرمى",
  "ظهير أيمن",
  "قلب دفاع",
  "ظهير أيسر",
  "وسط دفاعي",
  "وسط مركزي",
  "صانع ألعاب",
  "جناح أيمن",
  "رأس حربة",
  "جناح أيسر",
];
const STATUSES: PlayerStatus[] = ["نشط", "مصاب", "غائب"];

const emptyForm = {
  full_name: "",
  jersey_number: "",
  position: "وسط مركزي",
  parent_phone: "",
  birth_date: "",
  status: "نشط" as PlayerStatus,
};

const STATUS_BADGE: Record<PlayerStatus, string> = {
  نشط: "bg-emerald-100 text-emerald-800",
  مصاب: "bg-amber-100 text-amber-800",
  غائب: "bg-red-100 text-red-800",
};

export default function PlayerDirectory() {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [] as Player[],
  );

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  /**
   * The photo is held outside the form object on purpose. It is a long base64
   * string, and spreading it through `setForm` would re-render and re-copy it on
   * every keystroke in the name field.
   */
  const [photo, setPhoto] = useState("");
  const [formError, setFormError] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  // Shared with the profile modal so the card and the detail view can never
  // disagree about a player's attendance rate.
  const attendanceRates = useLiveQuery(
    async () => {
      const ids = players.map((p) => p.id).filter((id): id is string => id != null);
      return attendanceCountsFor(ids);
    },
    [selectedTeamId, players],
    {} as Record<string, { present: number; total: number }>,
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        String(p.jersey_number).includes(q),
    );
  }, [players, search]);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setPhoto("");
    setFormError("");
    setAdding(true);
  }

  function openEdit(p: Player) {
    setEditing(p);
    setForm({
      full_name: p.full_name,
      jersey_number: String(p.jersey_number),
      position: p.position,
      parent_phone: p.parent_phone,
      birth_date: p.birth_date ?? "",
      status: p.status,
    });
    setPhoto(p.photo_url ?? "");
    setAdding(true);
  }

  async function saveForm(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!selectedTeamId) {
      setFormError("لا يوجد فريق محدد. أنشئ فريقاً أولاً من الإعدادات.");
      return;
    }
    const jersey = Number(form.jersey_number);
    if (!form.full_name.trim() || !Number.isFinite(jersey)) {
      setFormError("الاسم ورقم القميص مطلوبان.");
      return;
    }

    try {
      if (editing?.id != null) {
        await db.players.update(editing.id, {
          full_name: form.full_name,
          jersey_number: jersey,
          position: form.position,
          parent_phone: form.parent_phone,
          birth_date: form.birth_date,
          status: form.status,
          // Set on both paths: editing a player is also how a photo gets
          // attached, and skipping it here made "add a photo" a no-op.
          photo_url: photo,
        });
      } else {
        await db.players.add({
          id: newId(),
          team_id: selectedTeamId,
          full_name: form.full_name,
          jersey_number: jersey,
          position: form.position,
          parent_phone: form.parent_phone,
          birth_date: form.birth_date,
          status: form.status,
          photo_url: photo,
          owner_id: ownerId,
        });
      }
      setAdding(false);
      setEditing(null);
    } catch (err) {
      console.error("Save player failed:", err);
      setFormError(
        `تعذّر حفظ اللاعب: ${err instanceof Error ? err.message : "خطأ غير معروف"}`,
      );
    }
  }

  async function deletePlayer(p: Player) {
    if (p.id == null) return;
    if (!window.confirm(`حذف ${p.full_name} ؟`)) return;
    await db.players.delete(p.id);
    // Without a tombstone the row stays on the server and comes back on the next
    // pull. The server's `on delete cascade` clears attendance, cotisations and
    // evaluations for us once the player itself is really gone.
    await stageDelete("players", p.id);
  }

  return (
    <div className="space-y-4">
      {/*
        The whole squad list is screen-only. The profile modal is the printable
        artefact and it switches itself to `print:static`, but without this the
        grid underneath stayed in the print output, so printing one player card
        produced that card followed by every squad card on the page.
      */}
      <div className="space-y-4 no-print">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">الفرق واللاعبين</h2>
          <p className="text-sm text-slate-500">{team ? `${team.name} — ${team.category}` : ""}</p>
        </div>
        <button onClick={openAdd} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
          <Plus size={16} /> إضافة لاعب
        </button>
      </div>

      <input
        placeholder="ابحث بالاسم أو رقم القميص…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border px-3 py-2"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <div key={p.id} className="flex gap-3 rounded-xl border bg-white p-4 shadow-sm cursor-pointer hover:shadow transition" onClick={() => setSelectedPlayer(p)}>
            <PlayerAvatar
              photo={p.photo_url}
              name={p.full_name}
              jerseyNumber={p.jersey_number}
              className="h-14 w-14 text-sm"
              ring="ring-1 ring-slate-200"
            />
            <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-bold">#{p.jersey_number} {p.full_name}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[p.status]}`}>{p.status}</span>
            </div>
            <p className="text-sm text-slate-500">{p.position}{p.birth_date ? ` · تاريخ الميلاد: ${p.birth_date}` : ""}</p>
            {(() => {
              const r = attendanceRates[p.id!];
              if (!r || r.total === 0) return <p className="mt-1 text-xs text-slate-400">لا توجد سجلات حضور</p>;
              const rate = Math.round((r.present / r.total) * 100);
              return (
                <p className="mt-1 text-xs">
                  الحضور: <span className={rate >= 75 ? "text-emerald-700 font-bold" : rate >= 50 ? "text-amber-700 font-bold" : "text-red-700 font-bold"}>{rate}%</span>
                  <span className="text-slate-400"> ({r.present}/{r.total})</span>
                </p>
              );
            })()}
            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <a href={`https://wa.me/${p.parent_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2 py-1 text-xs text-white">
                <MessageCircle size={12} /> ولي الأمر
              </a>
              <button onClick={() => openEdit(p)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs">
                <Edit2 size={12} /> تعديل
              </button>
              <button onClick={() => deletePlayer(p)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs text-red-600">
                <Trash2 size={12} /> حذف
              </button>
            </div>
            </div>
          </div>
        ))}
      </div>
      </div>

      {/* Add/Edit modal */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveForm} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <h4 className="font-bold">{editing ? "تعديل اللاعب" : "إضافة لاعب"}</h4>
            <PlayerPhotoPicker
              photo={photo}
              onChange={setPhoto}
              fallback={form.jersey_number ? `#${form.jersey_number}` : "؟"}
              label={form.full_name || "اللاعب"}
            />
            <label className="block text-sm font-medium">الاسم الكامل<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" required /></label>
            <label className="block text-sm font-medium">رقم القميص<input type="number" value={form.jersey_number} onChange={(e) => setForm({ ...form, jersey_number: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" required /></label>
            <label className="block text-sm font-medium">المركز
              <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value as PlayerPosition })} className="mt-1 w-full rounded-lg border px-3 py-2">
                {POSITIONS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">هاتف ولي الأمر<input value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="block text-sm font-medium">تاريخ الميلاد<input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="block text-sm font-medium">الحالة
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PlayerStatus })} className="mt-1 w-full rounded-lg border px-3 py-2">
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            {formError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {formError}
              </p>
            )}
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-emerald-600 py-2 text-white hover:bg-emerald-700">حفظ</button>
              <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-lg border py-2">إلغاء</button>
            </div>
          </form>
        </div>
      )}

      <PlayerProfileModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
    </div>
  );
}
