"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Save, Share2, Printer, Trash2, Pencil, Users, RotateCcw, Undo2, Eraser,
} from "lucide-react";
import {
  db,
  type Player,
  type Lineup,
  type LineupLine,
  type LineupSlot,
  type LineupVenue,
  newId,
} from "@/lib/offline/db";
import { useTeam } from "@/components/pyramid-provider";
import { useOwnerId } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import MatchResultEditor from "./match-result-editor";

interface SlotTemplate {
  key: string;
  line: LineupLine;
  position: string;
  x: number;
  y: number;
}

const gk = (key = "GK"): SlotTemplate => ({ key, line: "GK", position: "حارس", x: 50, y: 92 });

const FORMATIONS: Record<string, SlotTemplate[]> = {
  "4-3-3": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 16, y: 78 },
    { key: "DCG", line: "DEF", position: "مدافع", x: 38, y: 81 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 62, y: 81 },
    { key: "DD", line: "DEF", position: "مدافع", x: 84, y: 78 },
    { key: "MCG", line: "MID", position: "وسط", x: 30, y: 60 },
    { key: "MDC", line: "MID", position: "وسط", x: 50, y: 64 },
    { key: "MCD", line: "MID", position: "وسط", x: 70, y: 60 },
    { key: "AG", line: "FWD", position: "مهاجم", x: 22, y: 28 },
    { key: "BU", line: "FWD", position: "مهاجم", x: 50, y: 22 },
    { key: "AD", line: "FWD", position: "مهاجم", x: 78, y: 28 },
  ],
  "4-2-3-1": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 16, y: 78 },
    { key: "DCG", line: "DEF", position: "مدافع", x: 38, y: 81 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 62, y: 81 },
    { key: "DD", line: "DEF", position: "مدافع", x: 84, y: 78 },
    { key: "MDCG", line: "MID", position: "وسط", x: 38, y: 64 },
    { key: "MDCD", line: "MID", position: "وسط", x: 62, y: 64 },
    { key: "MG", line: "MID", position: "وسط", x: 20, y: 44 },
    { key: "MOC", line: "MID", position: "وسط", x: 50, y: 42 },
    { key: "MD", line: "MID", position: "وسط", x: 80, y: 44 },
    { key: "BU", line: "FWD", position: "مهاجم", x: 50, y: 20 },
  ],
  "4-4-2": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 16, y: 78 },
    { key: "DCG", line: "DEF", position: "مدافع", x: 38, y: 81 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 62, y: 81 },
    { key: "DD", line: "DEF", position: "مدافع", x: 84, y: 78 },
    { key: "MG", line: "MID", position: "وسط", x: 15, y: 56 },
    { key: "MCG", line: "MID", position: "وسط", x: 38, y: 58 },
    { key: "MCD", line: "MID", position: "وسط", x: 62, y: 58 },
    { key: "MD", line: "MID", position: "وسط", x: 85, y: 56 },
    { key: "BUG", line: "FWD", position: "مهاجم", x: 36, y: 24 },
    { key: "BUD", line: "FWD", position: "مهاجم", x: 64, y: 24 },
  ],
  "5-3-2": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 10, y: 76 },
    { key: "DCG", line: "DEF", position: "مدافع", x: 30, y: 80 },
    { key: "DCC", line: "DEF", position: "مدافع", x: 50, y: 82 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 70, y: 80 },
    { key: "DD", line: "DEF", position: "مدافع", x: 90, y: 76 },
    { key: "MCG", line: "MID", position: "وسط", x: 30, y: 58 },
    { key: "MDC", line: "MID", position: "وسط", x: 50, y: 62 },
    { key: "MCD", line: "MID", position: "وسط", x: 70, y: 58 },
    { key: "BUG", line: "FWD", position: "مهاجم", x: 38, y: 24 },
    { key: "BUD", line: "FWD", position: "مهاجم", x: 62, y: 24 },
  ],
  "4-1-4-1": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 16, y: 78 },
    { key: "DCG", line: "DEF", position: "مدافع", x: 38, y: 81 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 62, y: 81 },
    { key: "DD", line: "DEF", position: "مدافع", x: 84, y: 78 },
    { key: "MDC", line: "MID", position: "وسط", x: 50, y: 66 },
    { key: "MG", line: "MID", position: "وسط", x: 15, y: 48 },
    { key: "MCG", line: "MID", position: "وسط", x: 38, y: 50 },
    { key: "MCD", line: "MID", position: "وسط", x: 62, y: 50 },
    { key: "MD", line: "MID", position: "وسط", x: 85, y: 48 },
    { key: "BU", line: "FWD", position: "مهاجم", x: 50, y: 20 },
  ],
  "3-5-2": [
    gk(),
    { key: "DCG", line: "DEF", position: "مدافع", x: 28, y: 80 },
    { key: "DCC", line: "DEF", position: "مدافع", x: 50, y: 82 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 72, y: 80 },
    { key: "MG", line: "MID", position: "وسط", x: 10, y: 58 },
    { key: "MCG", line: "MID", position: "وسط", x: 30, y: 60 },
    { key: "MDC", line: "MID", position: "وسط", x: 50, y: 64 },
    { key: "MCD", line: "MID", position: "وسط", x: 70, y: 60 },
    { key: "MD", line: "MID", position: "وسط", x: 90, y: 58 },
    { key: "BUG", line: "FWD", position: "مهاجم", x: 36, y: 24 },
    { key: "BUD", line: "FWD", position: "مهاجم", x: 64, y: 24 },
  ],
  "3-4-3": [
    gk(),
    { key: "DCG", line: "DEF", position: "مدافع", x: 28, y: 80 },
    { key: "DCC", line: "DEF", position: "مدافع", x: 50, y: 82 },
    { key: "DCD", line: "DEF", position: "مدافع", x: 72, y: 80 },
    { key: "MG", line: "MID", position: "وسط", x: 15, y: 58 },
    { key: "MCG", line: "MID", position: "وسط", x: 38, y: 60 },
    { key: "MCD", line: "MID", position: "وسط", x: 62, y: 60 },
    { key: "MD", line: "MID", position: "وسط", x: 85, y: 58 },
    { key: "AG", line: "FWD", position: "مهاجم", x: 25, y: 26 },
    { key: "BU", line: "FWD", position: "مهاجم", x: 50, y: 20 },
    { key: "AD", line: "FWD", position: "مهاجم", x: 75, y: 26 },
  ],
  "7v7 — ألعاب مصغرة": [
    gk(),
    { key: "DG", line: "DEF", position: "مدافع", x: 32, y: 78 },
    { key: "DD", line: "DEF", position: "مدافع", x: 68, y: 78 },
    { key: "MG", line: "MID", position: "وسط", x: 18, y: 52 },
    { key: "MCG", line: "MID", position: "وسط", x: 50, y: 56 },
    { key: "MD", line: "MID", position: "وسط", x: 82, y: 52 },
    { key: "BU", line: "FWD", position: "مهاجم", x: 50, y: 22 },
  ],
};

