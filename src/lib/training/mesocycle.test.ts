import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { getExercise, getExerciseById, isExerciseAvailable, primaryMuscles } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { createPlanStore, type AdaptationRecord, type AssessmentInput, type StoredPlan } from "@/stores/plan-store";
import { buildMesocycleReview, buildPostWorkoutChecks, distributeVolumeChange, planVolume } from "./mesocycle";
import { generatePlan } from "./plan-generator";

const memory = (): StateStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const assessment: AssessmentInput = {
  goal: "hypertrophy",
  experience: "intermediate",
  trainingAgeMonths: 24,
  daysPerWeek: 4,
  sessionDurationMin: 75,
  preferredSplit: null,
  priorityMuscles: ["side_delts", "lats"],
  equipment: [...EQUIPMENT_PRESETS.gym],
  limitations: "",
};

const START = "2026-09-28T08:00:00.000Z";

function makePlan(): StoredPlan {
  let n = 0;
  const store = createPlanStore({ sink: () => {}, storage: memory, uuid: () => `pe-${++n}`, now: () => new Date(START) });
  return store.getState().createPlan({ userId: null, assessment, generated: generatePlan(assessment) });
}

const allExercises = (plan: StoredPlan) => plan.days.flatMap((d) => d.exercises);
const DAY = 24 * 3600 * 1000;

interface Entry {
  planExerciseId: string;
  weightKg: number;
  reps: number;
  joint?: number | null;
}

let sessionNo = 0;
function session(plan: StoredPlan, dayOffset: number, entries: Entry[], extra: Partial<CompletedSession> = {}): CompletedSession {
  const start = new Date(Date.parse(START) + dayOffset * DAY + 3600_000);
  const id = `session-${++sessionNo}`;
  const exercises = entries.map((e, i) => {
    const pe = allExercises(plan).find((x) => x.id === e.planExerciseId)!;
    return {
      logId: `${id}-log-${i}`,
      exerciseId: pe.exerciseId,
      planExerciseId: pe.id,
      pumpRating: null,
      jointDiscomfort: e.joint ?? null,
      sets: Array.from({ length: pe.sets }, (_, k) => ({
        id: `${id}-${i}-${k}`,
        setIndex: k,
        setType: "working" as const,
        weightKg: e.weightKg,
        reps: e.reps,
        durationSeconds: null,
        rir: 2,
      })),
    };
  });
  return {
    id,
    planId: plan.id,
    planDayId: null,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + 3600_000).toISOString(),
    sessionRpe: 8,
    exerciseIds: exercises.map((e) => e.exerciseId),
    exercises,
    ...extra,
  };
}

const primaryFor = (plan: StoredPlan, muscle: string) =>
  allExercises(plan).filter((e) => primaryMuscles(getExerciseById(e.exerciseId)!).includes(muscle as never));

describe("planVolume", () => {
  it("stimmt mit der Volumenübersicht des Generators überein", () => {
    const plan = makePlan();
    const volume = planVolume(plan.days);
    for (const v of plan.volume) expect(Math.round((volume.get(v.muscle) ?? 0) * 10) / 10).toBe(v.plannedSets);
  });
});

describe("distributeVolumeChange", () => {
  it("verteilt +2 Sätze auf Übungen mit dem Muskel als Primärmuskel, je Übung 2–5 Sätze", () => {
    const plan = makePlan();
    const before = planVolume(plan.days).get("chest")!;
    const changes = distributeVolumeChange(plan, "chest", before + 2);
    const chestIds = new Set(primaryFor(plan, "chest").map((e) => e.id));
    expect(changes.every((c) => chestIds.has(c.planExerciseId) && c.to >= 2 && c.to <= 5)).toBe(true);
    expect(changes.reduce((n, c) => n + c.to - c.from, 0)).toBe(2);
    // Gleichmäßig: keine Übung bekommt beide Sätze, solange andere weniger haben
    expect(changes.every((c) => c.to - c.from === 1)).toBe(true);
  });

  it("reduziert und hält die Grenzen ein", () => {
    const plan = makePlan();
    const before = planVolume(plan.days).get("chest")!;
    const down = distributeVolumeChange(plan, "chest", before - 2);
    expect(down.reduce((n, c) => n + c.to - c.from, 0)).toBe(-2);
    const huge = distributeVolumeChange(plan, "chest", 99);
    expect(huge.every((c) => c.to === 5)).toBe(true);
    expect(distributeVolumeChange(plan, "chest", before)).toEqual([]);
  });
});

