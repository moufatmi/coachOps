"use client";

import { useState } from "react";
import { Wallet, Receipt, TrendingDown, Printer } from "lucide-react";
import SubscriptionsTracker from "@/components/finance/subscriptions-tracker";
import ExpenseLogger from "@/components/finance/expense-logger";
import { currentMonth, formatMonth, shiftMonth } from "@/lib/offline/finance";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "cotisations" as const, label: "اشتراكات اللاعبين", icon: Receipt },
  { id: "depenses" as const, label: "مصاريف الفريق", icon: TrendingDown },
];

export default function FinancePage() {
  // One month selector drives both tabs, so the income shown against expenses
  // always describes the same period.
  const [month, setMonth] = useState(currentMonth());
  const [tab, setTab] = useState<"cotisations" | "depenses">("cotisations");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Wallet size={22} /> المالية
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            كل الأرقام خاصة بـ {formatMonth(month)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border bg-white p-1">
            <button
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="الشهر السابق"
              className="rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              ›
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="bg-transparent px-1 text-center text-sm font-semibold"
            />
            <button
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="الشهر التالي"
              className="rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              ‹
            </button>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Printer size={15} /> طباعة
          </button>
        </div>
      </header>

      <div className="flex gap-1 rounded-full border bg-white p-1 sm:w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition",
              tab === id ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === "cotisations" ? (
        <SubscriptionsTracker month={month} onMonthChange={setMonth} />
      ) : (
        <ExpenseLogger month={month} />
      )}
    </div>
  );
}