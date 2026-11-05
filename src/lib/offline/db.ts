import Dexie, { type DexieOptions, type EntityTable } from "dexie";

// Lokale IndexedDB-Datenbank. Im Gym ist der Empfang oft schlecht:
// Jede Änderung am Training landet zuerst hier in der "Outbox" und wird
// in genau dieser Reihenfolge an Supabase übertragen, sobald Netz da ist.

export type SyncTable = "workout_sessions" | "exercise_logs" | "set_logs";

export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  op: "upsert" | "delete";
  rowId: string;
  /** Vollständige Zeile (snake_case, wie in der DB). Nie Teil-Updates, damit Replays idempotent sind. */
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export class GymDB extends Dexie {
  outbox!: EntityTable<OutboxEntry, "seq">;

  constructor(name = "gym", options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      outbox: "++seq, table, rowId",
    });
  }
}

let instance: GymDB | undefined;

/** Nur im Browser aufrufen. */
export function getDb(): GymDB {
  instance ??= new GymDB();
  return instance;
}
