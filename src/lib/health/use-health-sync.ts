import { create } from "zustand";
import { getDb } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { useSyncStatus } from "@/lib/offline/sync";
import { getCurrentUserId } from "@/lib/supabase/client";
import { autoSyncDue, connect, disconnect, readState, syncFromHealthConnect, type ImportResult } from "./health-connect";

// Status des Health-Connect-Abgleichs für Karte (Körper-Tab) und automatischen Abgleich (Providers).

interface HealthSyncState {
  connected: boolean;
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
  lastResult: ImportResult | null;
  /** Nutzer hat die Berechtigung im Dialog nicht erteilt */
  denied: boolean;
  load(): void;
  connect(): Promise<void>;
  sync(): Promise<void>;
  autoSync(): Promise<void>;
  disconnect(): void;
}

const message = (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  if (/permission|authoriz|security/i.test(text)) return "Keine Berechtigung – bitte in Health Connect erlauben.";
  return "Abgleich fehlgeschlagen. Später erneut versuchen.";
};

export const useHealthSync = create<HealthSyncState>((set, get) => ({
  connected: false,
  lastSync: null,
  syncing: false,
  error: null,
  lastResult: null,
  denied: false,

  load() {
    set(readState());
  },

  async connect() {
    set({ error: null, denied: false });
    try {
      const ok = await connect();
      set({ connected: ok, denied: !ok });
      if (ok) await get().sync();
    } catch (err) {
      set({ error: message(err) });
    }
  },

  async sync() {
    if (get().syncing) return;
    set({ syncing: true, error: null });
    try {
      const userId = await getCurrentUserId();
      const lastResult = await syncFromHealthConnect(getDb(), { userId, sink: writeToOutbox });
      set({ ...readState(), lastResult });
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ syncing: false });
    }
  },

  async autoSync() {
    // Erst nach dem ersten Abgleich mit dem Server: Sonst kennt ein neues Gerät die Taille/Arm-Werte eines Tages
    // noch nicht und würde sie beim Hochladen mit leeren Werten überschreiben.
    if (useSyncStatus.getState().firstPull !== "done") return;
    if (!autoSyncDue(readState(), new Date()) || !(await getCurrentUserId())) return;
    await get().sync();
  },

  disconnect() {
    disconnect();
    set({ ...readState(), lastResult: null, error: null, denied: false });
  },
}));