describe("Mesozyklus-Auswertung", () => {
  it("erhöht das Volumen bei steigender Leistung und schlägt nach 5 Wochen eine Deload-Woche vor", () => {
    const plan = makePlan();
    const chest = primaryFor(plan, "chest");
    const sessions = [0, 7, 14, 21, 28].map((d, week) =>
      session(plan, d, chest.map((e) => ({ planExerciseId: e.id, weightKg: 40 + week * 2.5, reps: 10 }))),
    );
    const review = buildMesocycleReview({ plan, sessions, now: new Date(Date.parse(START) + 35 * DAY), adaptations: [] });

    expect(review.trends.chest).toBe("up");
    const chestVolume = plan.volume.find((v) => v.muscle === "chest")!;
    const proposal = review.volume.find((p) => p.muscle === "chest");
    if (chestVolume.plannedSets < chestVolume.max) {
      expect(proposal).toMatchObject({ type: "add_set", status: "auto_applied", reason: "mesocycle_end" });
      expect((proposal!.after as { weekly_sets: number }).weekly_sets).toBeGreaterThan(chestVolume.plannedSets);
    }
    // Muskeln ohne Daten: Trend flach → keine Änderung (außer unter dem Minimum)
    expect(review.volume.every((p) => p.muscle === "chest" || p.reason === "volume_below_min" || p.reason === "volume_above_max")).toBe(true);
    expect(review.deload).toMatchObject({ type: "deload", reason: "mesocycle_end", status: "suggested" });
    const after = (review.deload!.after as { exercises: { sets: number; rirMin: number }[] }).exercises;
    expect(after.every((e) => e.rirMin === 3)).toBe(true);
  });

  it("schlägt bei Stagnation am Ende einen Übungswechsel mit gleichem Primärmuskel vor", () => {
    const plan = makePlan();
    const target = primaryFor(plan, "chest")[0];
    const sessions = [0, 7, 14, 21, 28].map((d) => session(plan, d, [{ planExerciseId: target.id, weightKg: 60, reps: 8 }]));
    const review = buildMesocycleReview({ plan, sessions, now: new Date(Date.parse(START) + 35 * DAY), adaptations: [] });
    const swap = review.swaps.find((s) => s.planExerciseId === target.id);
    expect(swap?.proposal).toMatchObject({ type: "swap_exercise", reason: "stagnation", status: "suggested" });
    const replacement = getExercise(String(swap!.proposal.after.exercise_slug))!;
    const current = getExerciseById(target.exerciseId)!;
    expect(primaryMuscles(replacement).some((m) => primaryMuscles(current).includes(m))).toBe(true);
    expect(allExercises(plan).some((e) => e.exerciseSlug === replacement.slug)).toBe(false);
    expect(isExerciseAvailable(replacement, assessment.equipment, assessment.experience)).toBe(true);
  });

  it("löst Gelenkbeschwerden über einen Wechsel statt zusätzlich das Volumen zu senken", () => {
    const plan = makePlan();
    const target = primaryFor(plan, "chest")[0];
    const sessions = [0, 7, 14, 21, 28].map((d, w) =>
      session(plan, d, [{ planExerciseId: target.id, weightKg: 60 + w * 2.5, reps: 8, joint: w >= 3 ? 2 : 0 }]),
    );
    const review = buildMesocycleReview({ plan, sessions, now: new Date(Date.parse(START) + 35 * DAY), adaptations: [] });
    expect(review.swaps.find((s) => s.planExerciseId === target.id)?.proposal.reason).toBe("stimulus_feedback");
    expect(review.volume.find((p) => p.muscle === "chest" && p.reason === "stimulus_feedback")).toBeUndefined();
  });

  it("schlägt bei Stagnation höchstens zwei Wechsel vor – zuerst Übungen mit schwachem Pump", () => {
    const plan = makePlan();
    const all = allExercises(plan);
    const sessions = [0, 7, 14, 21, 28].map((d) =>
      session(plan, d, all.map((e) => ({ planExerciseId: e.id, weightKg: 50, reps: 8 }))),
    );
    // Pump: zweite Übung schwach bewertet
    for (const s of sessions) s.exercises[1].pumpRating = 0;
    for (const s of sessions) for (const e of s.exercises.slice(2)) e.pumpRating = 3;
    const review = buildMesocycleReview({ plan, sessions, now: new Date(Date.parse(START) + 35 * DAY), adaptations: [] });
    const stagnation = review.swaps.filter((s) => s.proposal.reason === "stagnation");
    expect(stagnation).toHaveLength(2);
    expect(stagnation[0].planExerciseId).toBe(all[1].id);
  });
});

