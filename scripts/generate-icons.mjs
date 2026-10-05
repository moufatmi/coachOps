/**
 * Generates every PWA / browser icon for the app from one football-ball SVG.
 *
 *   node scripts/generate-icons.mjs
 *
 * Outputs:
 *   app/favicon.ico                     multi-size tab icon (16/32/48)
 *   public/apple-touch-icon.png         iOS home screen (180)
 *   public/icons/icon-192.png           android / manifest
 *   public/icons/icon-512.png           android splash / manifest
 *   public/icons/icon-maskable-512.png  adaptive icon (safe zone 80%)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BG = "#0f172a"; // slate-900, matches viewport themeColor
const BALL = "#f8fafc"; // slate-50

const poly = (cx, cy, radius, points, startAngle) =>
  Array.from({ length: points }, (_, i) => {
    const a = ((startAngle + (360 / points) * i) * Math.PI) / 180;
    return `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
  }).join(" ");

/**
 * @param {number} ballRadius radius of the ball
 */
function ballSvg({ ballRadius }) {
  const cx = 256;
  const cy = 256;
  const seam = "#0f172a";

  // Central pentagon, vertex pointing up.
  const core = 66;
  const corePoints = poly(cx, cy, core, 5, -90);

  // Five neighbouring patches on the outer ring. Each one lines up with a
  // central edge (not a vertex), which is what keeps the seams straight.
  const patchDistance = ballRadius - 12;
  const patchRadius = core * 0.78;
  const patches = Array.from({ length: 5 }, (_, i) => {
    const deg = -54 + 72 * i;
    const a = (deg * Math.PI) / 180;
    return { cx: cx + patchDistance * Math.cos(a), cy: cy + patchDistance * Math.sin(a), deg };
  });

  // Seams: radial runs from the midpoint of each central edge out to the patch
  // behind it. Each run passes underneath its own patch, so only the white gap
  // between pentagon and rim shows.
  const apothem = core * Math.cos((36 * Math.PI) / 180);
  const seams = patches
    .map(({ deg }) => {
      const a = (deg * Math.PI) / 180;
      const x = cx + apothem * Math.cos(a);
      const y = cy + apothem * Math.sin(a);
      const ex = cx + (patchDistance + patchRadius * 0.6) * Math.cos(a);
      const ey = cy + (patchDistance + patchRadius * 0.6) * Math.sin(a);
      return `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}" />`;
    })
    .join("");

  const patchShapes = patches
    .map((p) => `<polygon points="${poly(p.cx, p.cy, patchRadius, 5, p.deg + 180)}" />`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="ball"><circle cx="${cx}" cy="${cy}" r="${ballRadius}" /></clipPath>
  </defs>
  <rect width="512" height="512" fill="${BG}" />
  <g clip-path="url(#ball)">
    <circle cx="${cx}" cy="${cy}" r="${ballRadius}" fill="${BALL}" />
    <g stroke="${seam}" stroke-width="10" stroke-linecap="round" fill="none">${seams}</g>
    <g fill="${seam}">${patchShapes}</g>
    <polygon points="${corePoints}" fill="${seam}" />
  </g>
</svg>`;
}

/** Packs PNG buffers into a single multi-resolution .ico file. */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const dir = Buffer.alloc(16 * pngs.length);
  let offset = header.length + dir.length;

  pngs.forEach(({ size, buffer }, i) => {
    const at = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at + 0); // width
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1); // height
    dir.writeUInt8(0, at + 2); // palette colours
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(buffer.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += buffer.length;
  });

  return Buffer.concat([header, dir, ...pngs.map((p) => p.buffer)]);
}

async function render(svg, size) {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

const full = ballSvg({ ballRadius: 200 });
// Maskable icons must survive an aggressive circular crop, so shrink the ball
// into the 80% safe zone and keep the background full bleed.
const maskable = ballSvg({ ballRadius: 160 });

await mkdir(join(root, "public", "icons"), { recursive: true });

const outputs = [
  ["public/icons/icon-192.png", await render(full, 192)],
  ["public/icons/icon-512.png", await render(full, 512)],
  ["public/icons/icon-maskable-512.png", await render(maskable, 512)],
  ["public/apple-touch-icon.png", await render(full, 180)],
];

const icoSizes = [16, 32, 48];
const ico = buildIco(
  await Promise.all(
    icoSizes.map(async (size) => ({ size, buffer: await render(full, size) })),
  ),
);
outputs.push(["app/favicon.ico", ico]);

for (const [file, buffer] of outputs) {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`${file}  ${buffer.length} bytes`);
}