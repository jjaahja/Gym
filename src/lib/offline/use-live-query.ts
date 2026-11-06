"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/** Reaktive IndexedDB-Abfrage: aktualisiert sich, sobald sich die zugrunde liegenden Daten ändern. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (err) => console.error("Lokale Abfrage fehlgeschlagen", err),
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps werden vom Aufrufer bestimmt
  }, deps);
  return value;
}
