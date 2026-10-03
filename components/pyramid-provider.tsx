"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Club, type CoachProfile, type Team } from "@/lib/offline/db";
import { seedDatabase } from "@/lib/offline/seed";
import { ownedBy } from "@/lib/offline/ownership";
import { loadHierarchy, ensureCoachProfile } from "@/lib/offline/hierarchy";
import { useAuth } from "@/components/auth-provider";

/**
 * Exposes the whole pyramid at once — coach, clubs, age groups — so every page
 * can read the same chain instead of each page resolving its own scope.
 *
 * The chosen club and age group are persisted to localStorage, so a refresh (or
 * reopening the installed PWA) lands back where the coach left off rather than
 * resetting to the first group.
 */

interface PyramidContextValue {
  profile: CoachProfile | undefined;
  clubs: Club[];
  groups: Team[];
  /** Groups grouped under their club, for the sidebar and home page. */
  tree: Array<{ club: Club; groups: Team[] }>;
  selectedClubId: number | null;
  selectedGroupId: number | null;
  selectedClub: Club | undefined;
  selectedGroup: Team | undefined;
  /** Accepts `undefined` because entity ids are typed optional. */
  selectClub: (id: number | null | undefined) => void;
  selectGroup: (id: number | null | undefined) => void;
  /** True once clubs/groups have been resolved at least once. */
  ready: boolean;
}

const PyramidContext = createContext<PyramidContextValue | null>(null);

const CLUB_KEY = "coachops:selectedClub";
const GROUP_KEY = "coachops:selectedGroup";

function readStored(key: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function PyramidProvider({ children }: { children: ReactNode }) {
  const { user, migrated } = useAuth();
  const ownerId = user?.id ?? null;
  const displayName = user?.user_metadata?.full_name;

  const [preferredClubId, setPreferredClubId] = useState<number | null>(null);
  const [preferredGroupId, setPreferredGroupId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const profile = useLiveQuery(async (): Promise<CoachProfile | undefined> => {
    if (!ownerId) return undefined;
    return db.coach_profiles.get(ownerId);
  }, [ownerId], undefined);

  // Live reads, so a rename or delete anywhere shows up here immediately.
  const clubs = useLiveQuery(
    async () => {
      if (!ownerId) return [];
      const rows = await db.clubs.toArray();
      return rows.filter(ownedBy(ownerId));
    },
    [ownerId],
    [] as Club[],
  );

  const groups = useLiveQuery(
    async () => {
      if (!ownerId) return [];
      const rows = await db.teams.toArray();
      return rows.filter(ownedBy(ownerId));
    },
    [ownerId],
    [] as Team[],
  );

  // One-time reconciliation once ownership has settled: seed if this coach has
  // nothing yet, and fold pre-club age groups into a default club. The live
  // queries above pick up whatever this writes.
  useEffect(() => {
    if (!ownerId || !migrated) return;
    let cancelled = false;
    (async () => {
      await seedDatabase(ownerId);
      // Guarantees a profile row exists so the apex of the pyramid is always
      // present rather than something pages have to guard against.
      await ensureCoachProfile(ownerId, displayName);
      await loadHierarchy(ownerId);
      if (!cancelled) {
        setPreferredClubId(readStored(CLUB_KEY));
        setPreferredGroupId(readStored(GROUP_KEY));
        setReady(true);
      }
    })().catch((e) => {
      console.error("Hierarchy load failed:", e);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [ownerId, migrated, displayName]);

  const selectedClubId = useMemo(() => {
    if (clubs.length === 0) return null;
    if (preferredClubId != null && clubs.some((c) => c.id === preferredClubId)) {
      return preferredClubId;
    }
    return clubs[0].id ?? null;
  }, [clubs, preferredClubId]);

  // An age group must belong to the selected club, so the chain never breaks.
  const groupsInClub = useMemo(
    () => groups.filter((g) => g.club_id === selectedClubId),
    [groups, selectedClubId],
  );

  const selectedGroupId = useMemo(() => {
    if (groupsInClub.length === 0) return null;
    if (preferredGroupId != null && groupsInClub.some((g) => g.id === preferredGroupId)) {
      return preferredGroupId;
    }
    return groupsInClub[0].id ?? null;
  }, [groupsInClub, preferredGroupId]);

  const selectClub = useCallback((id: number | null | undefined) => {
    const next = id ?? null;
    setPreferredClubId(next);
    if (typeof window !== "undefined") {
      if (next == null) window.localStorage.removeItem(CLUB_KEY);
      else window.localStorage.setItem(CLUB_KEY, String(next));
    }
  }, []);

  const selectGroup = useCallback((id: number | null | undefined) => {
    const next = id ?? null;
    setPreferredGroupId(next);
    if (typeof window !== "undefined") {
      if (next == null) window.localStorage.removeItem(GROUP_KEY);
      else window.localStorage.setItem(GROUP_KEY, String(next));
    }
  }, []);

  const tree = useMemo(
    () =>
      clubs.map((club) => ({
        club,
        groups: groups.filter((g) => g.club_id === club.id),
      })),
    [clubs, groups],
  );

  const value = useMemo<PyramidContextValue>(
    () => ({
      profile,
      clubs,
      groups,
      tree,
      selectedClubId,
      selectedGroupId,
      selectedClub: clubs.find((c) => c.id === selectedClubId),
      selectedGroup: groups.find((g) => g.id === selectedGroupId),
      selectClub,
      selectGroup,
      ready,
    }),
    [profile, clubs, groups, tree, selectedClubId, selectedGroupId, selectClub, selectGroup, ready],
  );

  return <PyramidContext.Provider value={value}>{children}</PyramidContext.Provider>;
}

export function usePyramid(): PyramidContextValue {
  const ctx = useContext(PyramidContext);
  if (!ctx) throw new Error("usePyramid must be used within PyramidProvider");
  return ctx;
}

/**
 * Scoped view for the per-group pages (squad, schedule, attendance, tactical,
 * finance). Those pages only ever care about one age group at a time, so this
 * hands them the selected club's groups without each of them re-deriving the
 * scope. Prefer `usePyramid()` on pages that span the whole pyramid.
 */
export function useTeam() {
  const { groups, selectedGroupId, selectGroup, selectedClub, ready } = usePyramid();

  const teams = useMemo(
    () => groups.filter((g) => g.club_id === selectedClub?.id),
    [groups, selectedClub],
  );

  return {
    teams,
    selectedTeamId: selectedGroupId,
    setSelectedTeamId: selectGroup,
    ready,
  };
}