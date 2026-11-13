import type { LoggedSetLike } from "./progression";

// Gewichtsvorschlag aus der bisherigen Leistung.
//
// Grundlage: Aus Gewicht, Wiederholungen und Wiederholungen im Tank (RIR) eines Satzes lässt sich schätzen, wie
// viele Wiederholungen bis zum Muskelversagen möglich wären – und umgekehrt, mit welchem Gewicht man bei einem Ziel-
// RIR im Wiederholungsbereich landet (Epley-Beziehung, RIR-korrigiert wie set_logs.e1rm_kg:
// e1RM = Gewicht × (1 + (Wdh. + RIR) / 30)).
//
// Ziele (Einstellung):
// - "failure_last_set": frühe Sätze 1–2 Wiederholungen im Tank, letzter Satz bis zum Versagen. Schwere Grundübungen
//   (Langhantel/hohe Ermüdung) im letzten Satz 1 im Tank – Technik und Verletzungsrisiko. Begründung: Für Muskelaufbau
//   steigt der Effekt, je näher die Sätze am Versagen enden (Robinson et al. 2024); Versagen in jedem Satz bringt bei
//   gleichem Volumen kaum Zusatznutzen, aber deutlich mehr Ermüdung (Refalo et al. 2023).
// - "plan": RIR-Bereich aus dem Plan (Richtwerte des Ziels), nur die Gewichtsberechnung nutzt die bisherige Leistung.
//
// Vorgehen: Erst das bisherige Gewicht prüfen – landet es beim Ziel-RIR im Wiederholungsbereich, bleibt es (stabil,
// passt zur doppelten Progression). Sonst das Gewicht für die Mitte des Bereichs berechnen und auf die kleinste
// Steigerung der Übung runden.

export type LoadTarget = "failure_last_set" | "plan";

export interface LoadSuggestionInput {
  mode: LoadTarget;
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  /** geplante Arbeitssätze */
  sets: number;
  loadIncrementKg: number;
  /** Zielgewicht aus dem Plan (doppelte Progression) */
  targetLoadKg: number | null;
  /** Langhantel-Grundübung oder hohe Ermüdung: letzter Satz 1 im Tank statt Versagen */
  heavyCompound: boolean;
  /** Arbeitssätze des letzten Trainings dieser Übung */
  previous: readonly LoggedSetLike[];
  /** Sätze von heute (alle Typen) */
  today: readonly LoggedSetLike[];
  /** Ohne eigenen Verlauf: geschätztes 1RM (verwandte Übung oder Kraftnorm, schon mit Sicherheitsabschlag) */
  estimate?: { strength: number; label: string };
}

export interface LoadSuggestion {
  weightKg: number | null;
  /** erwartete Wiederholungen beim Ziel-RIR */
  expectedReps: number | null;
  /** Ziel-RIR für diesen Satz (Mitte, z. B. 1,5 für „1–2“) */
  targetRir: number;
  /** „bis zum Versagen“, „1–2 im Tank“ … */
  effortLabel: string;
  lastSet: boolean;
  change: "increase" | "decrease" | "same";
  reason: string;
}

const isWorking = (s: LoggedSetLike) => s.setType === "working" && s.reps != null && s.reps > 0;
const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** Wiederholungen bis zum Versagen (RIR fehlt → als Versagen gewertet, also vorsichtig). */
const repsToFailure = (s: LoggedSetLike) => Math.min(30, (s.reps ?? 0) + (s.rir ?? 0));
/** Geschätztes 1RM aus einem Satz; null ohne Gewicht. */
export function strengthOf(s: LoggedSetLike): number | null {
  if (s.weightKg == null || s.weightKg <= 0 || !isWorking(s)) return null;
  return s.weightKg * (1 + repsToFailure(s) / 30);
}
/** Erwartete Wiederholungen mit `weightKg` bei `rir` Wiederholungen im Tank. */
export const expectedRepsAt = (strength: number, weightKg: number, rir: number) => 30 * (strength / weightKg - 1) - rir;
/** Gewicht, mit dem man `reps` Wiederholungen bei `rir` im Tank schafft. */
export const loadFor = (strength: number, reps: number, rir: number) => strength / (1 + (reps + rir) / 30);

function effortFor(input: LoadSuggestionInput, lastSet: boolean): { rir: number; label: string } {
  if (input.mode === "plan") {
    const { rirMin, rirMax } = input;
    return { rir: (rirMin + rirMax) / 2, label: rirMin === rirMax ? `${rirMin} im Tank` : `${rirMin}–${rirMax} im Tank` };
  }
  if (!lastSet) return { rir: 1.5, label: "1–2 im Tank" };
  return input.heavyCompound ? { rir: 1, label: "1 im Tank (schwere Grundübung)" } : { rir: 0, label: "bis zum Versagen" };
}

