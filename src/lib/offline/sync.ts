import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getDb } from "./db";
import { flushOutboxOnce, supabaseBackend } from "./outbox";

// Sync-Status für die UI (Badge im Tracker, Einstellungen).
interface SyncStatus {
  pending: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export const useSyncStatus = create<SyncStatus>(() => ({
  pending: 0,
  syncing: false,
  lastError: null,
  lastSyncedAt: null,
}));

/** Überträgt die Outbox, sofern online, konfiguriert und angemeldet. */
export async function syncNow(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !navigator.onLine) return;

  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  useSyncStatus.setState({ syncing: true });
  try {
    const result = await flushOutboxOnce(getDb(), supabaseBackend(supabase));
    useSyncStatus.setState((prev) => ({
      lastError: result.error ?? null,
      lastSyncedAt: result.synced > 0 ? new Date().toISOString() : prev.lastSyncedAt,
    }));
  } finally {
    useSyncStatus.setState({ syncing: false });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Bündelt schnelle Folgeänderungen (z. B. mehrere Sätze) zu einem Sync. */
export function requestSync(delayMs = 1500): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}
