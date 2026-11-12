import type { Calibration } from "@/lib/training/rir-calibration";
import Dexie, { type DexieOptions, type EntityTable } from "dexie";
import type { SetType } from "@/lib/db/enums";

// Lokale IndexedDB-Datenbank. Im Gym ist der Empfang oft schlecht:
// Jede Änderung am Training landet zuerst hier in der "Outbox" und wird
// in genau dieser Reihenfolge an Supabase übertragen, sobald Netz da ist.

export type SyncTable =
  | "profiles"
  | "user_assessments"
  | "user_equipment"
  | "training_plans"
  | "plan_days"
  | "plan_exercises"
  | "plan_adaptations"
  | "workout_sessions"
  | "exercise_logs"
  | "set_logs"
  | "body_measurements"
  | "exercise_notes"
  | "nutrition_days"
  | "progress_photos"
  | "rir_calibrations"
  /** Bilddatei im privaten Speicher (kein DB-Table): Upload bzw. Löschen über die Storage-API */
  | "photo_files";

export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  op: "upsert" | "delete";
  rowId: string;
  /**
   * upsert: vollständige Zeile (snake_case, wie in der DB) – Replays bleiben idempotent.
   * delete: Bedingung, z. B. { id } oder { user_id } (leer = { id: rowId }).
   */
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

/** Abgeschlossenes Training – lokale Historie für „Letztes Mal“ und Auswertungen (offline, auch im Demo-Modus). */
export interface CompletedSet {
  id: string;
  setIndex: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  rir: number | null;
}

export interface CompletedExercise {
  logId: string;
  exerciseId: string;
  planExerciseId: string | null;
  pumpRating: number | null;
  jointDiscomfort: number | null;
  sets: CompletedSet[];
}

export interface CompletedSession {
  id: string;
  planId: string | null;
  planDayId: string | null;
  startedAt: string;
  endedAt: string;
  sessionRpe: number | null;
  /** Deload-Woche: zählt zum Volumen, nicht für Stagnation/Rückgang */
  deload?: boolean;
  /** Für den Index „Sessions mit Übung X“ */
  exerciseIds: string[];
  exercises: CompletedExercise[];
}

/** Körpermaße eines Tages (cm bzw. kg/%). */
export interface Measurement {
  id: string;
  /** YYYY-MM-DD */
  measuredOn: string;
  bodyWeightKg: number | null;
  bodyFatPercent: number | null;
  shouldersCm: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  armCm: number | null;
  thighCm: number | null;
  calfCm: number | null;
  notes: string | null;
}

/** Notiz zu einer Übung (z. B. „Sitzhöhe 4“) – eine je Übung. */
export interface ExerciseNote {
  exerciseId: string;
  note: string;
  updatedAt: string;
}

/** Ernährung eines Tages (lokale Zeit). */
export interface NutritionDay {
  /** YYYY-MM-DD */
  day: string;
  proteinG: number | null;
  energyKcal: number | null;
  source: "manual" | "health_connect";
  updatedAt: string;
}

export type PhotoPose = "front" | "side" | "back";

/** Fortschrittsfoto: Datei lokal (Blob) und/oder im privaten Speicher (storagePath). */
export interface ProgressPhoto {
  id: string;
  /** YYYY-MM-DD */
  takenOn: string;
  pose: PhotoPose;
  storagePath: string | null;
  width: number | null;
  height: number | null;
  /** verkleinertes JPEG; fehlt bei Fotos von anderen Geräten, bis es geladen wurde */
  blob?: Blob;
  createdAt: string;
}

export class GymDB extends Dexie {
  outbox!: EntityTable<OutboxEntry, "seq">;
  sessions!: EntityTable<CompletedSession, "id">;
  measurements!: EntityTable<Measurement, "id">;
  notes!: EntityTable<ExerciseNote, "exerciseId">;
  nutrition!: EntityTable<NutritionDay, "day">;
  photos!: EntityTable<ProgressPhoto, "id">;
  calibrations!: EntityTable<Calibration, "id">;

  constructor(name = "gym", options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      outbox: "++seq, table, rowId",
    });
    this.version(2).stores({
      outbox: "++seq, table, rowId",
      sessions: "id, endedAt, *exerciseIds",
    });
    this.version(3).stores({
      outbox: "++seq, table, rowId",
      sessions: "id, endedAt, *exerciseIds",
      measurements: "id, measuredOn",
    });
    this.version(4).stores({
      outbox: "++seq, table, rowId",
      sessions: "id, endedAt, *exerciseIds",
      measurements: "id, measuredOn",
      notes: "exerciseId",
      nutrition: "day",
      photos: "id, takenOn, pose",
    });
    this.version(5).stores({
      outbox: "++seq, table, rowId",
      sessions: "id, endedAt, *exerciseIds",
      measurements: "id, measuredOn",
      notes: "exerciseId",
      nutrition: "day",
      photos: "id, takenOn, pose",
      calibrations: "id, exerciseId, createdAt",
    });
  }
}

let instance: GymDB | undefined;

/** Nur im Browser aufrufen. */
export function getDb(): GymDB {
  instance ??= new GymDB();
  return instance;
}
