import type { Exercise } from "@/lib/catalog";

// Aufwärmsätze und Scheibenrechner.
//
// Aufwärmen: wenige, kurze Sätze mit steigender Last – genug, um Technik und Kraft vorzubereiten, ohne zu ermüden
// (Wiederholungen sinken, je näher die Last am Arbeitsgewicht liegt). Grundübungen mit Langhantel: leere Stange,
// dann ~50/70/85 %; andere Übungen: ein Satz mit ~50 %.

export interface WarmupSet {
  weightKg: number;
  reps: number;
}

export const BAR_KG: Record<"barbell" | "ez_bar", number> = { barbell: 20, ez_bar: 10 };

export function barFor(exercise: Pick<Exercise, "equipment">): number | null {
  if (exercise.equipment.includes("barbell")) return BAR_KG.barbell;
  if (exercise.equipment.includes("ez_bar")) return BAR_KG.ez_bar;
  return null;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

export function warmupSets(
  exercise: Pick<Exercise, "mechanic" | "equipment" | "loadIncrementKg" | "trackingType">,
  workingKg: number | null,
): WarmupSet[] {
  if (!workingKg || workingKg <= 0 || exercise.trackingType !== "weight_reps") return [];
  const step = exercise.loadIncrementKg > 0 ? exercise.loadIncrementKg : 2.5;
  const bar = barFor(exercise);
  const heavy = exercise.mechanic === "compound";
  const plan: [number, number][] = heavy ? [[0.5, 8], [0.7, 4], [0.85, 2]] : [[0.5, 10]];
  const sets: WarmupSet[] = [];
  if (bar && heavy && workingKg >= bar * 2) sets.push({ weightKg: bar, reps: 10 });
  for (const [share, reps] of plan) {
    const weightKg = Math.max(bar ?? step, roundTo(workingKg * share, step));
    const last = sets.at(-1)?.weightKg ?? 0;
    if (weightKg <= last || weightKg >= workingKg) continue;
    sets.push({ weightKg, reps });
  }
  return sets;
}

/** Scheiben pro Seite (größte zuerst). Rest > 0, wenn sich das Gewicht nicht genau stecken lässt. */
export function platesPerSide(
  totalKg: number,
  barKg: number,
  available: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25],
): { plates: number[]; restKg: number } {
  let side = Math.round(((totalKg - barKg) / 2) * 1000) / 1000;
  if (side <= 0) return { plates: [], restKg: Math.max(0, Math.round((totalKg - barKg) * 100) / 100) };
  const plates: number[] = [];
  for (const p of [...available].sort((a, b) => b - a)) {
    while (side + 1e-9 >= p) {
      plates.push(p);
      side = Math.round((side - p) * 1000) / 1000;
    }
  }
  return { plates, restKg: Math.round(side * 2 * 100) / 100 };
}
