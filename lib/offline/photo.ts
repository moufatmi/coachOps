/**
 * Player photos, stored inline on the player row.
 *
 * Why a data URL rather than a Supabase Storage bucket:
 *
 *  - The app is offline-first. A bucket upload needs connectivity, so a photo
 *    added at training would have nothing to show until the coach got signal.
 *  - Sync already moves every text column of `players` between devices. A photo
 *    stored there rides along for free, so the picture on the second phone
 *    shows up with the rest of the squad.
 *  - A squad is ~25 players. A 256px JPEG thumbnail is roughly 15-25KB of
 *    base64, which is a few hundred KB per squad. Acceptable, and far below the
 *    point where it would be worth an upload pipeline.
 *
 * The cost is that photos must be small, so they are re-encoded on the device
 * rather than stored as the camera produced them.
 */

/** Long edge of the stored thumbnail, in pixels. */
const SIZE = 256;
/** JPEG quality. 0.82 keeps faces recognisable at a 48px pitch marker. */
const QUALITY = 0.82;

/** Roughly the point where storing the photo hurts sync more than it helps. */
const MAX_BYTES = 400 * 1024;

/**
 * Re-encodes an image file as a square, downscaled JPEG data URL.
 *
 * Centre-cropped to a square because every consumer of this is a circle: the
 * pitch marker, the squad card, the attendance tile. A portrait phone photo
 * cropped to a circle shows the face, whereas letterboxing it wastes most of the
 * thumbnail on sky and pitch.
 */
export async function fileToPlayerPhoto(file: File): Promise<string> {
  const bitmap = await loadBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
    // JPEG has no alpha; without this, transparent PNG corners render black.
    ctx.fillStyle = "#ffffff";
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillRect(0, 0, SIZE, SIZE);

    let url = canvas.toDataURL("image/jpeg", QUALITY);
    // Photos straight off a camera can still come out too heavy after a single
    // pass, so step the quality down rather than silently storing a huge row.
    for (const q of [0.7, 0.55]) {
      if (dataUrlBytes(url) <= MAX_BYTES) break;
      url = canvas.toDataURL("image/jpeg", q);
    }
    return url;
  } finally {
    // Only ImageBitmap holds GPU-backed memory that must be released; an
    // <img> is garbage collected normally.
    if (bitmap instanceof ImageBitmap) bitmap.close();
  }
}

/**
 * Decodes a file to something `drawImage` accepts.
 *
 * `createImageBitmap` is used when available because it decodes off the main
 * thread, which matters on a phone opening a 12MP photo. Safari<15 and some
 * WebViews fall back to an `<img>` element with an object URL.
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Not every WebView implements it correctly for all formats; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlBytes(url: string): number {
  // base64 carries 6 bits per character; the prefix is a small fixed overhead.
  return Math.ceil((url.length - url.indexOf(",") - 1) * 0.75);
}