const describe = (s: LoggedSetLike) => `${de(s.weightKg!)} kg × ${s.reps}${s.rir != null ? ` (${de(s.rir)} im Tank)` : ""}`;

export function suggestLoad(input: LoadSuggestionInput): LoadSuggestion {
  const workingToday = input.today.filter(isWorking);
  const lastSet = workingToday.length >= input.sets - 1;
  const { rir, label } = effortFor(input, lastSet);
  const base = { targetRir: rir, effortLabel: label, lastSet };

  // Stärke: heute der letzte Satz (enthält die Ermüdung der Einheit), sonst der beste Satz vom letzten Mal
  const latestToday = workingToday.at(-1);
  const reference =
    latestToday && strengthOf(latestToday) != null
      ? { set: latestToday, strength: strengthOf(latestToday)!, source: "heute" as const }
      : input.previous
          .filter(isWorking)
          .map((set) => ({ set, strength: strengthOf(set), source: "letztes Mal" as const }))
          .filter((r): r is { set: LoggedSetLike; strength: number; source: "letztes Mal" } => r.strength != null)
          .sort((a, b) => b.strength - a.strength)[0];

  const currentWeight =
    latestToday?.weightKg ??
    input.targetLoadKg ??
    (input.previous.filter(isWorking).length ? Math.max(...input.previous.filter(isWorking).map((s) => s.weightKg ?? 0)) : null);

  if (!reference) {
    if (currentWeight != null && currentWeight > 0) {
      return { ...base, weightKg: currentWeight, expectedReps: null, change: "same", reason: "Zielgewicht aus dem Plan" };
    }
    if (input.estimate && input.estimate.strength > 0) {
      const step = input.loadIncrementKg > 0 ? input.loadIncrementKg : 2.5;
      const middle = (input.repsMin + input.repsMax) / 2;
      const weight = Math.max(step, roundTo(loadFor(input.estimate.strength, middle, rir), step));
      const reps = Math.max(1, Math.round(Math.round(expectedRepsAt(input.estimate.strength, weight, rir) * 100) / 100));
      return {
        ...base,
        weightKg: weight,
        expectedReps: reps,
        change: "same",
        reason: `${input.estimate.label} → Startgewicht ${de(weight)} kg, ca. ${reps} Wdh. Nach dem ersten Satz passt die App an.`,
      };
    }
    return {
      ...base,
      weightKg: null,
      expectedReps: null,
      change: "same",
      reason: `Wähle ein Gewicht, mit dem du ${input.repsMin}–${input.repsMax} Wiederholungen schaffst`,
    };
  }

  const { strength } = reference;
  const step = input.loadIncrementKg > 0 ? input.loadIncrementKg : 2.5;
  let weight = currentWeight && currentWeight > 0 ? currentWeight : null;
  let expected = weight ? expectedRepsAt(strength, weight, rir) : null;
  let adjusted: "heavier" | "lighter" | null = null;

  if (expected == null || expected > input.repsMax + 0.5 || expected < input.repsMin - 0.5) {
    const middle = (input.repsMin + input.repsMax) / 2;
    const next = Math.max(step, roundTo(loadFor(strength, middle, rir), step));
    if (weight != null) adjusted = next > weight ? "heavier" : next < weight ? "lighter" : null;
    weight = next;
    expected = expectedRepsAt(strength, weight, rir);
  }

  // erst auf Hundertstel, damit 10,5 nicht als 10,4999… abgerundet wird
  const reps = Math.max(1, Math.round(Math.round(expected! * 100) / 100));
  const from = `${reference.source === "heute" ? "Letzter Satz" : "Letztes Mal"}: ${describe(reference.set)}`;
  const why =
    adjusted === "heavier"
      ? ` – mit ${de(currentWeight!)} kg wären es über ${input.repsMax} Wiederholungen`
      : adjusted === "lighter"
        ? ` – mit ${de(currentWeight!)} kg wären es unter ${input.repsMin} Wiederholungen`
        : "";
  const goal = lastSet && input.mode === "failure_last_set" && !input.heavyCompound ? `letzter Satz bis zum Versagen, ca. ${reps} Wdh.` : `ca. ${reps} Wdh., ${label}`;
  const reference0 = latestToday?.weightKg ?? currentWeight;

  return {
    ...base,
    weightKg: weight,
    expectedReps: reps,
    change: reference0 == null || weight === reference0 ? "same" : weight! > reference0 ? "increase" : "decrease",
    reason: `${from}${why} → ${goal}`,
  };
}
