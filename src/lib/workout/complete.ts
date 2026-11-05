import { getExerciseById } from "@/lib/catalog";
import type { CompletedSession, GymDB } from "@/lib/offline/db";
import { recentPerformances, saveSession } from "@/lib/offline/history";
import { evaluateDoubleProgression } from "@/lib/training/progression";
import { findPlanExercise, type AdaptationRecord, type PlanStore } from "@/stores/plan-store";
import type { WorkoutStore } from "@/stores/workout-store";

// Trainingsabschluss: Session speichern, doppelte Progression je Planübung anwenden, nächsten Tag vormerken.

export interface CompletionResult {
  session: CompletedSession;
  adaptations: AdaptationRecord[];
}

export async function completeWorkout(deps: {
  db: GymDB;
  workout: WorkoutStore;
  plans: PlanStore;
  sessionRpe: number | null;
}): Promise<CompletionResult> {
  const session = deps.workout.getState().finish({ sessionRpe: deps.sessionRpe });
  await saveSession(deps.db, session);

  const adaptations: AdaptationRecord[] = [];
  const plan = deps.plans.getState().plan;
  if (!plan || session.planId !== plan.id) return { session, adaptations };

  for (const logged of session.exercises) {
    if (!logged.planExerciseId) continue;
    const found = findPlanExercise(plan, logged.planExerciseId);
    const exercise = getExerciseById(logged.exerciseId);
    if (!found || !exercise) continue;

    // Körpergewicht/Band ohne Zusatzlast: Steigerung über Wiederholungen bzw. Variante, nicht über kg
    const usedLoad = logged.sets.some((s) => (s.weightKg ?? 0) > 0);
    if (exercise.trackingType !== "weight_reps" && !usedLoad) continue;

    const history = await recentPerformances(deps.db, logged.exerciseId, 2);
    const p = found.exercise;
    const result = evaluateDoubleProgression(
      {
        repsMin: p.repsMin,
        repsMax: p.repsMax,
        rirMin: p.rirMin,
        rirMax: p.rirMax,
        targetLoadKg: p.targetLoadKg,
        loadIncrementKg: exercise.loadIncrementKg,
      },
      history.map((h) => h.sets),
    );
    if (result.proposal) {
      adaptations.push(deps.plans.getState().applyLoadChange(p.id, result.proposal, result.targetLoadKg));
    } else if (result.targetLoadKg !== p.targetLoadKg) {
      deps.plans.getState().setTargetLoad(p.id, result.targetLoadKg);
    }
  }

  const day = plan.days.find((d) => d.id === session.planDayId);
  if (day) deps.plans.getState().advanceDay(day.dayIndex);
  return { session, adaptations };
}
