"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Upload, Trash2, Database, Users, Plus, Building2, UserCircle, Pencil } from "lucide-react";
import { db, SUGGESTED_TEAM_CATEGORIES, type CoachProfile, type Team, type TeamCategory } from "@/lib/offline/db";
import { exportAllData, importAllData, resetAllData, deleteTeamCascade } from "@/lib/offline/data";
import { useSync } from "@/components/sync-provider";
import { SyncIndicator } from "@/components/sync-indicator";
import { summarize } from "@/lib/supabase/sync";
import { useAuth } from "@/components/auth-provider";
import { seedDatabase } from "@/lib/offline/seed";
import { usePyramid } from "@/components/pyramid-provider";
import { addClub, saveCoachProfile, deleteClub } from "@/lib/offline/hierarchy";

/**
 * Suggested age bands: the built-in defaults plus every category already used
 * by this coach's age groups, so the list reflects how the coach actually
 * labels things rather than a fixed set.
 */
function buildCategoryOptions(used: string[]): string[] {
  return [...new Set([...SUGGESTED_TEAM_CATEGORIES, ...used.filter(Boolean)])].sort(
    (a, b) => a.localeCompare(b, "en", { numeric: true }),
  );
}

/**
 * Seeded from the profile prop and remounted via `key` when it changes, so the
 * draft never has to be pushed back out of props in an effect.
 */
function CoachProfileForm({
  profile,
  onSaved,
}: {
  profile: CoachProfile;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await saveCoachProfile(profile.id, { full_name: fullName, phone });
    onSaved();
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-2 sm:grid-cols-3">
      <input
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="اسم المدرب"
        className="rounded-lg border px-3 py-2 text-sm"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="الهاتف"
        dir="ltr"
        className="rounded-lg border px-3 py-2 text-sm"
      />
      <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800">
        حفظ
      </button>
    </form>
  );
}

