import { getExerciseById } from "@/lib/catalog";
import type { CompletedSession, GymDB } from "@/lib/offline/db";
import { allSessions, recentPerformances, saveSession } from "@/lib/offline/history";
import { buildPostWorkoutChecks } from "@/lib/training/mesocycle";
import { evaluateDoubleProgression } from "@/lib/training/progression";
import { findPlanExercise, type AdaptationRecord, type PlanStore } from "@/stores/plan-store";
import type { WorkoutStore } from "@/stores/workout-store";

// Trainingsabschluss: Session speichern, doppelte Progression je Planübung anwenden (nicht in der
// Deload-Woche), Gelenkbeschwerden/Ermüdung prüfen, nächsten Tag vormerken.

export interface CompletionResult {
  session: CompletedSession;
  /** Automatisch angewendet (Last) */
  adaptations: AdaptationRecord[];
  /** Neue Vorschläge (Übungswechsel, Deload) – warten auf Entscheidung */
  suggestions: AdaptationRecord[];
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
  const suggestions: AdaptationRecord[] = [];
  const plan = deps.plans.getState().plan;
  if (!plan || session.planId !== plan.id) return { session, adaptations, suggestions };

  // Deload: bewusst leichter – keine Laständerung, kein Rückschluss auf Leistung
  for (const logged of session.deload ? [] : session.exercises) {
    if (!logged.planExerciseId) continue;
    const found = findPlanExercise(plan, logged.planExerciseId);
    const exercise = getExerciseById(logged.exerciseId);
    if (!found || !exercise) continue;
    // Heute eine Ersatzübung gemacht → Gewicht der Planübung nicht daraus ableiten
    if (found.exercise.exerciseId !== logged.exerciseId) continue;

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

  const current = deps.plans.getState().plan!;
  const checks = buildPostWorkoutChecks({
    plan: current,
    sessions: await allSessions(deps.db),
    now: new Date(session.endedAt),
    adaptations: deps.plans.getState().adaptations,
  });
  for (const swap of checks.swaps) {
    const added = deps.plans.getState().addSuggestion({ proposal: swap.proposal, planExerciseId: swap.planExerciseId });
    if (added) suggestions.push(added);
  }
  if (checks.deload) {
    const added = deps.plans.getState().addSuggestion({ proposal: checks.deload, planExerciseId: null });
    if (added) suggestions.push(added);
  }

  const day = current.days.find((d) => d.id === session.planDayId);
  if (day) deps.plans.getState().advanceDay(day.dayIndex);
  return { session, adaptations, suggestions };
}
