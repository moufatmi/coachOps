"use client";

import { CloudUpload, CloudOff, Check, AlertTriangle, RefreshCw } from "lucide-react";
import { useSync, type SyncState } from "@/components/sync-provider";
import { cn } from "@/lib/utils";

const COPY: Record<SyncState, { label: string; className: string }> = {
  idle: { label: "جاهز", className: "text-slate-400" },
  pending: { label: "تغييرات غير مرفوعة", className: "text-amber-600" },
  syncing: { label: "جارٍ الرفع…", className: "text-slate-500" },
  synced: { label: "متزامن", className: "text-emerald-600" },
  offline: { label: "غير متصل", className: "text-slate-500" },
  error: { label: "خطأ في المزامنة", className: "text-red-600" },
};

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return "قبل ثوانٍ";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.round(hours / 24)} يوم`;
}

export function SyncIndicator({ className }: { className?: string }) {
  const { state, lastSyncedAt, error, busy, pushNow } = useSync();
  const copy = COPY[state];
  const Icon =
    state === "syncing" || busy ? RefreshCw
    : state === "error" ? AlertTriangle
    : state === "offline" ? CloudOff
    : state === "synced" ? Check
    : CloudUpload;

  const title =
    state === "error" && error
      ? error
      : state === "synced" && lastSyncedAt
        ? `آخر مزامنة: ${timeAgo(lastSyncedAt)}`
        : copy.label;

  return (
    <button
      onClick={() => void pushNow()}
      disabled={busy}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs",
        copy.className,
        "hover:bg-slate-50 disabled:opacity-60",
        className,
      )}
    >
      <Icon size={13} className={state === "syncing" || busy ? "animate-spin" : undefined} />
      <span className="hidden sm:inline">{copy.label}</span>
      {state === "synced" && lastSyncedAt && (
        <span className="hidden text-slate-400 md:inline">· {timeAgo(lastSyncedAt)}</span>
      )}
    </button>
  );
}