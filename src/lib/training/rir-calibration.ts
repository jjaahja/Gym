import type { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import type { LoggedSetLike } from "./progression";

// RIR-Check: Wie gut schätzt du, wie viele Wiederholungen noch gehen?
// Ablauf: Satz bis zu dem Punkt, an dem du normalerweise aufhören würdest – Wiederholungen merken und schätzen, wie
// viele noch gingen. Dann weiter bis zum Muskelversagen. Tatsächlicher RIR = Wdh. bis Versagen − Wdh. beim Stopp.
// Im Mittel unterschätzen Trainierende die verbleibenden Wiederholungen um etwa eine (Halperin et al. 2022,
// Meta-Analyse, DOI 10.1007/s40279-021-01559-x); nahe am Versagen wird die Schätzung genauer.
// Nur für Übungen, bei denen Versagen sicher ist (Maschine, Kabel, Isolation) – nicht für schwere Langhantelübungen.

export interface Calibration {
  id: string;
  exerciseId: string;
  /** YYYY-MM-DD */
  performedOn: string;
  weightKg: number | null;
  /** Wiederholungen beim gedanklichen Stopp */
  stopReps: number;
  /** geschätzte Wiederholungen im Tank beim Stopp */
  predictedRir: number;
  /** Wiederholungen bis zum Versagen (insgesamt) */
  failureReps: number;
  createdAt: string;
}

export const actualRir = (c: Pick<Calibration, "stopReps" | "failureReps">) => Math.max(0, c.failureReps - c.stopReps);

/** Fehlertext oder null */
export function validateCalibration(c: Pick<Calibration, "stopReps" | "predictedRir" | "failureReps">): string | null {
  if (!Number.isInteger(c.stopReps) || c.stopReps < 1 || c.stopReps > 50) return "Wiederholungen beim Stopp: 1–50";
  if (!Number.isInteger(c.failureReps) || c.failureReps < c.stopReps || c.failureReps > 60)
    return "Bis zum Versagen: mindestens so viele wie beim Stopp";
  if (c.predictedRir < 0 || c.predictedRir > 10) return "Schätzung: 0–10";
  return null;
}

export interface RirBias {
  /** Mittlere Abweichung: + = mehr im Tank als geschätzt (Unterschätzung), − = weniger */
  mean: number;
  /** Anzahl berücksichtigter Tests (die letzten 10) */
  count: number;
  /** Korrektur für Gewichtsvorschläge (ab 3 Tests, auf 0,5 gerundet, begrenzt auf −1 … +2); 0 = keine */
  correction: number;
}

export const MIN_CALIBRATIONS = 3;

export function rirBias(calibrations: readonly Calibration[]): RirBias | null {
  const recent = [...calibrations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  if (recent.length === 0) return null;
  const mean = recent.reduce((sum, c) => sum + (actualRir(c) - c.predictedRir), 0) / recent.length;
  const rounded = Math.round(mean * 2) / 2;
  const correction = recent.length >= MIN_CALIBRATIONS ? Math.min(2, Math.max(-1, rounded)) : 0;
  return { mean: Math.round(mean * 10) / 10, count: recent.length, correction: correction === 0 ? 0 : correction };
}

/**
 * Geschätzte RIR-Werte mit der persönlichen Abweichung korrigieren (für die Gewichtsberechnung).
 * RIR 0 bleibt 0: Versagen ist eindeutig. Ergebnis nie unter 0.
 */
export function correctRir<T extends LoggedSetLike>(sets: readonly T[], correction: number): T[] {
  if (!correction) return [...sets];
  return sets.map((s) => (s.rir == null || s.rir === 0 ? s : { ...s, rir: Math.max(0, s.rir + correction) }));
}

/** Für einen RIR-Check geeignet: Versagen ohne Risiko (keine Langhantel, keine hohe Gesamtermüdung). */
export function calibrationSuitable(e: { equipment: readonly string[]; systemicFatigue: number }): boolean {
  return !e.equipment.includes("barbell") && e.systemicFatigue < 4;
}

// ─────────────────────────── Myo-Reps ───────────────────────────

/** Myo-Reps: Mini-Sätze nach 3–5 Atemzügen (~15 s), bis die Wiederholungen einbrechen (unter 3) – höchstens 5. */
export const MYO = { restSeconds: 15, repsMin: 3, repsMax: 5, maxMiniSets: 5 } as const;

/** Weitere Mini-Sätze sinnvoll? */
export function myoContinues(miniSetReps: readonly (number | null)[]): boolean {
  if (miniSetReps.length >= MYO.maxMiniSets) return false;
  const last = miniSetReps.at(-1);
  return last == null || last >= MYO.repsMin;
}

// ─────────────────────────── Speichern ───────────────────────────


export async function saveCalibration(
  db: GymDB,
  input: Omit<Calibration, "id" | "createdAt">,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date; uuid?: () => string },
): Promise<Calibration> {
  const error = validateCalibration(input);
  if (error) throw new RangeError(error);
  const c: Calibration = { ...input, id: (options.uuid ?? (() => crypto.randomUUID()))(), createdAt: (options.now ?? new Date()).toISOString() };
  await db.calibrations.put(c);
  if (options.userId)
    options.sink({
      table: "rir_calibrations",
      op: "upsert",
      rowId: c.id,
      payload: {
        id: c.id,
        user_id: options.userId,
        exercise_id: c.exerciseId,
        performed_on: c.performedOn,
        weight_kg: c.weightKg,
        stop_reps: c.stopReps,
        predicted_rir: c.predictedRir,
        failure_reps: c.failureReps,
        created_at: c.createdAt,
      },
    });
  return c;
}
