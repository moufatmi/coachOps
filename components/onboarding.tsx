"use client";

import { useState } from "react";
import { Building2, Users, Rocket, Sparkles, ArrowLeft } from "lucide-react";
import { db, type TeamCategory , newId } from "@/lib/offline/db";
import { usePyramid } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { addClub, suggestGroupName } from "@/lib/offline/hierarchy";
import { seedDatabase } from "@/lib/offline/seed";

const CATEGORY_SUGGESTIONS: TeamCategory[] = ["U8", "U10", "U12", "U13", "U15", "U17", "U19"];

/**
 * First-run setup.
 *
 * Previously a new account silently received a demo team with twelve invented
 * players, which is a bad first impression for a paying customer and risks
 * them building real data on top of fiction. Setup is now explicit, and the
 * demo option is opt-in and clearly labelled.
 */
export default function Onboarding() {
  const { clubs } = usePyramid();
  const ownerId = useOwnerId();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [clubName, setClubName] = useState("");
  const [clubCity, setClubCity] = useState("");
  const [groupName, setGroupName] = useState("");
  const [category, setCategory] = useState<TeamCategory>("U10");
  const [season, setSeason] = useState(currentSeason());
  const [busy, setBusy] = useState(false);

  async function createClubAndContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerId || !clubName.trim()) return;
    setBusy(true);
    try {
      await addClub(ownerId, clubName, clubCity);
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerId || !clubs[0]?.id || !category.trim()) return;
    setBusy(true);
    try {
      await db.teams.add({
        id: newId(),
        name: suggestGroupName(category, season),
        category: category.trim(),
        season,
        club_id: clubs[0].id,
        monthly_fee: null,
        created_at: new Date().toISOString(),
        owner_id: ownerId,
      });
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    if (!ownerId) return;
    setBusy(true);
    try {
      await seedDatabase(ownerId);
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-black">مرحباً بك في CoachOps ⚽</h1>
        <p className="mt-1 text-sm text-slate-500">
          {step === 0 && "لنبدأ بإضافة ناديك."}
          {step === 1 && "الآن أضف أول فئة عمرية."}
          {step === 2 && "أضف لاعبيك وابدأ."}
        </p>
      </header>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-10 rounded-full ${i <= step ? "bg-emerald-600" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {step === 0 && (
        <form onSubmit={createClubAndContinue} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium">
            اسم النادي
            <input
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="مثال: نادي الرجاء"
              className="mt-1 w-full rounded-lg border px-3 py-2"
              required
              autoFocus
            />
          </label>
          <label className="block text-sm font-medium">
            المدينة (اختياري)
            <input
              value={clubCity}
              onChange={(e) => setClubCity(e.target.value)}
              placeholder="مثال: الدار البيضاء"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Building2 size={17} /> متابعة
          </button>
        </form>
      )}

      {step === 1 && (
        <form onSubmit={createGroup} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium">
            الفئة العمرية
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="U10"
              className="mt-1 w-full rounded-lg border px-3 py-2"
              required
              autoFocus
            />
            <span className="mt-1 flex flex-wrap gap-1">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className="rounded-full border px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {c}
                </button>
              ))}
            </span>
          </label>
          <label className="block text-sm font-medium">
            الموسم
            <input
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="2026/2027"
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium">
            اسم مخصّص (اختياري)
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={suggestGroupName(category, season)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Users size={17} /> إنشاء الفئة
          </button>
          <button
            type="button"
            onClick={() => setStep(0)}
            className="flex w-full items-center justify-center gap-1 text-xs text-slate-500 hover:underline"
          >
            <ArrowLeft size={13} /> رجوع
          </button>
        </form>
      )}

      {step === 2 && (
        <div className="space-y-3 rounded-2xl border bg-white p-6 text-center shadow-sm">
          <Rocket size={28} className="mx-auto text-emerald-600" />
          <h2 className="font-bold">كل شيء جاهز</h2>
          <p className="text-sm text-slate-500">
            ابدأ بإضافة لاعبيك من صفحة «الفرق واللاعبون».
          </p>
          <a
            href="/teams"
            className="inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm text-white hover:bg-emerald-700"
          >
            إضافة اللاعبين
          </a>
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={loadDemo}
              disabled={busy}
              className="mx-auto flex items-center gap-1.5 text-xs text-slate-400 hover:underline disabled:opacity-50"
            >
              <Sparkles size={13} /> استكشف التطبيق ببيانات تجريبية
            </button>
            <p className="mt-1 text-[11px] text-slate-400">
              يضيف نادياً وفئة و12 لاعباً وهميين — للاستكشاف فقط.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** "2026/2027" for a date in the middle of the season, else the calendar year. */
function currentSeason(): string {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return `${y - 1}/${y}`;
}