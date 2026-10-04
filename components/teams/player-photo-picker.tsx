"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { fileToPlayerPhoto } from "@/lib/offline/photo";
import { cn } from "@/lib/utils";

interface Props {
  photo: string;
  onChange: (photo: string) => void;
  /** Rendered inside the circle when there is no photo. */
  fallback: string;
  size?: "sm" | "lg";
  label?: string;
}

/**
 * Photo picker for a player.
 *
 * The coach picks from the camera roll; `capture` lets a phone open the camera
 * directly, which is how a coach will actually add a squad. Re-encoding happens
 * on the device (see lib/offline/photo) so the saved row stays small.
 */
export default function PlayerPhotoPicker({ photo, onChange, fallback, size = "lg", label }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await fileToPlayerPhoto(file));
    } catch (e) {
      console.error("Photo processing failed:", e);
      setError("تعذّر معالجة الصورة. جرّب صورة أخرى.");
    } finally {
      setBusy(false);
      // Allow re-picking the same file after an error.
      if (input.current) input.current.value = "";
    }
  }

  const dim = size === "lg" ? "h-24 w-24" : "h-16 w-16";

  return (
    <div className="flex items-center gap-3">
      <div className={cn("relative shrink-0 overflow-hidden rounded-full bg-slate-100", dim)}>
        {photo ? (
          // A data URL, so no next/image config and no network request.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={label ?? "صورة اللاعب"} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xl font-black text-slate-400">
            {fallback}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera size={14} /> {busy ? "جارٍ…" : photo ? "تغيير" : "إضافة صورة"}
          </button>
          {photo && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} /> إزالة
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}