"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Receipt, AlertTriangle, Plus, X } from "lucide-react";
import {
  db,
  type Cotisation,
  type CotisationStatus,
  type PaymentMethod,
  type Player,
} from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";

const DEFAULT_FEE = 200;

function statusFromAmounts(paid: number, expected: number): CotisationStatus {
  if (paid >= expected && expected > 0) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

const STATUS_BADGE: Record<CotisationStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<CotisationStatus, string> = {
  paid: "مؤدى",
  partial: "جزئي",
  unpaid: "غير مؤدى",
};

function monthLabel(month: string) {
  const d = new Date(`${month}-01T00:00:00`);
  return d.toLocaleDateString("ar", { month: "long", year: "numeric" });
}

function waLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export default function SubscriptionsTracker() {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

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

  const rows = useMemo(() => {
    const byPlayer = new Map<number, Cotisation>();
    for (const c of cotisations) byPlayer.set(c.player_id, c);
    return players
      .filter((p) => p.id != null)
      .map((p) => ({ player: p, cot: byPlayer.get(p.id!) }))
      .filter((r) => r.cot) as Array<{ player: Player; cot: Cotisation }>;
  }, [players, cotisations]);

  const totals = useMemo(() => {
    const collected = rows.reduce((s, r) => s + r.cot.paid_amount, 0);
    const expected = rows.reduce((s, r) => s + r.cot.expected_amount, 0);
    const debt = rows.reduce((s, r) => s + Math.max(r.cot.expected_amount - r.cot.paid_amount, 0), 0);
    const rate = expected > 0 ? Math.round((collected / expected) * 100) : 0;
    return { collected, expected, debt, rate };
  }, [rows]);

  // Payment modal state
  const [paying, setPaying] = useState<{ player: Player; cot: Cotisation } | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("نقدي");
  const [receipt, setReceipt] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  function openPayment(player: Player, cot: Cotisation) {
    setPaying({ player, cot });
    setAmount(String(Math.max(cot.expected_amount - cot.paid_amount, 0) || DEFAULT_FEE));
    setMethod("نقدي");
    setReceipt("");
    setPayDate(new Date().toISOString().slice(0, 10));
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const newPaid = paying.cot.paid_amount + value;
    await db.cotisations.update(paying.cot.id!, {
      paid_amount: newPaid,
      status: statusFromAmounts(newPaid, paying.cot.expected_amount),
      method,
      receipt_number: receipt,
      last_payment_date: payDate,
    });
    setPaying(null);
  }

  function sendReceipt(player: Player, cot: Cotisation) {
    const msg = `إيصال أداء الاشتراك للاعب ${player.full_name}\nالنادي: ${team?.name ?? ""}\nالشهر: ${monthLabel(month)}\nالمؤدى: ${cot.paid_amount} درهم\nالطريقة: ${cot.method ?? "-"}\nرقم الإيصال: ${cot.receipt_number || "-"}\nالتاريخ: ${cot.last_payment_date ?? "-"}\nشكراً لكم ⚽`;
    window.open(waLink(player.parent_phone, msg), "_blank");
  }

  function sendReminder(player: Player, cot: Cotisation) {
    const due = Math.max(cot.expected_amount - cot.paid_amount, 0);
    const msg = `تذكير بالاشتراك الشهري للاعب ${player.full_name}\nالنادي: ${team?.name ?? ""}\nالشهر: ${monthLabel(month)}\nالمتبقي: ${due} درهم\nمبلغ الاشتراك: ${cot.expected_amount} درهم\nيرجى تسوية الوضعية في أقرب وقت.`;
    window.open(waLink(player.parent_phone, msg), "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">اشتراكات اللاعبين</h3>
          <p className="text-sm text-slate-500">موسم {team?.season ?? "—"} — {monthLabel(month)}</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border px-3 py-2"
        />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">إجمالي المؤدى</p>
          <p className="text-2xl font-bold text-emerald-700">{totals.collected} درهم</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">إجمالي المتأخرات</p>
          <p className="text-2xl font-bold text-red-700">{totals.debt} درهم</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-sm text-slate-500">نسبة الاستخلاص</p>
          <p className="text-2xl font-bold text-emerald-700">{totals.rate}%</p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2 text-right">اللاعب</th>
              <th className="px-4 py-2 text-right">الاشتراك</th>
              <th className="px-4 py-2 text-right">المؤدى</th>
              <th className="px-4 py-2 text-right">الحالة</th>
              <th className="px-4 py-2 text-right">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ player, cot }) => (
              <tr key={cot.id}>
                <td className="px-4 py-2 font-medium">#{player.jersey_number} {player.full_name}</td>
                <td className="px-4 py-2">{cot.expected_amount} درهم</td>
                <td className="px-4 py-2">{cot.paid_amount} درهم</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[cot.status]}`}>
                    {STATUS_LABEL[cot.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => openPayment(player, cot)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                    >
                      <Plus size={12} /> تسجيل أداء
                    </button>
                    <button
                      onClick={() => sendReceipt(player, cot)}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-slate-50"
                      title="إرسال إيصال عبر الواتساب"
                    >
                      <Receipt size={12} /> إيصال
                    </button>
                    <button
                      onClick={() => sendReminder(player, cot)}
                      className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-slate-50"
                      title="إرسال تذكير عبر الواتساب"
                    >
                      <AlertTriangle size={12} /> تذكير
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payment modal */}
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={submitPayment} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold">تسجيل أداء</h4>
              <button type="button" onClick={() => setPaying(null)}><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-500">#{paying.player.jersey_number} {paying.player.full_name} — {monthLabel(month)}</p>
            <label className="block text-sm font-medium">
              المبلغ (درهم)
              <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" required />
            </label>
            <label className="block text-sm font-medium">
              الطريقة
              <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="mt-1 w-full rounded-lg border px-3 py-2">
                <option>نقدي</option>
                <option>تحويل</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              رقم الإيصال
              <input value={receipt} onChange={(e) => setReceipt(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              التاريخ
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
            </label>
            <button type="submit" className="w-full rounded-lg bg-emerald-600 py-2 text-white font-medium hover:bg-emerald-700">
              تأكيد الأداء
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
