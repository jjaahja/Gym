import type { MuscleSlug } from "@/data/catalog/muscles";
import { getExercise } from "@/lib/catalog";
import { resolveMuscleGuidelines } from "@/lib/science";
import { findPlanExercise, type StoredPlan } from "@/stores/plan-store";
import { planVolume } from "./mesocycle";

// Was passiert mit dem Wochenvolumen, wenn eine Übung dauerhaft aus dem Plan fliegt?

export interface VolumeWarning {
  muscle: MuscleSlug;
  /** Sätze pro Woche (fraktional: Nebenmuskeln zählen halb) */
  before: number;
  after: number;
  /** Mindestens empfohlene Sätze pro Woche (Richtwert für Ziel und Erfahrung) */
  min: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Muskeln der Übung, die danach unter den Richtwert fallen (oder schon darunter liegen und weiter sinken). */
export function removalWarnings(plan: StoredPlan, planExerciseId: string): VolumeWarning[] {
  const found = findPlanExercise(plan, planExerciseId);
  const exercise = found ? getExercise(found.exercise.exerciseSlug) : undefined;
  if (!found || !exercise) return [];
  const before = planVolume(plan.days);
  const after = planVolume(plan.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== planExerciseId) })));
  return exercise.muscles
    .map(({ muscle }) => ({
      muscle,
      before: round1(before.get(muscle) ?? 0),
      after: round1(after.get(muscle) ?? 0),
      min: resolveMuscleGuidelines(muscle, plan.goal, plan.experience).weekly_volume?.min ?? 0,
    }))
    .filter((w) => w.after < w.before && w.after < w.min);
}
