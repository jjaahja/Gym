"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { getDb, type OutboxEntry } from "@/lib/offline/db";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { ageLabel, syncProblem } from "@/lib/sync-health";
import { useNow } from "@/lib/use-now";
import { CloudOffIcon } from "./icons";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-warning-bg px-4 py-2 text-sm text-warning-fg">
      <CloudOffIcon className="size-4 shrink-0" />
      Offline – dein Training wird lokal gespeichert und später synchronisiert.
    </div>
  );
}

/** Synchronisierung hängt (wiederholt gescheitert oder seit Stunden nichts übertragen) → sichtbar machen. */
export function SyncProblemBanner() {
  const entries = useLiveQuery<OutboxEntry[]>(() => getDb().outbox.orderBy("seq").limit(50).toArray(), [], []);
  // Einträge gibt es nur im Browser – erst dann die Uhrzeit lesen (kein Vorrendern mit Zeit)
  return entries.length > 0 ? <SyncProblem entries={entries} /> : null;
}

function SyncProblem({ entries }: { entries: OutboxEntry[] }) {
  const online = useOnline();
  const now = useNow(60_000);
  const problem = syncProblem(entries, now, online);
  if (!problem) return null;
  return (
    <Link href="/settings#sync" role="alert" className="flex items-center gap-2 bg-warning-bg px-4 py-2 text-sm text-warning-fg">
      <CloudOffIcon className="size-4 shrink-0" />
      <span className="flex-1">
        Synchronisierung hängt {ageLabel(problem.oldestAgeMs)} – {problem.pending} {problem.pending === 1 ? "Änderung wartet" : "Änderungen warten"}.
      </span>
      <span className="shrink-0 font-semibold">Details ›</span>
    </Link>
  );
}
