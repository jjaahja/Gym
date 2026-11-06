import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { getExercise } from "@/lib/catalog";
import { GymDB } from "@/lib/offline/db";
import { FakeServer } from "@/lib/offline/fake-server";
import { saveMeasurement } from "@/lib/offline/measurements";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { planVolume } from "@/lib/training/mesocycle";
import { generatePlan } from "@/lib/training/plan-generator";
import { buildSwapProposal, checkDeload, findReplacement, reviewVolume } from "@/lib/training/progression";
import { completeWorkout } from "@/lib/workout/complete";
import { createPlanStore, type AssessmentInput } from "@/stores/plan-store";
import { createWorkoutStore } from "@/stores/workout-store";

// Gemeinsames Testszenario: Ein Gerät durchläuft Plan, Trainings, Mesozyklus-Abschluss und Körpermaße;
// jeder Outbox-Eintrag landet auf einem Fake-Server.

export const USER = "11111111-2222-4333-8444-555555555555";
export const memory = (): StateStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

export const assessment: AssessmentInput = {
  goal: "hypertrophy",
  experience: "intermediate",
  trainingAgeMonths: 24,
  daysPerWeek: 4,
  sessionDurationMin: 75,
  preferredSplit: null,
  priorityMuscles: ["side_delts", "lats"],
  // bewusst nicht in Katalog-Reihenfolge
  equipment: [...EQUIPMENT_PRESETS.gym].reverse(),
  limitations: "Schulter rechts",
};

export const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

/** Ein Gerät durchläuft Plan, Training, Mesozyklus-Abschluss und Körpermaße; alles landet auf dem Fake-Server. */
export async function deviceHistory() {
  const server = new FakeServer();
  let clock = new Date("2026-11-03T16:00:00.000Z");
  let n = 0;
  const deps = {
    sink: (e: NewOutboxEntry) => server.apply(e),
    storage: memory,
    now: () => clock,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
  const plans = createPlanStore(deps);
  const workout = createWorkoutStore(deps);
  const db = new GymDB(`r-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });

  plans.getState().createPlan({ userId: USER, assessment, generated: generatePlan(assessment) });
  const plan = plans.getState().plan!;
  const day = plan.days[0];

  // Zwei Trainings → Laststeigerung
  for (const reps of [day.exercises[0].repsMax - 1, day.exercises[0].repsMax]) {
    workout.getState().start({ userId: USER, planId: plan.id, planDayId: day.id, planWeek: 1 });
    for (const pe of day.exercises.slice(0, 2)) {
      const log = workout.getState().ensureExercise(pe.exerciseId, pe.id);
      workout.getState().logSet(log, { setType: "warmup", weightKg: 20, reps: 10, rir: null });
      for (let s = 0; s < pe.sets; s++) workout.getState().logSet(log, { weightKg: 62.5, reps, rir: 1.5 });
      workout.getState().rateExercise(log, { pumpRating: 2, jointDiscomfort: 1 });
    }
    clock = new Date(clock.getTime() + 3600_000);
    await completeWorkout({ db, workout, plans, sessionRpe: 7.5 });
    clock = new Date(clock.getTime() + 2 * 24 * 3600_000);
  }

  // Mesozyklus-Abschluss: Volumen automatisch, Wechsel + Deload angenommen, ein Vorschlag abgelehnt, einer offen
  clock = new Date("2026-12-08T07:00:00.123Z");
  const current = plans.getState().plan!;
  const chest = Math.round((planVolume(current.days).get("chest") ?? 0) * 10) / 10;
  const bench = current.days.flatMap((d) => d.exercises).find((e) => e.exerciseSlug === "barbell-bench-press")!;
  const benchExercise = getExercise(bench.exerciseSlug)!;
  const replacement = findReplacement(benchExercise, {
    goal: current.goal,
    experience: current.experience,
    equipment: current.assessment.equipment,
    inPlan: new Set(current.days.flatMap((d) => d.exercises.map((e) => e.exerciseSlug))),
  })!;
  plans.getState().completeMesocycle({
    volume: [reviewVolume({ muscle: "chest", currentSets: chest, min: 10, max: 20, trend: "up", jointIssues: false, fatigue: false })!],
    accepted: [
      { proposal: buildSwapProposal(benchExercise, replacement, "stagnation"), planExerciseId: bench.id },
      {
        proposal: checkDeload({ weeksSinceLastDeload: 5, atMesocycleEnd: true, recentSessionRpe: [], regressingExercises: 0 }, [])!,
        planExerciseId: null,
      },
    ],
    rejected: [
      {
        proposal: reviewVolume({ muscle: "side_delts", currentSets: 22, min: 10, max: 20, trend: "flat", jointIssues: false, fatigue: false })!,
        planExerciseId: null,
      },
    ],
  });
  const other = current.days[1].exercises[0];
  plans.getState().addSuggestion({
    proposal: buildSwapProposal(getExercise(other.exerciseSlug)!, getExercise("cable-fly")!, "stimulus_feedback"),
    planExerciseId: other.id,
  });
  plans.getState().advanceDay(2);

  const mOptions = { userId: USER, sink: deps.sink, uuid: deps.uuid };
  const empty = {
    bodyWeightKg: null, bodyFatPercent: null, shouldersCm: null, chestCm: null, waistCm: null,
    hipsCm: null, armCm: null, thighCm: null, calfCm: null, notes: null,
  };
  await saveMeasurement(db, { ...empty, measuredOn: "2026-11-02", bodyWeightKg: 82.456, waistCm: 84 }, mOptions);
  await saveMeasurement(db, { ...empty, measuredOn: "2026-11-30", armCm: 38.2, notes: "angespannt" }, mOptions);

  return { server, plans, workout, db, deps };
}