describe("Prüfung nach dem Training", () => {
  it("schlägt nach zweimal Gelenkbeschwerden ≥ 2 sofort einen Wechsel vor – nach Ablehnung erst bei neuen Daten", () => {
    const plan = makePlan();
    const target = allExercises(plan)[0];
    const bad = (d: number) => session(plan, d, [{ planExerciseId: target.id, weightKg: 60, reps: 8, joint: 2 }]);
    const sessions = [bad(0), bad(3)];
    const now = new Date(Date.parse(START) + 4 * DAY);
    const checks = buildPostWorkoutChecks({ plan, sessions, now, adaptations: [] });
    expect(checks.swaps).toHaveLength(1);
    expect(checks.swaps[0]).toMatchObject({ planExerciseId: target.id, proposal: { reason: "stimulus_feedback" } });
    expect(checks.deload).toBeNull();

    const rejected: AdaptationRecord = {
      ...checks.swaps[0].proposal,
      id: "a-1",
      planId: plan.id,
      planExerciseId: target.id,
      status: "rejected",
      createdAt: now.toISOString(),
      resolvedAt: now.toISOString(),
    };
    expect(buildPostWorkoutChecks({ plan, sessions: [...sessions, bad(7)], now, adaptations: [rejected] }).swaps).toEqual([]);
    expect(buildPostWorkoutChecks({ plan, sessions: [...sessions, bad(7), bad(10)], now, adaptations: [rejected] }).swaps).toHaveLength(1);
    // Offener Vorschlag → kein Duplikat
    const open = { ...rejected, status: "suggested" as const, resolvedAt: null };
    expect(buildPostWorkoutChecks({ plan, sessions, now, adaptations: [open] }).swaps).toEqual([]);
  });

  it("schlägt bei sinkender Leistung und sehr harten Einheiten eine Deload-Woche vor – Deload-Einheiten zählen nicht", () => {
    const plan = makePlan();
    const [a, b] = allExercises(plan);
    const day = (d: number, w: number, rpe: number, extra: Partial<CompletedSession> = {}) =>
      session(plan, d, [{ planExerciseId: a.id, weightKg: w, reps: 8 }, { planExerciseId: b.id, weightKg: w, reps: 8 }], {
        sessionRpe: rpe,
        ...extra,
      });
    const sessions = [day(0, 60, 8), day(3, 60, 8), day(6, 60, 9.5), day(9, 54, 9.5)];
    const now = new Date(Date.parse(START) + 10 * DAY);
    const checks = buildPostWorkoutChecks({ plan, sessions, now, adaptations: [] });
    expect(checks.deload).toMatchObject({ type: "deload", reason: "high_fatigue" });

    const asDeload = [...sessions.slice(0, 3), { ...sessions[3], deload: true }];
    expect(buildPostWorkoutChecks({ plan, sessions: asDeload, now, adaptations: [] }).deload).toBeNull();
    // Während der Deload-Woche kein weiterer Deload-Vorschlag
    const deloading = { ...plan, deloadWeekStart: new Date(Date.parse(START) + 9.5 * DAY).toISOString() };
    expect(buildPostWorkoutChecks({ plan: deloading, sessions, now, adaptations: [] }).deload).toBeNull();
  });
});
