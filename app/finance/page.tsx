"use client";

import { useState } from "react";
import SubscriptionsTracker from "@/components/finance/subscriptions-tracker";
import ExpenseLogger from "@/components/finance/expense-logger";
import { cn } from "@/lib/utils";

export default function FinancePage() {
  const [tab, setTab] = useState<"cotisations" | "depenses">("cotisations");

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">المصاريف والاشتراكات</h2>
      <div className="flex gap-2">
        <button
          onClick={() => setTab("cotisations")}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium",
            tab === "cotisations" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
          )}
        >
          اشتراكات اللاعبين
        </button>
        <button
          onClick={() => setTab("depenses")}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium",
            tab === "depenses" ? "bg-emerald-600 text-white" : "border bg-white text-slate-600",
          )}
        >
          مصاريف الفريق
        </button>
      </div>

      {tab === "cotisations" ? <SubscriptionsTracker /> : <ExpenseLogger />}
    </div>
  );
}
