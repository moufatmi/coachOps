"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

/**
 * Destination of the recovery link emailed by `resetPasswordForEmail`.
 * Supabase puts the tokens in the URL fragment, which the SDK picks up and
 * exchanges for a short-lived session; `PASSWORD_RECOVERY` is then emitted.
 */
export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The recovery session arrives asynchronously, so wait a tick before
    // deciding whether the link is valid.
    const t = setTimeout(() => setReady(true), 600);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("كلمة المرور قصيرة جداً (6 أحرف على الأقل).");
      return;
    }
    if (password !== confirm) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => router.replace("/"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تغيير كلمة المرور.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-black">تعيين كلمة مرور جديدة</h1>
        </div>

        {done ? (
          <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <span>تم تغيير كلمة المرور. جارٍ التحويل…</span>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
            {!ready && (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 size={13} className="animate-spin" /> جارٍ التحقق من الرابط…
              </p>
            )}

            <label className="block text-sm font-medium">
              كلمة المرور الجديدة
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              تأكيد كلمة المرور
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border px-3 py-2"
                required
              />
            </label>

            {error && (
              <p className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-white",
                busy ? "bg-slate-400" : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              <KeyRound size={17} />
              {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
            </button>

            <p className="text-center text-xs text-slate-400">
              <a href="/login" className="hover:underline">
                العودة لتسجيل الدخول
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}