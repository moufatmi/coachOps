"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // `register` alone does not check for a new worker while the app is open, so
    // a coach could stay on a stale build until the tab was closed. Checking on
    // every load (and on tab focus) means a deploy reaches installed PWAs.
    const update = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          reg.update().catch(() => undefined);
        })
        .catch((err) => console.error("SW error:", err));
    };

    update();
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  return null;
}
