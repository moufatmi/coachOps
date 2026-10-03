"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import { db, type Expense, type ExpenseCategory } from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";

const CATEGORIES: ExpenseCategory[] = ["نقل", "معدات", "تحكيم", "صحة وإسعاف", "متنوع"];

export default function ExpenseLogger() {
  const { selectedTeamId } = useTeam();
  const ownerId = useOwnerId();

  const expenses = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as Expense[];
      return db.expenses.where("team_id").equals(selectedTeamId).toArray().then((rows) => rows.sort((a, b) => b.date.localeCompare(a.date)));
    },
    [selectedTeamId],
    [] as Expense[],
  );

  const cotisations = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [];
      return db.cotisations.where("team_id").equals(selectedTeamId).toArray();
    },
    [selectedTeamId],
    [],
  );

  const recettes = useMemo(() => cotisations.reduce((s, c) => s + c.paid_amount, 0), [cotisations]);
  const depenses = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const solde = recettes - depenses;

  const [category, setCategory] = useState<ExpenseCategory>("نقل");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTeamId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    await db.expenses.add({
      team_id: selectedTeamId,
      category,
      amount: value,
      description,
      date,
      created_at: new Date().toISOString(),
      owner_id: ownerId,
    });
    setAmount("");
    setDescription("");
  }

  async function removeExpense(id: number) {
    await db.expenses.delete(id);
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">مصاريف الفريق</h3>

      {/* الفائض */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">المداخيل (الاشتراكات)</p>
          <p className="text-2xl font-bold text-emerald-700">{recettes} درهم</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">المصاريف</p>
          <p className="text-2xl font-bold text-red-700">{depenses} درهم</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">الصافي العام للنادي</p>
          <p className={`text-2xl font-bold ${solde >= 0 ? "text-emerald-700" : "text-red-700"}`}>{solde} درهم</p>
        </div>
      </div>

      {/* نموذج */}
      <form onSubmit={addExpense} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 rounded-xl border bg-white p-4">
        <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="rounded-lg border px-3 py-2">
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input type="number" min="1" placeholder="المبلغ (درهم)" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-lg border px-3 py-2" required />
        <input placeholder="الوصف" value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-lg border px-3 py-2" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2" />
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">إضافة</button>
      </form>

      {/* قائمة */}
      <div className="rounded-xl border bg-white divide-y">
        {expenses.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">لا توجد مصاريف مسجلة.</p>
        ) : (
          expenses.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-4 py-2">
              <div>
                <p className="font-medium">{e.category} — {e.amount} درهم</p>
                <p className="text-xs text-slate-500">{e.date}{e.description ? ` · ${e.description}` : ""}</p>
              </div>
              <button onClick={() => e.id != null && removeExpense(e.id)} className="text-red-500" aria-label="حذف">
                <Trash2 size={16} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
