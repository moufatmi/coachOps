import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase is an *optional* extra: CoachOps is offline-first and runs entirely
 * off Dexie/IndexedDB.
 *
 * This module must therefore never throw at import time. It previously threw
 * when the env vars were missing, which crashed every page that transitively
 * imports it — including /settings, which only needs Supabase if the coach
 * actually clicks "sync". The client is now built lazily and returns null when
 * unconfigured, so the app degrades gracefully instead of failing to render.
 */
let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Support both the legacy anon key and Supabase's newer publishable key.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  cached = url && key ? createClient(url, key) : null;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}

/**
 * Session token slack before we bother refreshing, in seconds.
 *
 * A sync touches nine tables over the network. Refreshing only when the token is
 * already dead risks it expiring halfway through, so refresh a little early.
 */
const EXPIRY_SLACK_S = 120;

/**
 * The current session, refreshed if its access token has expired or is close to.
 *
 * `supabase.auth.getSession()` reads the cached token and does **not** validate
 * it. Supabase access tokens last one hour, and the library's background
 * auto-refresh only runs while the document is visible -- so closing the tab or
 * locking a phone was enough to come back to a long-expired token. Every request
 * then failed with "JWT expired", once per table, which read as a broken app
 * rather than an expired login.
 *
 * Returns null when there is genuinely no usable session: never signed in, or
 * the refresh token was rejected and the coach must sign in again.
 */
export async function getFreshSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAtMs - Date.now() > EXPIRY_SLACK_S * 1000) return session;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error || !refreshed.session) {
    // An expired refresh token means the sign-in is gone. Sign out locally so
    // the app stops presenting a session it cannot use.
    await supabase.auth.signOut().catch(() => undefined);
    return null;
  }
  return refreshed.session;
}

export const SUPABASE_UNCONFIGURED_MESSAGE =
  "السحابة غير مهيأة: أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في ملف .env.local";