"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { claimUnownedRows } from "@/lib/offline/ownership";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** True once the initial session lookup has settled. */
  ready: boolean;
  /** True once pre-auth local rows have been adopted (or there is nothing to adopt). */
  migrated: boolean;
  /** False when the app has no Supabase keys at all — nothing can sign in. */
  available: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const available = useMemo(() => getSupabase() !== null, []);
  // With no Supabase keys there is no session to look up, so we are ready
  // immediately and the login screen explains the missing configuration.
  const [ready, setReady] = useState(() => getSupabase() === null);
  const [migratedFor, setMigratedFor] = useState<string | null>(null);
  const userId = session?.user?.id ?? null;
  const migrated = userId !== null && migratedFor === userId;

  // Subscribe to Supabase auth state. Keystroke-level errors surface in the
  // login screen; missing configuration is handled by `available`.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Adopt any rows created before auth existed. Runs once per signed-in user, and
// `migrated` gates seeding so demo data is not added on top of a real roster.
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    let cancelled = false;
    claimUnownedRows(uid)
      .catch((e) => console.error("Ownership migration failed:", e))
      .finally(() => {
        if (!cancelled) setMigratedFor(uid);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase غير مهيأ");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase غير مهيأ");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    // Local rows keep their `owner_id`, so signing back in restores this coach's
    // season of work while another coach on the same device still cannot see it.
    await getSupabase()?.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user: session?.user ?? null, session, ready, migrated, available, signIn, signUp, signOut }),
    [session, ready, migrated, available, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * The signed-in coach's id, for stamping onto newly created rows so they are
 * never left unowned (an unowned row would be adoptable by the next account to
 * sign in on this device).
 */
export function useOwnerId(): string | undefined {
  return useAuth().user?.id;
}

/** Supabase's raw messages are English; the UI is Arabic. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (m.includes("email not confirmed")) return "لم يتم تأكيد البريد الإلكتروني بعد";
  if (m.includes("user already registered")) return "هذا البريد الإلكتروني مسجّل بالفعل";
  if (m.includes("password should be")) return "كلمة المرور قصيرة جداً (6 أحرف على الأقل)";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة";
  if (m.includes("fetch")) return "تعذّر الاتصال بالخادم. تحقّق من الإنترنت.";
  return message;
}