"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * Training or match.
 *
 * A coach's week is two different jobs. Training is planning, turning up,
 * marking who came, and taking money. Match day is a single focused flow: pick
 * the XI, run the clock, record the result. Presenting both in one flat menu
 * meant the match-day path had to compete with five unrelated screens, so they
 * are now separate modes, in the spirit of a football game's main menu.
 */
export type Mode = "training" | "match";

const STORAGE_KEY = "coachops:mode";

/** Fired manually on write: the native `storage` event only fires cross-tab. */
const CHANGE_EVENT = "coachops:mode-change";

function readMode(): Mode {
  return window.localStorage.getItem(STORAGE_KEY) === "match" ? "match" : "training";
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Keeps two open tabs in step with each other.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The server has no localStorage, so it always renders the default. */
function serverMode(): Mode {
  return "training";
}

const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void } | null>(null);

export function ModeProvider({ children }: { children: React.ReactNode }) {
  // useSyncExternalStore rather than useState + useEffect: the mode has to be
  // read before the first paint to avoid flashing the wrong menu, and an effect
  // that calls setState guarantees a second render that gets it wrong first.
  const mode = useSyncExternalStore(subscribe, readMode, serverMode);

  const setMode = useCallback((next: Mode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): { mode: Mode; setMode: (m: Mode) => void } {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}