import type { OutboxEntry, SyncTable } from "@/lib/offline/db";

// Hängt die Synchronisierung? Die Outbox überträgt strikt der Reihe nach – scheitert ein Eintrag dauerhaft, warten alle
// dahinter. Das soll sichtbar werden, statt still Daten zurückzuhalten.

export const TABLE_LABELS: Record<SyncTable, string> = {
  profiles: "Profil",
  user_assessments: "Fragebogen",
  user_equipment: "Ausstattung",
  training_plans: "Trainingsplan",
  plan_days: "Trainingstag",
  plan_exercises: "Planübung",
  plan_adaptations: "Plananpassung",
  workout_sessions: "Training",
  exercise_logs: "Übung im Training",
  set_logs: "Satz",
  body_measurements: "Körpermaß",
  exercise_notes: "Übungsnotiz",
  nutrition_days: "Ernährung",
  progress_photos: "Fortschrittsfoto",
  photo_files: "Fotodatei",
  rir_calibrations: "RIR-Check",
};

export const STUCK_ATTEMPTS = 3;
export const STUCK_AGE_MS = 6 * 60 * 60_000;

export interface SyncProblem {
  pending: number;
  /** ältester wartender Eintrag */
  oldestAgeMs: number;
  /** der Eintrag, an dem es hängt (vorderster mit Fehler) */
  blocking: { seq: number; label: string; op: "upsert" | "delete"; attempts: number; error: string | null } | null;
  /** dauerhaft gescheitert (Verwerfen anbieten) */
  permanent: boolean;
}

/** null = alles in Ordnung. Hängt, wenn der vorderste Eintrag mehrfach scheiterte oder seit Stunden wartet. */
export function syncProblem(entries: readonly OutboxEntry[], now: number, online = true): SyncProblem | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const first = sorted[0];
  const oldestAgeMs = now - Math.min(...sorted.map((e) => e.createdAt));
  const failing = first.attempts >= STUCK_ATTEMPTS;
  const old = online && oldestAgeMs >= STUCK_AGE_MS;
  if (!failing && !old) return null;
  return {
    pending: sorted.length,
    oldestAgeMs,
    blocking: {
      seq: first.seq ?? 0,
      label: TABLE_LABELS[first.table] ?? first.table,
      op: first.op,
      attempts: first.attempts,
      error: first.lastError ?? null,
    },
    permanent: failing && isPermanentError(first.lastError),
  };
}

/** Fehler, die ein erneuter Versuch nicht behebt (Regelverstoß, ungültige Daten) – im Gegensatz zu Netzproblemen. */
export function isPermanentError(message: string | undefined): boolean {
  if (!message) return false;
  if (/fetch|network|timeout|Failed to|offline|503|502|504|JWT|token/i.test(message)) return false;
  return /violates|invalid input|duplicate key|does not exist|not-null|check constraint|row-level security|malformed/i.test(message);
}

export function ageLabel(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "seit wenigen Minuten";
  if (hours < 24) return `seit ${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  const days = Math.floor(hours / 24);
  return `seit ${days} ${days === 1 ? "Tag" : "Tagen"}`;
}