/**
 * Maps a player's free-form position to the pitch line they auto-map to.
 * Covers the canonical list from the player form plus the legacy generic
 * values ("حارس", "مدافع", "وسط", "مهاجم") that older data may still carry.
 */
function lineOfPosition(position: string): LineupLine {
  const p = position.trim();
  if (p.includes("حارس")) return "GK";
  if (["ظهير أيمن", "قلب دفاع", "ظهير أيسر", "ليبرو", "مدافع"].includes(p)) return "DEF";
  if (["جناح أيمن", "جناح أيسر", "رأس حربة", "مهاجم"].includes(p)) return "FWD";
  return "MID";
}

const DRAW_COLORS = [
  { label: "أبيض", value: "#ffffff" },
  { label: "أصفر", value: "#facc15" },
  { label: "أحمر", value: "#ef4444" },
  { label: "أزرق", value: "#38bdf8" },
];

interface DrawPath {
  d: string;
  color: string;
}

function shortName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts[0] ?? full;
}

/**
 * Pure function: assigns players to the formation's slots, matching by
 * position first and falling back to anyone left over. Returns the remaining
 * players as the bench plus a suggested captain.
 */
function buildAutoLineup(
  formation: string,
  players: Player[],
): { slots: LineupSlot[]; benchIds: string[]; captainId: string | null } {
  const template = FORMATIONS[formation];
  if (!template || players.length === 0) {
    return { slots: [], benchIds: [], captainId: null };
  }
  const used = new Set<string>();
  const slots: LineupSlot[] = template.map((t) => {
    let candidate = players.find((p) => p.id != null && !used.has(p.id) && lineOfPosition(p.position) === t.line);
    if (!candidate) candidate = players.find((p) => p.id != null && !used.has(p.id));
    if (candidate?.id != null) used.add(candidate.id);
    return { ...t, player_id: candidate?.id ?? null };
  });
  const benchIds = players.filter((p) => p.id != null && !used.has(p.id)).map((p) => p.id!);
  const captainId = slots.find((s) => s.player_id != null)?.player_id ?? null;
  return { slots, benchIds, captainId };
}

