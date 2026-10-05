"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Dexie from "dexie";
import { pushToCloud, pullFromCloud, type SyncReport } from "@/lib/supabase/sync";
import { useAuth } from "@/components/auth-provider";

/**
 * Automatic background sync.
 *
 * CoachOps is offline-first, so local writes must never block on the network.
 * Any local mutation marks the data dirty and schedules a debounced push a few
 * seconds later; if the device is offline the push waits until connectivity
 * returns. Settings keeps the explicit push/pull buttons, both routed through
 * this provider so there is a single code path.
 */

export type SyncState =
  | "idle"        // nothing to send
  | "pending"     // local changes waiting for the debounce window
  | "syncing"     // request in flight
  | "synced"      // everything is on the server
  | "offline"     // changes are waiting for connectivity
  | "error";      // last attempt failed; `error` explains why

const DEBOUNCE_MS = 10_000;
/** Background reconciliation interval while the app stays open. */
const POLL_MS = 120_000;
const LAST_SYNC_KEY = "coachops:lastSyncedAt";

interface SyncContextValue {
  state: SyncState;
  lastSyncedAt: number | null;
  error: string | null;
  /** True while a push/pull is in flight. */
  busy: boolean;
  /** Resolves with the sync report, or null if the request was skipped. */
  pushNow: () => Promise<SyncReport | null>;
  pullNow: () => Promise<SyncReport | null>;
  /**
   * Full reconciliation: pull first, then push. This is what makes a second
   * device see the first device's work.
   */
  syncNow: () => Promise<void>;
  /**
   * The most recent report, or null if nothing has run yet. Kept so the settings
   * screen can show what actually changed -- rows deleted, duplicates merged --
   * instead of a blanket "done", which is what made the delete bug invisible.
   */
  lastReport: SyncReport | null;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function readLastSyncedAt(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LAST_SYNC_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<SyncState>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a push/pull is running, to ignore the writes it performs. */
  const inFlight = useRef(false);
  /** Mutations before this time are ignored (they came from our own push). */
  const ignoreUntil = useRef(0);

  const pushNow = useCallback(async (): Promise<SyncReport | null> => {
    if (inFlight.current) return null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState("offline");
      return null;
    }
    inFlight.current = true;
    setBusy(true);
    setState("syncing");
    setError(null);

    let report: SyncReport | null = null;
    try {
      report = await pushToCloud();
      setLastReport(report);
      if (report.errors.length > 0) {
        setError(report.errors.join(" | "));
        setState("error");
      } else {
        const now = Date.now();
        window.localStorage.setItem(LAST_SYNC_KEY, String(now));
        setLastSyncedAt(now);
        setState("synced");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    } finally {
      // Our own bulkPut of owner_id/updated_at must not re-trigger a push.
      ignoreUntil.current = Date.now() + 4_000;
      inFlight.current = false;
      setBusy(false);
    }
    return report;
  }, []);

  const pullNow = useCallback(async (): Promise<SyncReport | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    let report: SyncReport | null = null;
    try {
      report = await pullFromCloud();
      setLastReport(report);
      if (report.errors.length > 0) {
        setError(report.errors.join(" | "));
        setState("error");
      } else {
        const now = Date.now();
        window.localStorage.setItem(LAST_SYNC_KEY, String(now));
        setLastSyncedAt(now);
        setState("synced");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    } finally {
      // A pull writes many rows locally; ignore the resulting mutation events.
      ignoreUntil.current = Date.now() + 15_000;
      inFlight.current = false;
      setBusy(false);
    }
    return report;
  }, []);

  /**
   * Pull then push.
   *
   * Order matters: pulling first means a second device picks up the first
   * device's rows before it sends its own, so a fresh device that has never
   * synced learns what already exists instead of treating its empty local
   * database as the whole truth.
   */
  /**
   * Pull then push.
   *
   * Order matters, but it is no longer the same order as before. A pull used to
   * be harmless, so it went first for freshness. Now a pull can delete local
   * rows (that is how a deletion on another device arrives) and stage nothing,
   * while a push can delete server rows and clear tombstones. Running the pull
   * first means the push operates on a local database that matches the server,
   * and any row the pull restored from a stale peer is settled by the tombstone
   * the push then applies. Reversing them would let a push resurrect a row the
   * pull had just removed.
   *
   * Pulling first also means a second device picks up the first
   * device's rows before it sends its own, so a fresh device that has never
   * synced learns what already exists instead of treating its empty local
   * database as the whole truth.
   */
  const syncNow = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const pulled = await pullNow();
    // Only push when the pull succeeded. A failed pull can leave the ledger out
    // of step with the server, and pushing on top of that risks re-uploading rows
    // the server had already dropped.
    if (pulled && pulled.errors.length > 0) return;
    await pushNow();
  }, [userId, pullNow, pushNow]);

  const schedule = useCallback(() => {
    if (!userId || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      // Stay queued; `goOnline` will schedule it once connectivity returns.
      setState((prev) => (prev === "offline" ? prev : "offline"));
      return;
    }
    setState((prev) => (prev === "offline" ? prev : "pending"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void pushNow();
    }, DEBOUNCE_MS);
  }, [userId, pushNow]);

  // Watch for local writes. `storagemutated` fires for every table, which is
  // exactly the "something changed" signal we want. Note it is a static Dexie
  // event: the instance-level `db.on()` only accepts lifecycle events.
  useEffect(() => {
    const onMutated = () => {
      if (Date.now() < ignoreUntil.current) return;
      schedule();
    };
    Dexie.on("storagemutated", onMutated);
    return () => {
      Dexie.on("storagemutated").unsubscribe(onMutated);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  // Don't queue requests on a dead connection; wait for connectivity instead.
  useEffect(() => {
    if (!userId) return;
    const goOnline = () => {
      setState((prev) => (prev === "offline" ? "pending" : prev));
      // Reconnecting is the most likely moment to be holding new work from the
      // other device, so reconcile in both directions.
      void syncNow();
    };
    const goOffline = () => {
      if (timer.current) clearTimeout(timer.current);
      setState((prev) => (prev === "synced" || prev === "idle" ? prev : "offline"));
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [userId, schedule, syncNow]);

  // Read the persisted timestamp after mount (deferred, to keep the first client
  // render identical to the server's and avoid a hydration mismatch).
  useEffect(() => {
    const t = setTimeout(() => setLastSyncedAt(readLastSyncedAt()), 0);
    return () => clearTimeout(t);
  }, []);

  // A fresh sign-in must reconcile in both directions. Pushing alone left a
  // second device permanently empty, because it had nothing to send and never
  // asked for anything.
  useEffect(() => {
    if (!ready || !userId) return;
    const t = setTimeout(() => void syncNow(), 0);
    return () => clearTimeout(t);
  }, [ready, userId, syncNow]);

  // Catch up when the coach comes back to the tab, which is the usual way a
  // second device is opened in practice.
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId, syncNow]);

  // Slow background poll as a backstop, so a device left open picks up the other
  // device's work without any interaction. Pull only: local edits are already
  // pushed by the mutation watcher, so pushing again would just double traffic.
  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => void pullNow(), POLL_MS);
    return () => clearInterval(id);
  }, [userId, pullNow]);

  const value = useMemo<SyncContextValue>(
    () => ({ state, lastSyncedAt, error, busy, pushNow, pullNow, syncNow, lastReport }),
    [state, lastSyncedAt, error, busy, pushNow, pullNow, syncNow, lastReport],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}