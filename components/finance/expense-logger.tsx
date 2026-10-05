"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash2, Pencil, Plus, X, TrendingDown, Wallet } from "lucide-react";
import { db, type Expense, type ExpenseCategory , newId } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { stageDelete } from "@/lib/offline/sync-ledger";
import { cn } from "@/lib/utils";
import {
  expensesByCategory,
  formatAmount,
  formatDate,
  money,
  monthKey,
} from "@/lib/offline/finance";

const CATEGORIES: ExpenseCategory[] = ["نقل", "معدات", "تحكيم", "صحة وإسعاف", "متنوع"];

const CATEGORY_COLOR: Record<string, string> = {
  نقل: "bg-blue-500",
  معدات: "bg-violet-500",
  تحكيم: "bg-amber-500",
  "صحة وإسعاف": "bg-rose-500",
  متنوع: "bg-slate-400",
};

export default function ExpenseLogger({ month }: { month: string }) {
  const { selectedTeamId } = useTeam();
  const ownerId = useOwnerId();

  // Scoped to the same month as the subscriptions tab, so the figures on this
  // page all describe one period instead of mixing months with an all-time sum.
  const expenses = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as Expense[];
      const rows = await db.expenses.where("team_id").equals(selectedTeamId).toArray();
      return rows
        .filter((e) => monthKey(e.date) === month)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    [selectedTeamId, month],
    [] as Expense[],
  );

  const income = useLiveQuery(
    async () => {
      if (!selectedTeamId) return 0;
      const rows = await db.cotisations.where("team_id").equals(selectedTeamId).toArray();
      return rows.filter((c) => c.month === month).reduce((s, c) => s + c.paid_amount, 0);
    },
    [selectedTeamId, month],
    0,
  );

  const breakdown = useMemo(() => expensesByCategory(expenses), [expenses]);
  const spend = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const net = income - spend;

  const [editing, setEditing] = useState<Expense | null>(null);
  const [category, setCategory] = useState<ExpenseCategory>("نقل");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  function resetForm() {
    setAmount("");
    setDescription("");
    setDate(new Date().toISOString().slice(0, 10));
    setError("");
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setCategory(e.category);
    setAmount(String(e.amount));
    setDescription(e.description ?? "");
    setDate(e.date);
    setError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTeamId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("أدخل مبلغاً أكبر من صفر.");
      return;
    }
    if (!date) {
      setError("حدد تاريخ المصروف.");
      return;
    }

    const payload = {
      category,
      amount: value,
      description: description.trim(),
      date,
      updated_at: new Date().toISOString(),
    };

    if (editing?.id != null) {
      await db.expenses.update(editing.id, payload);
    } else {
      await db.expenses.add({
        id: newId(),
        team_id: selectedTeamId,
        ...payload,
        created_at: new Date().toISOString(),
        owner_id: ownerId,
      });
    }
    setEditing(null);
    resetForm();
  }

  async function remove(e: Expense) {
    const label = e.description?.trim() ? `${e.category} — ${e.description}` : e.category;
    if (!confirm(`حذف المصروف "${label}" (${money(e.amount)})؟`)) return;
    await db.expenses.delete(e.id!);
    await stageDelete("expenses", e.id!);
  }

  return (
    <div className="space-y-5">
      {/* Period summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Wallet size={14} /> المداخيل
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{formatAmount(income)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <TrendingDown size={14} /> مصاريف الشهر
          </p>
          <p className="mt-1 text-2xl font-bold text-red-700">{formatAmount(spend)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">صافي الشهر</p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold",
              net > 0 ? "text-emerald-700" : net < 0 ? "text-red-700" : "text-slate-700",
            )}
          >
            {formatAmount(net)}
          </p>
        </div>
      </div>

      {/* Breakdown */}
      {breakdown.length > 0 && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h4 className="mb-3 text-sm font-bold">المصاريف حسب البند</h4>
          <ul className="space-y-2.5">
            {breakdown.map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{c.category}</span>
                  <span className="text-slate-500">
                    {formatAmount(c.total)}
                    <span className="ms-2 text-xs text-slate-400">({c.count})</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full", CATEGORY_COLOR[c.category] ?? "bg-slate-400")}
                    style={{ width: `${c.share}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Add / edit form */}
      <form onSubmit={save} className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold">{editing ? "تعديل المصروف" : "إضافة مصروف"}</h4>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                resetForm();
              }}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:underline"
            >
              <X size={12} /> إلغاء
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-slate-500">
            البند
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            المبلغ (درهم)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="text-xs text-slate-500">
            الوصف
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="اختياري"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-500">
            التاريخ
            <input
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        </div>

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
        >
          <Plus size={16} />
          {editing ? "حفظ التعديل" : "إضافة المصروف"}
        </button>
      </form>

      {/* Ledger */}
      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-2.5 text-right font-semibold">البند</th>
              <th className="px-4 py-2.5 text-right font-semibold">الوصف</th>
              <th className="px-4 py-2.5 text-right font-semibold">التاريخ</th>
              <th className="px-4 py-2.5 text-right font-semibold">المبلغ</th>
              <th className="px-4 py-2.5 text-left font-semibold">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        CATEGORY_COLOR[e.category] ?? "bg-slate-400",
                      )}
                    />
                    {e.category}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{e.description || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500 tabular-nums">{formatDate(e.date)}</td>
                <td className="px-4 py-2.5 font-semibold tabular-nums">{formatAmount(e.amount)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex justify-end gap-1">
                    <button
                      onClick={() => openEdit(e)}
                      aria-label="تعديل"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(e)}
                      aria-label="حذف"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  لا توجد مصاريف مسجلة.
                </td>
              </tr>
            )}
          </tbody>
          {expenses.length > 0 && (
            <tfoot className="border-t bg-slate-50 font-semibold">
              <tr>
                <td colSpan={3} className="px-4 py-2.5 text-right text-sm">
                  الإجمالي
                </td>
                <td className="px-4 py-2.5 text-sm tabular-nums">{formatAmount(spend)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </section>

      <p className="text-xs text-slate-400">
        الأرقام خاصة بشهر {month}. لتغيير الشهر استخدم منتقي الشهر في الأعلى.
      </p>
    </div>
  );
}