export default function TacticalBoard() {
  const { teams, selectedTeamId } = useTeam();
  const ownerId = useOwnerId();
  const team = teams.find((t) => t.id === selectedTeamId);

  const players = useLiveQuery(
    () => (selectedTeamId ? db.players.where("team_id").equals(selectedTeamId).sortBy("jersey_number") : []),
    [selectedTeamId],
    [] as Player[],
  );

  const savedLineups = useLiveQuery(
    async () => {
      if (!selectedTeamId) return [] as Lineup[];
      return db.lineups.where("team_id").equals(selectedTeamId).reverse().sortBy("date");
    },
    [selectedTeamId],
    [] as Lineup[],
  );

  const [formation, setFormation] = useState("4-3-3");
  const [slots, setSlots] = useState<LineupSlot[]>([]);
  const [benchIds, setBenchIds] = useState<string[]>([]);
  const [captainId, setCaptainId] = useState<string | null>(null);
  const [autoFilledTeam, setAutoFilledTeam] = useState<string | null>(null);
  const [opponent, setOpponent] = useState("");
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [venue, setVenue] = useState<LineupVenue>("ملعبنا");
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState("");
  const [editingResult, setEditingResult] = useState<Lineup | null>(null);

  // New creative features
  const [mode, setMode] = useState<"players" | "draw">("players");
  const [paths, setPaths] = useState<DrawPath[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState("#ffffff");
  const [ballPos, setBallPos] = useState({ x: 50, y: 50 });
  const dragSlot = useRef<{ key: string; moved: boolean; sx: number; sy: number } | null>(null);
  const dragBall = useRef(false);
  const dragBench = useRef(false);
  const benchDropOk = useRef(false);
  const pitchRef = useRef<HTMLDivElement | null>(null);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id!, p])), [players]);

  const benchPlayers = useMemo(
    () => benchIds.map((id) => playersById.get(id)).filter(Boolean) as Player[],
    [benchIds, playersById],
  );

  const startingPlayers = useMemo(
    () =>
      slots
        .map((s) => (s.player_id != null ? playersById.get(s.player_id) : undefined))
        .filter(Boolean) as Player[],
    [slots, playersById],
  );

  function autoMap(form: string) {
    const next = buildAutoLineup(form, players);
    setSlots(next.slots);
    setBenchIds(next.benchIds);
    setCaptainId((prev) => prev ?? next.captainId);
  }

  // Pre-fill the board once the roster arrives from Dexie. This runs during
  // render (React's "adjust state when a prop changes" pattern) rather than in
  // an effect, because it is initialisation — not an external subscription.
  //
  // The `slots.length === 0` guard is load-bearing: without it, signing a new
  // player would re-run this and silently discard a lineup the coach arranged
  // by hand. Switching teams is handled by remounting via `key` in the page.
  if (
    selectedTeamId != null &&
    players.length > 0 &&
    slots.length === 0 &&
    autoFilledTeam !== selectedTeamId
  ) {
    setAutoFilledTeam(selectedTeamId);
    const next = buildAutoLineup(formation, players);
    setSlots(next.slots);
    setBenchIds(next.benchIds);
    setCaptainId(next.captainId);
  }

  function changeFormation(form: string) {
    setFormation(form);
    autoMap(form);
  }

  function swapSlots(aKey: string, bKey: string) {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.key === aKey) return { ...s, player_id: prev.find((x) => x.key === bKey)?.player_id ?? null };
        if (s.key === bKey) return { ...s, player_id: prev.find((x) => x.key === aKey)?.player_id ?? null };
        return s;
      }),
    );
  }

  function benchToSlot(slotKey: string, benchPlayerId: string) {
    const slot = slots.find((s) => s.key === slotKey);
    if (!slot) return;
    const oldId = slot.player_id;
    setSlots((prev) => prev.map((s) => (s.key === slotKey ? { ...s, player_id: benchPlayerId } : s)));
    setBenchIds((prev) => {
      const next = prev.filter((id) => id !== benchPlayerId);
      if (oldId != null) next.push(oldId);
      return next;
    });
  }

  function onSlotClick(slot: LineupSlot) {
    if (selectedSlotKey === null) setSelectedSlotKey(slot.key);
    else if (selectedSlotKey === slot.key) setSelectedSlotKey(null);
    else {
      swapSlots(selectedSlotKey, slot.key);
      setSelectedSlotKey(null);
    }
  }

  function onBenchClick(player: Player) {
    if (selectedSlotKey && player.id != null) {
      benchToSlot(selectedSlotKey, player.id);
      setSelectedSlotKey(null);
    }
  }

  function slotPct(e: React.PointerEvent) {
    const el = pitchRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)),
    };
  }

  // --- Touch-friendly pointer dragging ------------------------------------
  function onSlotPointerDown(e: React.PointerEvent, key: string) {
    if (mode !== "players") return;
    e.preventDefault();
    dragSlot.current = { key, moved: false, sx: e.clientX, sy: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onSlotPointerMove(e: React.PointerEvent) {
    const d = dragSlot.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
    const p = slotPct(e);
    if (!p) return;
    d.moved = true;
    setSlots((prev) => prev.map((s) => (s.key === d.key ? { ...s, x: p.x, y: p.y } : s)));
  }
  function onSlotPointerUp(key: string) {
    const d = dragSlot.current;
    dragSlot.current = null;
    if (d && !d.moved) onSlotClick({ key } as LineupSlot);
  }

  function onBallPointerMove(e: React.PointerEvent) {
    if (!dragBall.current) return;
    const p = slotPct(e);
    if (p) setBallPos(p);
  }

  function dropPointToSlot(e: React.PointerEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.closest("[data-slot-key]")?.getAttribute("data-slot-key") ?? null;
  }

  function onBenchPointerDown(e: React.PointerEvent) {
    if (mode !== "players") return;
    e.preventDefault();
    dragBench.current = true;
    benchDropOk.current = false;
  }
  function onBenchPointerUp(e: React.PointerEvent, id: string) {
    const wasDrag = dragBench.current;
    dragBench.current = false;
    if (!wasDrag) return;
    const slotKey = dropPointToSlot(e);
    if (slotKey) {
      benchDropOk.current = true;
      benchToSlot(slotKey, id);
      setSelectedSlotKey(null);
    }
  }
  function onBenchTap(player: Player) {
    if (benchDropOk.current) {
      benchDropOk.current = false;
      return;
    }
    onBenchClick(player);
  }

  // --- Drawing (chalkboard) mode ------------------------------------------
  function drawPct(e: React.PointerEvent) {
    const el = pitchRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 133,
    };
  }
  function onDrawStart(e: React.PointerEvent) {
    e.preventDefault();
    const p = drawPct(e);
    if (!p) return;
    setCurrentPath(`M ${p.x} ${p.y}`);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onDrawMove(e: React.PointerEvent) {
    if (currentPath === null) return;
    const p = drawPct(e);
    if (!p) return;
    setCurrentPath((prev) => (prev ? `${prev} L ${p.x} ${p.y}` : prev));
  }
  function onDrawEnd() {
    if (currentPath) setPaths((prev) => [...prev, { d: currentPath, color: drawColor }]);
    setCurrentPath(null);
  }

  async function saveLineup() {
    if (!selectedTeamId) return;
    await db.lineups.add({
      id: newId(),
      team_id: selectedTeamId,
      formation,
      opponent,
      date: matchDate,
      venue,
      captain_id: captainId,
      slots,
      substitutes: benchIds,
      created_at: new Date().toISOString(),
      owner_id: ownerId,
    });
    setSaveMsg("تم حفظ التشكيلة ✓");
    setTimeout(() => setSaveMsg(""), 2500);
  }

  function loadLineup(l: Lineup) {
    setFormation(l.formation);
    setOpponent(l.opponent);
    setMatchDate(l.date);
    setVenue(l.venue);
    setCaptainId(l.captain_id);
    setSlots(l.slots.map((s) => ({ ...s })));
    setBenchIds([...l.substitutes]);
    setSelectedSlotKey(null);
  }

  async function deleteLineup(id: string) {
    await db.lineups.delete(id);
  }

  function shareWhatsApp() {
    const captain = captainId != null ? playersById.get(captainId) : undefined;
    const startersByLine = (line: LineupLine) =>
      slots
        .filter((s) => s.line === line)
        .map((s) => {
          const p = s.player_id != null ? playersById.get(s.player_id) : undefined;
          return p ? `  ${s.position}: #${p.jersey_number} ${p.full_name}` : null;
        })
        .filter(Boolean);
    const subs = benchPlayers.map((p) => `#${p.jersey_number} ${p.full_name}`).join(", ");
    const lines = [
      `🏟️ *تشكيلة المباراة — ${team?.name ?? ""}*`,
      `⚔️ الخصم : ${opponent || "—"}`,
      `📅 التاريخ : ${matchDate} · ${venue}`,
      `📐 الخطة : ${formation}`,
      captain ? `©️ القائد : #${captain.jersey_number} ${captain.full_name}` : "",
      ``,
      `*التشكيلة الأساسية :*`,
      ...(["GK", "DEF", "MID", "FWD"] as LineupLine[]).flatMap((line) => {
        const rows = startersByLine(line);
        return rows.length ? [`▪️ ${line}`, ...rows] : [];
      }),
      ``,
      `*البدلاء :*`,
      subs || "—",
      ``,
      `— CoachOps ⚽`,
    ].filter((l) => l !== "");
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  }

  const captain = captainId != null ? playersById.get(captainId) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div>
          <h2 className="text-2xl font-bold">المخطط التكتيكي</h2>
          <p className="text-sm text-slate-500">
            اسحب اللاعبين بحرية على الملعب، أو بدّل وضع القلم وارسم خطة اللعب مباشرة — مثالي للـ iPad.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={saveLineup} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
            <Save size={16} /> حفظ
          </button>
          <button onClick={shareWhatsApp} className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700">
            <Share2 size={16} /> مشاركة التشكيلة عبر الواتساب
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-slate-700 hover:bg-slate-50">
            <Printer size={16} /> طباعة التشكيلة
          </button>
        </div>
      </div>

      {saveMsg && <p className="text-emerald-600 text-sm no-print">{saveMsg}</p>}

      {/* Match details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 no-print">
        <label className="text-sm font-medium">
          الخصم
          <input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="مثال: ضد الرجاء البيضاوي U15" className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          تاريخ المباراة
          <input type="date" value={matchDate} onChange={(e) => setMatchDate(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="text-sm font-medium">
          الملعب
          <select value={venue} onChange={(e) => setVenue(e.target.value as LineupVenue)} className="mt-1 w-full rounded-lg border px-3 py-2">
            <option>ملعبنا</option>
            <option>خارج</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          الخطة
          <select value={formation} onChange={(e) => changeFormation(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
            {Object.keys(FORMATIONS).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-4 no-print">
        <label className="text-sm font-medium">
          القائد
          <select
            value={captainId ?? ""}
            onChange={(e) => setCaptainId(e.target.value || null)}
            className="mt-1 w-56 rounded-lg border px-3 py-2"
          >
            <option value="">— اختر —</option>
            {startingPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.jersey_number} {p.full_name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => autoMap(formation)}
          className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RotateCcw size={16} /> إعادة ضبط المراكز
        </button>
      </div>

      {/* Mode toolbar */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="inline-flex rounded-full border bg-white p-1">
          <button
            onClick={() => setMode("players")}
            className={cn("inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm", mode === "players" ? "bg-emerald-600 text-white" : "text-slate-600")}
          >
            <Users size={16} /> اللاعبون
          </button>
          <button
            onClick={() => setMode("draw")}
            className={cn("inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm", mode === "draw" ? "bg-emerald-600 text-white" : "text-slate-600")}
          >
            <Pencil size={16} /> ارسم الخطة
          </button>
        </div>
        {mode === "draw" && (
          <>
            <div className="flex items-center gap-1">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c.value}
                  aria-label={c.label}
                  onClick={() => setDrawColor(c.value)}
                  className={cn("h-7 w-7 rounded-full border-2", drawColor === c.value ? "border-slate-900 scale-110" : "border-white shadow")}
                  style={{ background: c.value }}
                />
              ))}
            </div>
            <button onClick={() => setPaths((p) => p.slice(0, -1))} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              <Undo2 size={16} /> تراجع
            </button>
            <button onClick={() => setPaths([])} className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              <Eraser size={16} /> مسح
            </button>
          </>
        )}
      </div>

      {/* Pitch */}
      <div className="no-print">
        <div ref={pitchRef} className="relative mx-auto aspect-[3/4] w-full max-w-2xl touch-none select-none overflow-hidden rounded-2xl bg-green-700 shadow-inner">
          <svg className="absolute inset-0 h-full w-full opacity-70" viewBox="0 0 100 133" preserveAspectRatio="none">
            <rect x="2" y="2" width="96" height="129" fill="none" stroke="white" strokeWidth="0.8" />
            <line x1="2" y1="66.5" x2="98" y2="66.5" stroke="white" strokeWidth="0.6" />
            <circle cx="50" cy="66.5" r="9" fill="none" stroke="white" strokeWidth="0.6" />
            <rect x="24" y="2" width="52" height="16" fill="none" stroke="white" strokeWidth="0.6" />
            <rect x="36" y="2" width="28" height="7" fill="none" stroke="white" strokeWidth="0.6" />
            <rect x="24" y="115" width="52" height="16" fill="none" stroke="white" strokeWidth="0.6" />
            <rect x="36" y="124" width="28" height="7" fill="none" stroke="white" strokeWidth="0.6" />
          </svg>

          {/* Drawing overlay */}
          {mode === "draw" && (
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 133"
              preserveAspectRatio="none"
              onPointerDown={onDrawStart}
              onPointerMove={onDrawMove}
              onPointerUp={onDrawEnd}
              onPointerLeave={onDrawEnd}
            >
              {paths.map((p, i) => (
                <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth="1.4" strokeLinecap="round" />
              ))}
              {currentPath && <path d={currentPath} fill="none" stroke={drawColor} strokeWidth="1.4" strokeLinecap="round" />}
            </svg>
          )}

          <div className={cn(mode === "draw" && "pointer-events-none")}>
            {slots.map((slot) => {
              const player = slot.player_id != null ? playersById.get(slot.player_id) : undefined;
              const isCaptain = player?.id === captainId;
              return (
                <div
                  key={slot.key}
                  data-slot-key={slot.key}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                >
                  <button
                    onPointerDown={(e) => onSlotPointerDown(e, slot.key)}
                    onPointerMove={onSlotPointerMove}
                    onPointerUp={() => onSlotPointerUp(slot.key)}
                    onClick={(e) => e.preventDefault()}
                    className={cn(
                      "relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-emerald-900 text-white shadow-lg transition active:scale-95",
                      selectedSlotKey === slot.key && "ring-4 ring-yellow-300",
                    )}
                  >
                    {/* The photo replaces the shirt number; the number moves to the
                        label below so a face on the pitch is still identifiable
                        from the sideline. */}
                    {player?.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={player.photo_url} alt={player.full_name} className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <span className="text-lg font-black">{player ? `#${player.jersey_number}` : "?"}</span>
                    )}
                    {isCaptain && (
                      <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-[10px] font-bold text-black">
                        C
                      </span>
                    )}
                  </button>
                  <span className="mt-1 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {player ? shortName(player.full_name) : "فارغ"}
                  </span>
                  <span className="rounded bg-white/90 px-1.5 text-[10px] font-bold text-emerald-900">{slot.position}</span>
                </div>
              );
            })}

            {/* Draggable ball */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-white bg-white shadow touch-none"
              style={{ left: `${ballPos.x}%`, top: `${ballPos.y}%` }}
              onPointerDown={(e) => { e.preventDefault(); dragBall.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); }}
              onPointerMove={onBallPointerMove}
              onPointerUp={() => { dragBall.current = false; }}
            />
          </div>
        </div>
      </div>

      {/* Bench */}
      <div className="no-print">
        <h3 className="font-bold mb-2">دكة البدلاء <span className="text-xs font-normal text-slate-400">— اضغط على لاعب ثم على مكانه، أو اسحبه نحو الفريق</span></h3>
        <div className="flex flex-wrap gap-2">
          {benchPlayers.map((p) => (
            <button
              key={p.id}
              onPointerDown={(e) => onBenchPointerDown(e)}
              onPointerUp={(e) => onBenchPointerUp(e, p.id!)}
              onClick={() => onBenchTap(p)}
              className="flex items-center gap-2 rounded-lg border bg-white px-2 py-1.5 text-sm shadow-sm hover:shadow transition touch-none"
            >
              {p.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photo_url} alt={p.full_name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-900 text-[10px] font-black text-white">
                  #{p.jersey_number}
                </span>
              )}
              <span className="text-start">
                {shortName(p.full_name)}
                <span className="block text-[10px] text-slate-400">{p.position}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Saved lineups */}
      <div className="no-print">
        <h3 className="font-bold mb-2">التشكيلات المحفوظة</h3>
        {savedLineups.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد تشكيلة محفوظة.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {savedLineups.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <button onClick={() => loadLineup(l)} className="text-right text-sm hover:underline">
                  {l.date} — ضد {l.opponent || "?"} ({l.formation}، {l.venue})
                </button>
                <span className="flex items-center gap-3">
                  {l.goals_for != null && (
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", l.goals_for > (l.goals_against ?? 0) ? "bg-emerald-100 text-emerald-800" : l.goals_for < (l.goals_against ?? 0) ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-600")}>
                      {l.goals_for} - {l.goals_against}
                    </span>
                  )}
                  {l.mvp_id != null && playersById.get(l.mvp_id) && (
                    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">⭐ {playersById.get(l.mvp_id)!.full_name.split(" ")[0]}</span>
                  )}
                  <button onClick={() => setEditingResult(l)} className="text-emerald-700 text-xs hover:underline">النتيجة</button>
                  <button onClick={() => l.id != null && deleteLineup(l.id)} className="text-red-500" aria-label="حذف">
                    <Trash2 size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MatchResultEditor lineup={editingResult} onClose={() => setEditingResult(null)} />

      {/* Printable match sheet */}
      <div className="hidden print:block text-black">
        <h1 className="text-2xl font-bold text-center">ورقة المباراة — {team?.name}</h1>
        <p className="text-center text-sm">
          {opponent || "خصم غير محدد"} · {matchDate} · {venue} · خطة {formation}
        </p>
        {captain && <p className="text-center">القائد : #{captain.jersey_number} {captain.full_name}</p>}
        <h2 className="mt-4 font-bold">الأساسيون</h2>
        <table className="w-full border-collapse border text-sm">
          <thead>
            <tr>
              <th className="border px-2 py-1">المركز</th>
              <th className="border px-2 py-1">الرقم</th>
              <th className="border px-2 py-1">اللاعب</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const p = s.player_id != null ? playersById.get(s.player_id) : undefined;
              return (
                <tr key={s.key}>
                  <td className="border px-2 py-1">{s.position}</td>
                  <td className="border px-2 py-1">{p ? `#${p.jersey_number}` : "-"}</td>
                  <td className="border px-2 py-1">{p?.full_name ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h2 className="mt-4 font-bold">البدلاء</h2>
        <ul className="list-disc pr-5 text-sm">
          {benchPlayers.map((p) => (
            <li key={p.id}>#{p.jersey_number} {p.full_name} ({p.position})</li>
          ))}
        </ul>
        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t pt-1">توقيع المدرب</div>
          <div className="border-t pt-1">توقيع القائد</div>
        </div>
      </div>
    </div>
  );
}
