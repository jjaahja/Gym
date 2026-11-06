"use client";

import { useEffect, useState } from "react";

/** Aktuelle Zeit in ms, alle `intervalMs` aktualisiert (Timer, Wochenwechsel bei lange offener App). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
