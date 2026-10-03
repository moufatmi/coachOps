import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

export const SUPABASE_UNCONFIGURED_MESSAGE =
  "السحابة غير مهيأة: أضف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في ملف .env.local";