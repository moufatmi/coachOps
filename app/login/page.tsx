"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, UserPlus, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

export default function LoginPage() {
  const { signIn, signUp, available, user } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in? This route is only a gate, so send them back to the app.
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  if (user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setNotice("تم إنشاء الحساب. تحقّق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <h1 className="text-3xl font-black">CoachOps ⚽</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "signin" ? "سجّل الدخول لإدارة فريقك" : "أنشئ حساباً جديداً"}
          </p>
        </div>

        {!available && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>
              الاتصال بقاعدة البيانات غير مهيأ. أضف{" "}
              <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> و{" "}
              <code className="text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> في ملف{" "}
              <code className="text-xs">.env.local</code> ثم أعد تشغيل الخادم.
            </p>
          </div>
        )}

        {error && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
          <label className="block text-sm font-medium">
            البريد الإلكتروني
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
            />
          </label>
          <label className="block text-sm font-medium">
            كلمة المرور
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              dir="ltr"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-left"
            />
          </label>

          <button
            type="submit"
            disabled={busy || !available}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : mode === "signin" ? (
              <LogIn size={18} />
            ) : (
              <UserPlus size={18} />
            )}
            {mode === "signin" ? "تسجيل الدخول" : "إنشاء حساب"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
            className="w-full text-center text-xs text-slate-500 hover:underline"
          >
            {mode === "signin" ? "ليس لديك حساب؟ إنشاء حساب جديد" : "لديك حساب بالفعل؟ تسجيل الدخول"}
          </button>
        </form>

        <p className="px-2 text-center text-xs leading-relaxed text-slate-400">
          بياناتك محفوظة على جهازك، والمزامنة إلى السحابة تتم يدوياً باستخدام حسابك.
        </p>
      </div>
    </div>
  );
}