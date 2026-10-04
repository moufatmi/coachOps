import type { Cotisation, CotisationStatus, Expense, Player } from "./db";

/**
 * Finance formatting and aggregation.
 *
 * Kept out of the components so the subscriptions tab and the expense tab
 * derive their numbers the same way. The two tabs share one page, so a
 * discrepancy between them reads as a bug even when both are internally
 * correct -- hence a single implementation.
 */

export const CURRENCY = "درهم";

/** Groups by YYYY-MM. Matches the `month` field on Cotisation. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("ar", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Arabic-friendly grouping: 12500 -> "12,500". */
export function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function money(value: number): string {
  return `${formatAmount(value)} ${CURRENCY}`;
}

/** ISO date -> "05/10/2026". Falls back to the raw string if unparseable. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB").format(d);
}

export interface SubscriptionTotals {
  expected: number;
  collected: number;
  outstanding: number;
  /** Percentage of expected amount collected, 0 when nothing is expected. */
  rate: number;
  paid: number;
  partial: number;
  unpaid: number;
}

export function subscriptionTotals(rows: Cotisation[]): SubscriptionTotals {
  let expected = 0;
  let collected = 0;
  let paid = 0;
  let partial = 0;
  let unpaid = 0;

  for (const c of rows) {
    expected += c.expected_amount;
    collected += c.paid_amount;
    if (c.status === "paid") paid++;
    else if (c.status === "partial") partial++;
    else unpaid++;
  }

  return {
    expected,
    collected,
    outstanding: Math.max(expected - collected, 0),
    rate: expected > 0 ? Math.round((collected / expected) * 100) : 0,
    paid,
    partial,
    unpaid,
  };
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  /** Share of the largest category, 0-100, for bar widths. */
  share: number;
}

export function expensesByCategory(expenses: Expense[]): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of expenses) {
    const cur = map.get(e.category) ?? { total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    map.set(e.category, cur);
  }
  const list = [...map.entries()].map(([category, v]) => ({ category, ...v }));
  const max = list.reduce((m, x) => Math.max(m, x.total), 0);
  return list
    .map((x) => ({ ...x, share: max > 0 ? Math.round((x.total / max) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

export interface SubscriptionRow {
  player: Player;
  cot: Cotisation;
  due: number;
}

/** Free-text search across name, jersey number and parent phone. */
export function filterSubscriptions(
  rows: SubscriptionRow[],
  query: string,
  status: CotisationStatus | "all",
): SubscriptionRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(({ player, cot }) => {
    if (status !== "all" && cot.status !== status) return false;
    if (!q) return true;
    return (
      player.full_name.toLowerCase().includes(q) ||
      String(player.jersey_number).includes(q) ||
      (player.parent_phone ?? "").includes(q)
    );
  });
}

export const STATUS_LABEL: Record<CotisationStatus, string> = {
  paid: "مؤدى",
  partial: "جزئي",
  unpaid: "غير مؤدى",
};

export const STATUS_BADGE: Record<CotisationStatus, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
};

export function statusFromAmounts(paid: number, expected: number): CotisationStatus {
  if (expected > 0 && paid >= expected) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}