export default function SettingsPanel() {
  // `useTeam()` is scoped to the selected club; management screens need every
  // age group so a coach can move one between clubs.
  const { groups } = usePyramid();
  const { user } = useAuth();
  const { profile, clubs, selectedClubId, selectClub } = usePyramid();
  const { pushNow, pullNow, busy, state, error, lastSyncedAt } = useSync();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<TeamCategory>("U15");
  const [season, setSeason] = useState("2026/2027");
  const [msg, setMsg] = useState("");

  // Categories already in use by this coach, fed into the picker as suggestions.
  const categoryOptions = useMemo(
    () => buildCategoryOptions(groups.map((g) => g.category).filter(Boolean)),
    [groups],
  );

  const [clubName, setClubName] = useState("");
  const [clubCity, setClubCity] = useState("");

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !clubName.trim()) return;
    const id = await addClub(user.id, clubName, clubCity);
    setClubName("");
    setClubCity("");
    selectClub(id);
    setMsg("تمت إضافة النادي");
  }

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !category.trim()) return;
    // An age group always belongs to a club; fall back to the coach's first one.
    const clubId =
      selectedClubId ?? clubs[0]?.id ?? (await addClub(user!.id, "ناديي"));
    await db.teams.add({
      name: name.trim(),
      category: category.trim(),
      season,
      club_id: clubId,
      created_at: new Date().toISOString(),
      owner_id: user?.id,
    });
    setName("");
    setMsg("تمت إضافة الفئة");
  }

  async function removeTeam(team: Team) {
    if (!confirm(`حذف الفئة "${team.name}" وجميع بياناتها؟`)) return;
    await deleteTeamCascade(team.id!);
    setMsg("تم حذف الفئة");
  }

  async function renameTeam(team: Team) {
    const n = prompt("اسم الفئة الجديدة:", team.name);
    if (n && n.trim()) await db.teams.update(team.id!, { name: n.trim() });
  }

  async function moveTeam(team: Team, clubId: string) {
    const target = clubId ? Number(clubId) : null;
    await db.teams.update(team.id!, { club_id: target, updated_at: new Date().toISOString() });
  }

  async function removeClub(id: number, clubName: string) {
    const affected = (await db.teams.where("club_id").equals(id).count());
    const extra = affected > 0 ? `\n\n${affected} فئة ستبقى محفوظة وتنتقل إلى نادي افتراضي.` : "";
    if (!confirm(`حذف النادي "${clubName}"؟${extra}`)) return;
    await deleteClub(id);
    setMsg("تم حذف النادي");
  }

  async function doExport() {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coachops-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("تم تصدير النسخة الاحتياطية");
  }

  async function doImport(file: File) {
    try {
      const text = await file.text();
      await importAllData(JSON.parse(text));
      setMsg("تم استيراد البيانات بنجاح");
    } catch {
      setMsg("فشل الاستيراد: ملف غير صالح");
    }
  }

  async function doReset() {
    if (!confirm("سيتم حذف جميع البيانات نهائياً. هل أنت متأكد؟")) return;
    await resetAllData();
    setMsg("تم مسح جميع البيانات");
  }

  async function doSeed() {
    if (!user) return;
    await seedDatabase(user.id);
    setMsg("تمت إضافة البيانات التجريبية");
  }

  // Push/pull go through SyncProvider so manual and automatic syncs share one
  // path (and the header indicator reflects the outcome).
  async function doPush() {
    const report = await pushNow();
    setMsg(report ? summarize(report) : "تعذّر إتمام الرفع (طلب متزامن أو الشبكة غير متاحة).");
  }

  async function doPull() {
    if (!confirm("سيتم تحديث البيانات المحلية من السحابة (لن تُحذف تعديلاتك الأحدث). هل أنت متأكد؟")) return;
    const report = await pullNow();
    setMsg(report ? summarize(report) : "تعذّر إتمام الجلب (طلب متزامن أو الشبكة غير متاحة).");
  }

  const playersPerTeam = useLiveQuery(async () => {
    const counts: Record<number, number> = {};
    for (const t of groups) if (t.id) counts[t.id] = await db.players.where("team_id").equals(t.id).count();
    return counts;
  }, [groups], {} as Record<number, number>);

  return (
    <div className="space-y-6 max-w-3xl">
      {msg && (
        <div
          className={
            "rounded-lg border px-4 py-2 text-sm " +
            (msg.includes("أخطاء") || msg.startsWith("فشل")
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800")
          }
        >
          {msg}
        </div>
      )}

      <section className="rounded-xl border bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <UserCircle size={18} /> ملف المدرب
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          قمة الهرم: حسابك وكل ما تحته (الأندية ← الفئات ← اللاعبون).
        </p>
        {profile ? (
          <CoachProfileForm key={profile.id} profile={profile} onSaved={() => setMsg("تم حفظ ملف المدرب")} />
        ) : (
          <p className="mt-4 text-sm text-slate-400">جارٍ تجهيز ملف المدرب…</p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <Building2 size={18} /> الأندية
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          المدرب قد يدرّب أكثر من نادي، ولكل نادي عدة فئات عمرية.
        </p>
        <form onSubmit={createClub} className="mt-4 flex flex-wrap gap-2">
          <input
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
            placeholder="اسم النادي"
            className="min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <input
            value={clubCity}
            onChange={(e) => setClubCity(e.target.value)}
            placeholder="المدينة"
            className="min-w-32 flex-1 rounded-lg border px-3 py-2 text-sm"
          />
          <button className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
            <Plus size={16} /> نادي
          </button>
        </form>
        <ul className="mt-4 divide-y">
          {clubs.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {c.name}
                {c.city && <span className="text-slate-400"> — {c.city}</span>}
              </span>
              <span className="flex gap-3">
                <button
                  onClick={() => selectClub(c.id)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  تحديد
                </button>
                <button
                  onClick={() => void removeClub(c.id!, c.name)}
                  className="text-xs text-red-600 hover:underline"
                >
                  حذف
                </button>
              </span>
            </li>
          ))}
          {clubs.length === 0 && <li className="py-2 text-sm text-slate-400">لا توجد أندية بعد</li>}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <Users size={18} /> الفئات العمرية
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          كل فئة تنتمي إلى نادٍ. الفئة المختارة هي التي تعمل عليها بقية الصفحات.
        </p>
        <form onSubmit={addTeam} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex-1 basis-40 text-xs text-slate-500">
            النادي
            <select
              value={selectedClubId ?? ""}
              onChange={(e) => selectClub(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 basis-40 text-xs text-slate-500">
            اسم الفئة
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: فئة U15"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            الفئة العمرية
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="U15"
              list="team-category-options"
              className="mt-1 w-28 rounded-lg border px-3 py-2 text-sm"
            />
            {/* Suggestions only: the field accepts any value, so academies are
                not restricted to a fixed set of age bands. */}
            <datalist id="team-category-options">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-slate-500">
            الموسم
            <input
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="mt-1 w-28 rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <button className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
            <Plus size={16} /> إضافة
          </button>
        </form>

        <ul className="mt-4 divide-y">
          {groups.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                {t.name}{" "}
                <span className="text-slate-400">
                  ({t.category} — {t.season}) · {playersPerTeam[t.id!] ?? 0} لاعب
                </span>
              </span>
              <span className="flex items-center gap-2">
                <select
                  value={t.club_id ?? ""}
                  onChange={(e) => void moveTeam(t, e.target.value)}
                  className="rounded border px-2 py-1 text-xs"
                  aria-label="نقل الفئة إلى نادي آخر"
                >
                  <option value="">بلا نادي</option>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => renameTeam(t)}
                  className="text-xs text-slate-500 hover:underline"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => removeTeam(t)}
                  className="text-xs text-red-600 hover:underline"
                >
                  حذف
                </button>
              </span>
            </li>
          ))}
          {groups.length === 0 && <li className="py-2 text-sm text-slate-400">لا توجد فئات بعد</li>}
        </ul>
      </section>

      <section className="rounded-xl bg-white border p-5">
        <h3 className="flex items-center gap-2 font-bold"><Database size={18} /> النسخ الاحتياطي</h3>
        <p className="mt-1 text-sm text-slate-500">احفظ بياناتك بشكل دوري حتى لا تضيع عند تغيير الجهاز أو المتصفح.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={doExport} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50"><Download size={16} /> تصدير نسخة</button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50">
            <Upload size={16} /> استيراد نسخة
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </label>
        </div>
      </section>

      <section className="rounded-xl bg-white border p-5">
        <h3 className="flex items-center gap-2 font-bold"><Database size={18} /> المزامنة مع السحابة</h3>
        <p className="mt-1 text-sm text-slate-500">
          المزامنة تلقائية: أي تعديل يُرفع بعد 10 ثوانٍ. يمكنك أيضاً الرفع أو الجلب يدوياً.
          تعتمد على الأحدث تعديلاً لكل سجل، وكل صف مرتبط بحسابك ولا يراه أحد غيرك.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SyncIndicator />
          {user && (
            <span className="text-xs text-slate-500">
              الحساب: <span className="font-medium text-slate-700">{user.email}</span>
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={doPush} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy && state === "syncing" ? "جارٍ الرفع…" : "رفع إلى السحابة"}
          </button>
          <button onClick={doPull} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            {busy && state === "syncing" ? "جارٍ الجلب…" : "جلب من السحابة"}
          </button>
          {lastSyncedAt && (
            <span className="self-center text-xs text-slate-400">
              آخر مزامنة: {new Date(lastSyncedAt).toLocaleTimeString("ar")}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white border border-red-200 p-5">
        <h3 className="flex items-center gap-2 font-bold text-red-700"><Trash2 size={18} /> إعادة الضبط</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={doSeed} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">تحميل بيانات تجريبية</button>
          <button onClick={doReset} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">مسح كل البيانات</button>
        </div>
      </section>
    </div>
  );
}
