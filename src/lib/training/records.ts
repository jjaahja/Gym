import type { CompletedSession } from "@/lib/offline/db";
import { estimateOneRepMax, type LoggedSetLike } from "./progression";

// Bestleistungen je Übung: geschätztes 1RM (RIR-korrigiert) und schwerstes Gewicht.

export interface Bests {
  e1rm: { value: number; date: string } | null;
  weight: { value: number; reps: number; date: string } | null;
}

const isWorking = (s: LoggedSetLike) => ["working", "backoff", "amrap"].includes(s.setType) && s.reps != null && s.reps > 0;

export function bestsFrom(sessions: readonly CompletedSession[], exerciseId: string, excludeSessionId?: string): Bests {
  const bests: Bests = { e1rm: null, weight: null };
  for (const session of sessions) {
    if (session.id === excludeSessionId) continue;
    for (const e of session.exercises) {
      if (e.exerciseId !== exerciseId) continue;
      for (const s of e.sets) {
        if (!isWorking(s)) continue;
        const e1rm = estimateOneRepMax(s);
        if (e1rm != null && (!bests.e1rm || e1rm > bests.e1rm.value)) bests.e1rm = { value: e1rm, date: session.endedAt };
        if (s.weightKg != null && s.weightKg > 0 && (!bests.weight || s.weightKg > bests.weight.value || (s.weightKg === bests.weight.value && s.reps! > bests.weight.reps)))
          bests.weight = { value: s.weightKg, reps: s.reps!, date: session.endedAt };
      }
    }
  }
  return bests;
}

export interface RecordHit {
  kind: "e1rm" | "weight";
  value: number;
  previous: number;
}

/**
 * Welche Sätze von heute sind neue Rekorde? Nur mit früheren Daten (das erste Training ist kein „Rekord“) und nur der
 * Satz, der die bisherige Bestmarke (inkl. früherer Sätze von heute) zuerst übertrifft.
 */
export function recordsToday(sets: readonly (LoggedSetLike & { id: string })[], previous: Bests): Map<string, RecordHit[]> {
  const hits = new Map<string, RecordHit[]>();
  let e1rmBest = previous.e1rm?.value ?? null;
  let weightBest = previous.weight?.value ?? null;
  for (const s of sets) {
    if (!isWorking(s)) continue;
    const found: RecordHit[] = [];
    const e1rm = estimateOneRepMax(s);
    if (e1rm != null && e1rmBest != null && e1rm > e1rmBest + 0.01) {
      found.push({ kind: "e1rm", value: e1rm, previous: e1rmBest });
      e1rmBest = e1rm;
    }
    if (s.weightKg != null && weightBest != null && s.weightKg > weightBest) {
      found.push({ kind: "weight", value: s.weightKg, previous: weightBest });
      weightBest = s.weightKg;
    }
    if (found.length) hits.set(s.id, found);
  }
  return hits;
}
