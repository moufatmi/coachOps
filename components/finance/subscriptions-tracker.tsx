"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Receipt, AlertTriangle, Plus, X, Search, ChevronRight, ChevronLeft, Users } from "lucide-react";
import {
  db,
  type Cotisation,
  type CotisationStatus,
  type PaymentMethod,
  type Player,
} from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import {
  filterSubscriptions,
  formatAmount,
  formatMonth,
  money,
  shiftMonth,
  STATUS_BADGE,
  STATUS_LABEL,
  statusFromAmounts,
  subscriptionTotals,
  type SubscriptionRow,
} from "@/lib/offline/finance";

const DEFAULT_FEE = 200;

const STATUS_FILTERS: Array<{ value: CotisationStatus | "all"; label: string }> = [
  { value: "all", label: "الكل" },
  { value: "paid", label: "مؤدى" },
  { value: "partial", label: "جزئي" },
  { value: "unpaid", label: "غير مؤدى" },
];

function waLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export default function SubscriptionsTracker({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (m: string) => void;
}) {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CotisationStatus | "all">("all");

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [] as Player[],
  );

  const cotisations = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as Cotisation[];
      const all = await db.cotisations.where("team_id").equals(selectedTeamId).toArray();
      return all.filter((c) => c.month === month);
    },
    [selectedTeamId, month],
    [] as Cotisation[],
  );

  // Ensure a cotisation row exists for every player for the selected month
  useEffect(() => {
    if (!selectedTeamId || players.length === 0) return;
    (async () => {
      for (const p of players) {
        if (p.id == null) continue;
        const existing = await db.cotisations
          .where("player_id")
          .equals(p.id)
          .and((c) => c.month === month && c.team_id === selectedTeamId)
          .first();
        if (!existing) {
          await db.cotisations.add({
            team_id: selectedTeamId,
            player_id: p.id,
            month,
            season: team?.season ?? "2026/2027",
            expected_amount: DEFAULT_FEE,
            paid_amount: 0,
            status: "unpaid",
            created_at: new Date().toISOString(),
            owner_id: ownerId,
          });
        }
      }
    })();
  }, [players, month, selectedTeamId, team?.season, ownerId]);

  const rows = useMemo<SubscriptionRow[]>(() => {
    const byPlayer = new Map<number, Cotisation>();
    for (const c of cotisations) byPlayer.set(c.player_id, c);
    return players
      .filter((p) => p.id != null)
      .map((p) => ({ player: p, cot: byPlayer.get(p.id!) }))
      .filter((r): r is SubscriptionRow => Boolean(r.cot))
      .map((r) => ({
        ...r,
        due: Math.max(r.cot.expected_amount - r.cot.paid_amount, 0),
      }));
  }, [players, cotisations]);

  const totals = useMemo(() => subscriptionTotals(rows.map((r) => r.cot)), [rows]);
  const visible = useMemo(() => filterSubscriptions(rows, query, status), [rows, query, status]);

  // Payment modal state
  const [paying, setPaying] = useState<{ player: Player; cot: Cotisation } | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("نقدي");
  const [receipt, setReceipt] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payError, setPayError] = useState("");

  function openPayment(player: Player, cot: Cotisation) {
    setPaying({ player, cot });
    setAmount(String(Math.max(cot.expected_amount - cot.paid_amount, 0) || DEFAULT_FEE));
    setMethod("نقدي");
    setReceipt("");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayError("");
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setPayError("أدخل مبلغاً أكبر من صفر.");
      return;
    }
    const newPaid = paying.cot.paid_amount + value;
    await db.cotisations.update(paying.cot.id!, {
      paid_amount: newPaid,
      status: statusFromAmounts(newPaid, paying.cot.expected_amount),
      method,
      receipt_number: receipt.trim(),
      last_payment_date: payDate,
      updated_at: new Date().toISOString(),
    });
    setPaying(null);
  }

  function sendReceipt(player: Player, cot: Cotisation) {
    const msg = [
      `*إيصال أداء الاشتراك*`,
      `اللاعب: ${player.full_name}`,
      `النادي: ${team?.name ?? ""}`,
      `الشهر: ${formatMonth(month)}`,
      `المؤدى: ${money(cot.paid_amount)}`,
      `المتبقي: ${money(Math.max(cot.expected_amount - cot.paid_amount, 0))}`,
      `الطريقة: ${cot.method ?? "-"}`,
      `رقم الإيصال: ${cot.receipt_number || "-"}`,
      `التاريخ: ${cot.last_payment_date ?? "-"}`,
      `شكراً لكم ⚽`,
    ].join("\n");
    window.open(waLink(player.parent_phone, msg), "_blank");
  }

  function sendReminder(player: Player, cot: Cotisation) {
    const due = Math.max(cot.expected_amount - cot.paid_amount, 0);
    const msg = [
      `*تذكير بالاشتراك الشهري*`,
      `السلام عليكم ${player.full_name}،`,
      `نذكّركم بسداد اشتراك ${formatMonth(month)} لفريق ${team?.name ?? ""}.`,
      `المبلغ: ${money(cot.expected_amount)}`,
      `المتبقي: ${money(due)}`,
      `شكراً لكم ⚽`,
    ].join("\n");
    window.open(waLink(player.parent_phone, msg), "_blank");
  }

  return (
    <div className="space-y-5">
      {/* Month stepper */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">اشتراكات اللاعبين</h3>
          <p className="text-xs text-slate-500">
            {team?.name ? `${team.name} — ` : ""}موسم {team?.season ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-white p-1">
          <button
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            aria-label="الشهر السابق"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <ChevronRight size={16} />
          </button>
          <span className="min-w-32 text-center text-sm font-semibold">{formatMonth(month)}</span>
          <button
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            aria-label="الشهر التالي"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>

      {/* Collection progress */}
      <section className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">نسبة الاستخلاص</p>
            <p
              className={cn(
                "text-3xl font-black tabular-nums",
                totals.rate >= 80 ? "text-emerald-600" : totals.rate >= 50 ? "text-amber-600" : "text-red-600",
              )}
            >
              {totals.rate}%
            </p>
          </div>
          <div className="text-left text-xs text-slate-500">
            <p>
              مؤدى: <span className="font-semibold text-emerald-700">{formatAmount(totals.collected)}</span>
            </p>
            <p>
              متأخرات: <span className="font-semibold text-red-700">{formatAmount(totals.outstanding)}</span>
            </p>
            <p>
              من أصل: <span className="font-semibold">{formatAmount(totals.expected)}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              totals.rate >= 80 ? "bg-emerald-500" : totals.rate >= 50 ? "bg-amber-500" : "bg-red-500",
            )}
            style={{ width: `${Math.min(totals.rate, 100)}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
            مؤدى: {totals.paid}
          </span>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
            جزئي: {totals.partial}
          </span>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">
            غير مؤدى: {totals.unpaid}
          </span>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو رقم القميص…"
            className="w-full rounded-lg border py-2 pe-3 ps-9 text-sm"
          />
        </div>
        <div className="flex gap-1 rounded-full border bg-white p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                status === f.value ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-2.5 text-right font-semibold">اللاعب</th>
              <th className="px-4 py-2.5 text-right font-semibold">المطلوب</th>
              <th className="px-4 py-2.5 text-right font-semibold">المؤدى</th>
              <th className="px-4 py-2.5 text-right font-semibold">المتبقي</th>
              <th className="px-4 py-2.5 text-right font-semibold">الحالة</th>
              <th className="px-4 py-2.5 text-left font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map(({ player, cot, due }) => (
              <tr key={cot.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <p className="font-medium">#{player.jersey_number} {player.full_name}</p>
                  <p className="text-xs text-slate-400">{player.position}</p>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{formatAmount(cot.expected_amount)}</td>
                <td className="px-4 py-2.5 font-medium tabular-nums text-emerald-700">
                  {formatAmount(cot.paid_amount)}
                </td>
                <td
                  className={cn(
                    "px-4 py-2.5 tabular-nums",
                    due > 0 ? "font-semibold text-red-700" : "text-slate-400",
                  )}
                >
                  {formatAmount(due)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      STATUS_BADGE[cot.status],
                    )}
                  >
                    {STATUS_LABEL[cot.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex justify-end gap-1">
                    <button
                      onClick={() => openPayment(player, cot)}
                      title="تسجيل أداء"
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={() => sendReceipt(player, cot)}
                      title="إرسال إيصال"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Receipt size={14} />
                    </button>
                    <button
                      onClick={() => sendReminder(player, cot)}
                      title="إرسال تذكير"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-amber-600"
                    >
                      <AlertTriangle size={14} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <Users size={24} className="mx-auto text-slate-300" />
                  <p className="mt-2 text-sm text-slate-400">
                    {rows.length === 0
                      ? "لا يوجد لاعبون في هذه الفئة."
                      : "لا نتائج مطابقة للبحث."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Payment modal */}
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={submitPayment}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h4 className="font-bold">تسجيل أداء</h4>
              <button type="button" onClick={() => setPaying(null)} aria-label="إغلاق">
                <X size={18} />
              </button>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-medium">
                #{paying.player.jersey_number} {paying.player.full_name}
              </p>
              <p className="text-xs text-slate-500">
                {formatMonth(month)} — المطلوب {money(paying.cot.expected_amount)} · المؤدى{" "}
                {money(paying.cot.paid_amount)}
              </p>
            </div>

            <label className="block text-sm font-medium">
              المبلغ (درهم)
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              طريقة الأداء
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                <option>نقدي</option>
                <option>تحويل</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              رقم الإيصال
              <input
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
                placeholder="اختياري"
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="block text-sm font-medium">
              تاريخ الأداء
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            {payError && <p className="text-xs text-red-600">{payError}</p>}

            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-700"
            >
              تأكيد الأداء
            </button>
          </form>
        </div>
      )}
    </div>
  );
}