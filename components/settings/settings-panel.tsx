"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Upload, Trash2, Database, Users, Plus, Building2, UserCircle, Pencil, Settings2 } from "lucide-react";
import { db, FALLBACK_MONTHLY_FEE, SUGGESTED_TEAM_CATEGORIES, type CoachProfile, type Team, type TeamCategory , newId } from "@/lib/offline/db";
import { exportAllData, importAllData, resetAllData, deleteTeamCascade } from "@/lib/offline/data";
import { useSync } from "@/components/sync-provider";
import { SyncIndicator } from "@/components/sync-indicator";
import { useAuth } from "@/components/auth-provider";
import { seedDatabase } from "@/lib/offline/seed";
import { usePyramid } from "@/components/pyramid-provider";
import { addClub, saveCoachProfile, deleteClub, suggestGroupName } from "@/lib/offline/hierarchy";
import { resetCloud, summarize } from "@/lib/supabase/sync";

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
  const { user, deleteAccount } = useAuth();
  const { profile, clubs, selectedClubId, selectClub } = usePyramid();
  const { syncNow, busy, error, lastSyncedAt, lastReport } = useSync();
  const [category, setCategory] = useState<TeamCategory>("U15");
  const [season, setSeason] = useState("2026/2027");
  const [fee, setFee] = useState("");
  const [msg, setMsg] = useState("");

  // Categories already in use by this coach, fed into the picker as suggestions.
  const categoryOptions = useMemo(
    () => buildCategoryOptions(groups.map((g) => g.category).filter(Boolean)),
    [groups],
  );

  const [clubName, setClubName] = useState("");
  const [clubCity, setClubCity] = useState("");

  async function removeAccount() {
    const typed = prompt(
      "لتأكيد الحذف النهائي، اكتب: حذف حسابي\n\nسيُحذف حسابك وكل بياناتك من السحابة ومن هذا الجهاز.",
    );
    if (typed?.trim() !== "حذف حسابي") return;
    try {
      await deleteAccount();
      setMsg("تم حذف الحساب.");
    } catch (e: unknown) {
      setMsg(`تعذّر حذف الحساب: ${e instanceof Error ? e.message : "خطأ غير معروف"}`);
    }
  }

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
    if (!category.trim()) return;
    // An age group always belongs to a club; fall back to the coach's first one.
    const clubId =
      selectedClubId ?? clubs[0]?.id ?? (await addClub(user!.id, "ناديي"));
    await db.teams.add({
      id: newId(),
      // The name is derived from category + season, so it can never drift out of
      // sync with the age band the coach picked.
      name: suggestGroupName(category, season),
      category: category.trim(),
      season,
      // Blank means "use the fallback", stored as null so the default can change
      // later without stranding the group on a stale number.
      monthly_fee: fee.trim() && Number.isFinite(Number(fee)) ? Number(fee) : null,
      club_id: clubId,
      created_at: new Date().toISOString(),
      owner_id: user?.id,
    });
    setCategory("U15");
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
    const target = clubId || null;
    await db.teams.update(team.id!, { club_id: target, updated_at: new Date().toISOString() });
  }

  /** Sets the default monthly subscription for an age group. */
  async function saveFee(team: Team, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      await db.teams.update(team.id!, {
        monthly_fee: null,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return;
    await db.teams.update(team.id!, {
      monthly_fee: value,
      updated_at: new Date().toISOString(),
    });
  }

  async function removeClub(id: string, clubName: string) {
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

  /**
   * Wipes both halves.
   *
   * Clearing Dexie on its own was useless: the app is local-first, so the very
   * next push re-uploaded everything that had just been discarded, which made it
   * look impossible to empty the database. The cloud rows have to go too.
   */
  async function doReset() {
    if (!confirm("سيتم حذف جميع البيانات نهائياً من هذا الجهاز ومن السحابة. هل أنت متأكد؟")) return;
    if (!navigator.onLine) {
      setMsg("يلزم الاتصال بالإنترنت لحذف البيانات من السحابة");
      return;
    }
    await resetAllData();
    const report = await resetCloud();
    if (report.errors.length > 0) {
      setMsg(`تم مسح هذا الجهاز، لكن تعذّر مسح السحابة: ${report.errors.join(" | ")}`);
      return;
    }
    setMsg("تم مسح جميع البيانات من هذا الجهاز والسحابة");
  }

  async function doSeed() {
    if (!user) return;
    await seedDatabase(user.id);
    setMsg("تمت إضافة البيانات التجريبية");
  }

  /**
   * One button, both directions.
   *
   * Separate push and pull buttons were removed: they invited the wrong one, and
   * push-only is what made a second device look empty even though the data was
   * sitting in Supabase. syncNow() pulls before it pushes, which is the only order
   * that converges.
   */
  async function doSync() {
    setMsg("جارٍ المزامنة مع السحابة…");
    await syncNow();
    // syncNow resolves after both halves have run; the report is kept on the
    // provider so a coach can see how many rows were deleted or merged rather
    // than an unconditional "done".
    setMsg(`${lastReport ? summarize(lastReport) : "تمت المزامنة مع السحابة ☁️"}`);
  }

  const playersPerTeam = useLiveQuery(async () => {
    const counts: Record<string, number> = {};
    for (const t of groups) if (t.id) counts[t.id] = await db.players.where("team_id").equals(t.id).count();
    return counts;
  }, [groups], {} as Record<string, number>);

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
              onChange={(e) => selectClub(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
          <label className="text-xs text-slate-500">
            الاشتراك الشهري (درهم)
            <input
              type="number"
              min="0"
              step="0.01"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder={String(FALLBACK_MONTHLY_FEE)}
              className="mt-1 w-28 rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          {/* Preview of the name that will be generated, so the derivation is
              visible before saving rather than surprising afterwards. */}
          <div className="basis-full text-xs text-slate-400">
            سيُنشأ باسم:{" "}
            <span className="font-medium text-slate-600">
              {suggestGroupName(category, season)}
            </span>
          </div>
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
                <label className="flex items-center gap-1 text-xs text-slate-500">
                  الاشتراك الشهري
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={t.monthly_fee ?? ""}
                    onBlur={(e) => void saveFee(t, e.target.value)}
                    placeholder={String(FALLBACK_MONTHLY_FEE)}
                    aria-label={`الاشتراك الشهري لـ ${t.name}`}
                    className="w-20 rounded border px-2 py-1 text-xs"
                  />
                </label>
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
        <p className="mt-1 text-sm text-slate-500">
          بياناتك تُرفع تلقائياً إلى حسابك، لكن ملف نسخة احتياطية مفيد إن أردت نقلها إلى جهاز آخر.
        </p>
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
          تتم المزامنة تلقائياً. عند فتح التطبيق، أو العودة إليه، أو الاتصال بالإنترنت، تتحدث بياناتك في الاتجاهين.
          كل صف مرتبط بحسابك ولا يراه أحد غيرك.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SyncIndicator />
          {user && (
            <span className="text-xs text-slate-500">
              الحساب: <span className="font-medium text-slate-700">{user.email}</span>
            </span>
          )}
          {lastSyncedAt && (
            <span className="text-xs text-slate-400">
              آخر مزامنة: {new Date(lastSyncedAt).toLocaleTimeString("ar")}
            </span>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-4">
          <button onClick={doSync} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "جارٍ المزامنة…" : "مزامنة الآن"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-5">
        <h3 className="flex items-center gap-2 font-bold">
          <UserCircle size={18} /> الخصوصية والحساب
        </h3>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <a href="/privacy" className="text-emerald-700 hover:underline">سياسة الخصوصية</a>
          <span className="text-slate-300">·</span>
          <a href="/terms" className="text-emerald-700 hover:underline">شروط الاستخدام</a>
        </div>

        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-semibold text-red-700">حذف الحساب نهائياً</p>
          <p className="mt-1 text-xs text-slate-500">
            سيُحذف حسابك وكل بياناتك من السحابة ومن هذا الجهاز، ولا يمكن التراجع.
          </p>
          <button
            onClick={() => void removeAccount()}
            disabled={busy}
            className="mt-2 rounded-lg border border-red-300 px-4 py-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            حذف حسابي
          </button>
        </div>
      </section>

      {/* Maintenance, not a coach workflow. Collapsed so it cannot be hit by
          accident -- "wipe everything" sitting next to "add a club" was a real
          misclick waiting to happen. Deleting the cloud account is the normal
          way out and lives above. */}
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-sm font-bold text-slate-600">
          <Settings2 size={16} /> أدوات متقدمة
        </summary>
        <div className="border-t px-5 py-4">
          <p className="text-sm text-slate-500">
            للاختبار والصيانة. لا تحتاج إليها في الاستخدام اليومي.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={doSeed} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
              تحميل بيانات تجريبية
            </button>
            <button onClick={doReset} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
              <Trash2 size={16} /> مسح كل البيانات
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
