import { create } from "zustand";
import { getDb } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { useSyncStatus } from "@/lib/offline/sync";
import { getCurrentUserId } from "@/lib/supabase/client";
import { planStore } from "@/stores/plan";
import { autoSyncDue, connect, disconnect, readState, syncFromHealthConnect, type ImportResult } from "./health-connect";
import {
  disableWorkoutExport,
  enableWorkoutExport,
  exportWorkoutsNow,
  readWriteState,
  workoutWriteSupported,
  type ExportResult,
} from "./workout-sync";

// Status des Health-Connect-Abgleichs für Karte (Körper-Tab) und automatischen Abgleich (Providers).

interface HealthSyncState {
  connected: boolean;
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
  lastResult: ImportResult | null;
  /** Nutzer hat die Berechtigung im Dialog nicht erteilt */
  denied: boolean;
  /** Trainings schreiben: null = noch nicht geprüft, false = App-Version ohne Plugin */
  writeSupported: boolean | null;
  writeEnabled: boolean;
  writtenCount: number;
  exporting: boolean;
  lastExport: ExportResult | null;
  writeError: string | null;
  /** Kalorien dürfen nicht geschrieben werden (nur Einheit) */
  caloriesDenied: boolean;
  load(): void;
  enableWrite(): Promise<void>;
  disableWrite(): void;
  exportWorkouts(): Promise<void>;
  connect(): Promise<void>;
  sync(): Promise<void>;
  autoSync(): Promise<void>;
  disconnect(): void;
}

const message = (err: unknown) => {
  const text = err instanceof Error ? err.message : String(err);
  if (/permission|authoriz|security|Berechtigung/i.test(text)) return "Keine Berechtigung – bitte in Health Connect erlauben.";
  return "Abgleich fehlgeschlagen. Später erneut versuchen.";
};

export const useHealthSync = create<HealthSyncState>((set, get) => ({
  connected: false,
  lastSync: null,
  syncing: false,
  error: null,
  lastResult: null,
  denied: false,
  writeSupported: null,
  writeEnabled: false,
  writtenCount: 0,
  exporting: false,
  lastExport: null,
  writeError: null,
  caloriesDenied: false,

  load() {
    const write = readWriteState();
    set({ ...readState(), writeEnabled: write.enabled, writtenCount: write.written.length });
    void workoutWriteSupported()
      .then((writeSupported) => set({ writeSupported }))
      .catch(() => set({ writeSupported: false }));
  },

  async enableWrite() {
    set({ writeError: null });
    try {
      const permissions = await enableWorkoutExport();
      if (!permissions.workouts) {
        set({ writeError: "Keine Berechtigung erteilt – du kannst sie in Health Connect erlauben." });
        return;
      }
      set({ writeEnabled: true, caloriesDenied: !permissions.calories });
      await get().exportWorkouts();
    } catch (err) {
      set({ writeError: message(err) });
    }
  },

  disableWrite() {
    disableWorkoutExport();
    set({ writeEnabled: false, lastExport: null, writeError: null });
  },

  async exportWorkouts() {
    if (get().exporting || !readWriteState().enabled) return;
    set({ exporting: true });
    try {
      // Titel: Name des Trainingstags aus dem aktuellen Plan
      const days = new Map((planStore.getState().plan?.days ?? []).map((d) => [d.id, d.name]));
      const result = await exportWorkoutsNow(getDb(), (s) => (s.planDayId && days.get(s.planDayId)) || "Krafttraining");
      set({ lastExport: result, writeError: result.error ? message(new Error(result.error)) : null, writtenCount: readWriteState().written.length });
    } catch (err) {
      set({ writeError: message(err) });
    } finally {
      set({ exporting: false });
    }
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
    // Trainings: nach jedem Training und beim Öffnen (nur noch nicht übertragene)
    void get().exportWorkouts();
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
