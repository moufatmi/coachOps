"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { fileToCrest } from "@/lib/offline/photo";
import { cn } from "@/lib/utils";

interface Props {
  /** Data URL, or "" when the opponent has no crest yet. */
  crest: string;
  onChange: (dataUrl: string) => void;
  /** The opponent's name, used for the alt text and the empty state. */
  opponent: string;
}

/**
 * Crest picker for the opponent in an official fixture.
 *
 * Shown only for official matches: a training game is usually against your own
 * second team or an internal squad, and a crest there would be noise.
 *
 * The frame is square and uses `object-contain` rather than `object-cover`. A
 * crest is artwork with a transparent background, so cropping it would cut off
 * exactly the parts that identify it — and on the printed sheet it would be the
 * one element that looks wrong.
 */
export default function OpponentCrestPicker({ crest, onChange, opponent }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await fileToCrest(file));
    } catch (e) {
      console.error("Crest processing failed:", e);
      setError("تعذّر معالجة الصورة. جرّب صورة أخرى.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-slate-50",
          crest && "border-solid",
        )}
      >
        {crest ? (
          // A data URL, so no next/image config and no network request.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crest}
            alt={`شعار ${opponent || "الخصم"}`}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <span className="px-1 text-center text-[10px] font-bold text-slate-400">
            شعار
          </span>
        )}
      </div>

      <div className="min-w-0">
        <input
          ref={input}
          type="file"
          accept="image/*"
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
            <ImagePlus size={14} /> {busy ? "جارٍ…" : crest ? "تغيير الشعار" : "إضافة شعار"}
          </button>
          {crest && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} /> إزالة
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          يُحفظ مرة واحدة لكل خصم
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}