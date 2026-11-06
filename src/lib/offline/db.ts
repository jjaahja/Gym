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
  | "body_measurements";

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

export class GymDB extends Dexie {
  outbox!: EntityTable<OutboxEntry, "seq">;
  sessions!: EntityTable<CompletedSession, "id">;
  measurements!: EntityTable<Measurement, "id">;

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
  }
}

let instance: GymDB | undefined;

/** Nur im Browser aufrufen. */
export function getDb(): GymDB {
  instance ??= new GymDB();
  return instance;
}
