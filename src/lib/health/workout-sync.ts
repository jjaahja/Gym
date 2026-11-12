import type { CompletedSession, GymDB } from "@/lib/offline/db";
import { localDay } from "@/lib/training/schedule";
import { isAndroidApp } from "./health-connect";
import { buildWorkoutPayload, type WorkoutPayload } from "./workout-export";

import { gymHealthPlugin } from "./gym-health-plugin";

// Trainings nach Health Connect schreiben (Android-App ab Version 1.1, eigenes Plugin „GymHealth“).
// Jedes Training genau einmal; Health Connect führt sie über die clientRecordId ohnehin nicht doppelt.

const KEY = "gym-health-connect-write";
/** Beim Einschalten werden die Trainings der letzten 30 Tage nachgetragen */
export const BACKFILL_DAYS = 30;

export interface WriteState {
  enabled: boolean;
  /** Trainings ab hier übertragen */
  since: string | null;
  /** schon übertragene Trainings (IDs) */
  written: string[];
}

export function readWriteState(): WriteState {
  try {
    return { enabled: false, since: null, written: [], ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { enabled: false, since: null, written: [] };
  }
}

function saveWriteState(state: WriteState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, written: state.written.slice(-500) }));
  } catch {
    // ohne Speicher: beim nächsten Mal erneut (Health Connect verdoppelt nichts)
  }
}

export interface WritePermissions {
  workouts: boolean;
  calories: boolean;
}

export interface WriteResult {
  segments: number;
  segmentMode: "exact" | "generic" | "none";
  calories: boolean;
}

interface GymHealthPlugin {
  checkWritePermissions(): Promise<WritePermissions>;
  requestWritePermissions(): Promise<WritePermissions>;
  writeWorkout(payload: WorkoutPayload): Promise<WriteResult>;
}

const gymHealth = () => gymHealthPlugin<GymHealthPlugin>();

/** Kann diese App-Version Trainings schreiben? (false in der App 1.0 und im Browser) */
export async function workoutWriteSupported(): Promise<boolean> {
  if (!isAndroidApp()) return false;
  return (await gymHealth()).available;
}

export async function enableWorkoutExport(now = new Date()): Promise<WritePermissions> {
  const { plugin } = await gymHealth();
  const permissions = await plugin.requestWritePermissions();
  if (permissions.workouts) {
    const current = readWriteState();
    saveWriteState({
      enabled: true,
      since: current.since ?? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString(),
      written: current.written,
    });
  }
  return permissions;
}

export function disableWorkoutExport(): void {
  saveWriteState({ ...readWriteState(), enabled: false });
}

/** Satzzeiten des laufenden Trainings – vor dem Abschluss gemerkt, damit die Segmente stimmen */
const setTimes = new Map<string, string>();
export function rememberSetTimes(sets: readonly { id: string; completedAt: string | null }[]): void {
  for (const s of sets) if (s.completedAt) setTimes.set(s.id, s.completedAt);
}

/** Körpergewicht am Tag des Trainings oder davor (letzte Messung). */
async function bodyWeightOn(db: GymDB, day: string): Promise<number | null> {
  const rows = await db.measurements.where("measuredOn").belowOrEqual(day).reverse().toArray();
  return rows.find((m) => m.bodyWeightKg != null)?.bodyWeightKg ?? null;
}

export interface ExportResult {
  written: number;
  /** ohne Körpergewicht → ohne Kalorien */
  withoutCalories: number;
  error: string | null;
}

/** Alle noch nicht übertragenen Trainings ab `since` schreiben, älteste zuerst. Bricht beim ersten Fehler ab. */
export async function exportWorkouts(
  db: GymDB,
  deps: {
    write: (payload: WorkoutPayload) => Promise<WriteResult>;
    titleFor: (session: CompletedSession) => string;
    state?: WriteState;
    save?: (state: WriteState) => void;
  },
): Promise<ExportResult> {
  const state = deps.state ?? readWriteState();
  const save = deps.save ?? saveWriteState;
  const result: ExportResult = { written: 0, withoutCalories: 0, error: null };
  if (!state.enabled || !state.since) return result;
  const done = new Set(state.written);
  const pending = (await db.sessions.where("endedAt").aboveOrEqual(state.since).sortBy("endedAt")).filter(
    (s) => !done.has(s.id) && s.exercises.some((e) => e.sets.length > 0),
  );
  for (const session of pending) {
    const bodyWeightKg = await bodyWeightOn(db, localDay(new Date(session.startedAt)));
    const payload = buildWorkoutPayload(session, { title: deps.titleFor(session), bodyWeightKg, setTimes });
    try {
      await deps.write(payload);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      break;
    }
    done.add(session.id);
    result.written++;
    if (payload.activeCaloriesKcal == null) result.withoutCalories++;
    save({ ...state, written: [...done] });
  }
  return result;
}

/** In der App: über das native Plugin schreiben. */
export async function exportWorkoutsNow(db: GymDB, titleFor: (session: CompletedSession) => string): Promise<ExportResult> {
  const { available, plugin } = await gymHealth();
  if (!available) return { written: 0, withoutCalories: 0, error: null };
  return exportWorkouts(db, { write: (p) => plugin.writeWorkout(p), titleFor });
}
