import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { getExercise } from "@/lib/catalog";
import { catalogId } from "@/lib/db/stable-id";
import { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { planVolume } from "@/lib/training/mesocycle";
import { generatePlan } from "@/lib/training/plan-generator";
import { reviewVolume, type AdaptationProposal } from "@/lib/training/progression";
import { completeWorkout } from "@/lib/workout/complete";
import { createPlanStore, deloadPrescription, mesocyclePosition, type AssessmentInput, type StoredPlan } from "./plan-store";
import { createWorkoutStore } from "./workout-store";

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

function setup(userId: string | null = "user-1") {
  const entries: NewOutboxEntry[] = [];
  let n = 0;
  let clock = new Date("2026-11-02T08:00:00Z");
  const deps = { sink: (e: NewOutboxEntry) => entries.push(e), storage: memory, uuid: () => `id-${++n}`, now: () => clock };
  const plans = createPlanStore(deps);
  const workout = createWorkoutStore(deps);
  const generated = generatePlan(assessment);
  return {
    entries,
    plans,
    workout,
    generated,
    userId,
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

describe("Plan-Store", () => {
  it("speichert den Plan lokal und schreibt die Zeilen in FK-sicherer Reihenfolge", () => {
    const { plans, generated, entries } = setup();
    const plan = plans.getState().createPlan({ userId: "user-1", assessment, generated, timezone: "Europe/Berlin" });

    expect(plans.getState().plan?.id).toBe(plan.id);
    const order = entries.map((e) => `${e.op}:${e.table}`);
    const first = (t: string) => order.findIndex((o) => o.endsWith(`:${t}`));
    expect(first("user_assessments")).toBeLessThan(first("training_plans"));
    expect(order[first("user_equipment")]).toBe("delete:user_equipment");
    expect(first("training_plans")).toBeLessThan(first("plan_days"));
    expect(first("plan_days")).toBeLessThan(first("plan_exercises"));
    expect(order.at(-1)).toBe("upsert:profiles");

    const planRow = entries.find((e) => e.table === "training_plans")!.payload;
    expect(planRow).toMatchObject({ user_id: "user-1", assessment_id: plan.assessmentId, status: "active", split_type: "upper_lower" });
    const assessmentRow = entries.find((e) => e.table === "user_assessments")!.payload;
    expect(assessmentRow.priority_muscle_ids).toEqual([catalogId("muscle", "side_delts"), catalogId("muscle", "lats")]);
    expect(entries.filter((e) => e.table === "user_equipment" && e.op === "upsert")).toHaveLength(assessment.equipment.length);
    expect(entries.filter((e) => e.table === "plan_exercises")).toHaveLength(generated.days.flatMap((d) => d.exercises).length);
    expect(entries.at(-1)!.payload).toMatchObject({ id: "user-1", timezone: "Europe/Berlin" });
  });

  it("archiviert beim neuen Plan zuerst den alten (nur ein aktiver Plan je Nutzer)", () => {
    const { plans, generated, entries } = setup();
    const old = plans.getState().createPlan({ userId: "user-1", assessment, generated });
    entries.length = 0;
    const next = plans.getState().createPlan({ userId: "user-1", assessment, generated });
    expect(entries[0]).toMatchObject({ table: "training_plans", rowId: old.id, payload: { status: "archived" } });
    expect(next.parentPlanId).toBe(old.id);
  });

  it("synchronisiert im Demo-Modus nichts", () => {
    const { plans, generated, entries } = setup(null);
    plans.getState().createPlan({ userId: null, assessment, generated });
    expect(entries).toHaveLength(0);
    expect(plans.getState().plan).not.toBeNull();
  });

  it("rotiert die Trainingstage", () => {
    const { plans, generated } = setup();
    plans.getState().createPlan({ userId: null, assessment, generated });
    plans.getState().advanceDay(0);
    expect(plans.getState().plan?.nextDayIndex).toBe(1);
    plans.getState().advanceDay(3);
    expect(plans.getState().plan?.nextDayIndex).toBe(0);
  });

  it("berechnet Woche, Mesozyklus, Fälligkeit der Auswertung und Deload-Woche", () => {
    const plan = { cycleStartedAt: "2026-11-02T08:00:00Z", mesocycleWeeks: 5, completedMesocycles: 0, deloadWeekStart: null };
    const at = (iso: string) => mesocyclePosition(plan, new Date(iso));
    expect(at("2026-11-02T09:00:00Z")).toEqual({ week: 1, mesocycle: 1, due: false, deload: false });
    expect(at("2026-11-16T09:00:00Z")).toEqual({ week: 3, mesocycle: 1, due: false, deload: false });
    expect(at("2026-12-06T09:00:00Z")).toEqual({ week: 5, mesocycle: 1, due: false, deload: false });
    // Nach 5 Wochen bleibt Woche 5 stehen, bis die Auswertung abgeschlossen ist
    expect(at("2026-12-20T09:00:00Z")).toEqual({ week: 5, mesocycle: 1, due: true, deload: false });
    const deloading = { ...plan, deloadWeekStart: "2026-12-07T10:00:00Z", cycleStartedAt: "2026-12-14T10:00:00Z", completedMesocycles: 1 };
    expect(mesocyclePosition(deloading, new Date("2026-12-09T09:00:00Z"))).toEqual({ week: 1, mesocycle: 2, due: false, deload: true });
    expect(mesocyclePosition(deloading, new Date("2026-12-15T09:00:00Z"))).toEqual({ week: 1, mesocycle: 2, due: false, deload: false });
  });
});

describe("Trainingsabschluss mit Progression", () => {
  async function train(ctx: ReturnType<typeof setup>, db: GymDB, reps: number[], rpe = 8) {
    const plan = ctx.plans.getState().plan!;
    const day = plan.days[0];
    const pe = day.exercises[0];
    ctx.workout.getState().start({ userId: ctx.userId, planId: plan.id, planDayId: day.id });
    const logId = ctx.workout.getState().ensureExercise(pe.exerciseId, pe.id);
    for (const r of reps) ctx.workout.getState().logSet(logId, { weightKg: 60, reps: r, rir: 1 });
    ctx.tick(3600_000);
    return completeWorkout({ db, workout: ctx.workout, plans: ctx.plans, sessionRpe: rpe });
  }

  it("merkt sich das Gewicht, steigert bei vollem Wiederholungsbereich und lässt sich rückgängig machen", async () => {
    const ctx = setup();
    const db = new GymDB(`c-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const pe = () => ctx.plans.getState().plan!.days[0].exercises[0];
    const increment = getExercise(pe().exerciseSlug)!.loadIncrementKg;

    const first = await train(ctx, db, [pe().repsMax - 2, pe().repsMax - 3]);
    expect(first.adaptations).toHaveLength(0);
    expect(pe().targetLoadKg).toBe(60);
    expect(ctx.plans.getState().plan!.nextDayIndex).toBe(1);

    ctx.entries.length = 0;
    const second = await train(ctx, db, [pe().repsMax, pe().repsMax + 1]);
    expect(second.adaptations).toHaveLength(1);
    expect(second.adaptations[0]).toMatchObject({ type: "increase_load", status: "auto_applied" });
    expect(pe().targetLoadKg).toBe(60 + increment);
    const sessionRow = ctx.entries.find((e) => e.table === "workout_sessions" && e.payload.status === "completed");
    expect(sessionRow?.payload.session_rpe).toBe(8);
    const adaptationRow = ctx.entries.find((e) => e.table === "plan_adaptations")!.payload;
    expect(adaptationRow).toMatchObject({ user_id: "user-1", type: "increase_load", guideline_id: catalogId("guideline", "progression.double") });

    ctx.plans.getState().revertAdaptation(second.adaptations[0].id);
    expect(pe().targetLoadKg).toBe(60);
    expect(ctx.plans.getState().adaptations[0].status).toBe("reverted");
    expect(ctx.entries.at(-1)?.payload).toMatchObject({ status: "reverted" });
  });
});

describe("Mesozyklus-Abschluss und Vorschläge", () => {
  const byId = (plan: StoredPlan, id: string) => plan.days.flatMap((d) => d.exercises).find((e) => e.id === id);
  const chestSets = (plan: StoredPlan) => Math.round((planVolume(plan.days).get("chest") ?? 0) * 10) / 10;

  function swapProposal(plan: StoredPlan): { planExerciseId: string; proposal: AdaptationProposal } {
    const pe = plan.days.flatMap((d) => d.exercises).find((e) => e.exerciseSlug === "barbell-bench-press")!;
    return {
      planExerciseId: pe.id,
      proposal: {
        type: "swap_exercise",
        reason: "stagnation",
        status: "suggested",
        before: { exercise_id: pe.exerciseId, exercise_slug: pe.exerciseSlug },
        after: { exercise_id: getExercise("machine-chest-press")!.id, exercise_slug: "machine-chest-press" },
        guidelineKey: "exercise_variation.planned",
        explanation: "Test",
      },
    };
  }

  it("wendet Volumenänderungen an, aktualisiert Übersicht und Dauer und lässt sich rückgängig machen", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const before = chestSets(plan);
    const proposal = reviewVolume({ muscle: "chest", currentSets: before, min: 10, max: 20, trend: "up", jointIssues: false, fatigue: false })!;
    ctx.entries.length = 0;
    ctx.tick(36 * 24 * 3600_000);

    const [record] = ctx.plans.getState().completeMesocycle({ volume: [proposal], accepted: [], rejected: [] });
    const after = ctx.plans.getState().plan!;
    expect(record).toMatchObject({ type: "add_set", status: "auto_applied", muscle: "chest" });
    expect(chestSets(after)).toBe(before + 2);
    expect(after.volume.find((v) => v.muscle === "chest")!.plannedSets).toBe(before + 2);
    expect(after.completedMesocycles).toBe(1);
    expect(after.cycleStartedAt).toBe(new Date(Date.parse(plan.createdAt) + 36 * 24 * 3600_000).toISOString());
    expect(mesocyclePosition(after, new Date(Date.parse(after.cycleStartedAt) + 1000))).toMatchObject({ week: 1, mesocycle: 2, due: false });
    const changedDays = after.days.filter((d, i) => d.estimatedMinutes !== plan.days[i].estimatedMinutes);
    expect(changedDays.length).toBeGreaterThan(0);
    expect(ctx.entries.filter((e) => e.table === "plan_exercises")).toHaveLength(2);
    expect(ctx.entries.at(-1)).toMatchObject({ table: "training_plans", payload: { status: "active" } });
    expect((record.after as { sets: Record<string, number> }).sets).toBeDefined();

    ctx.plans.getState().revertAdaptation(record.id);
    expect(chestSets(ctx.plans.getState().plan!)).toBe(before);
    expect(ctx.plans.getState().adaptations.find((a) => a.id === record.id)?.status).toBe("reverted");
  });

  it("ersetzt bei angenommenem Wechsel die Übung samt Vorgabe – rückgängig stellt das Original wieder her", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const swap = swapProposal(plan);
    ctx.plans.getState().setTargetLoad(swap.planExerciseId, 80);
    const original = byId(ctx.plans.getState().plan!, swap.planExerciseId)!;

    const suggestion = ctx.plans.getState().addSuggestion(swap)!;
    expect(suggestion).toMatchObject({ status: "suggested", resolvedAt: null });
    expect(ctx.plans.getState().addSuggestion(swap)).toBeNull(); // kein Duplikat

    ctx.plans.getState().acceptSuggestion(suggestion.id);
    const replaced = byId(ctx.plans.getState().plan!, swap.planExerciseId)!;
    expect(replaced).toMatchObject({ exerciseSlug: "machine-chest-press", targetLoadKg: null, sets: original.sets, orderIndex: original.orderIndex });
    expect(ctx.entries.findLast((e) => e.table === "plan_exercises")?.payload).toMatchObject({
      id: swap.planExerciseId,
      exercise_id: getExercise("machine-chest-press")!.id,
    });
    const accepted = ctx.plans.getState().adaptations.find((a) => a.id === suggestion.id)!;
    expect(accepted.status).toBe("accepted");

    ctx.plans.getState().revertAdaptation(suggestion.id);
    expect(byId(ctx.plans.getState().plan!, swap.planExerciseId)).toEqual(original);
  });

  it("startet eine angenommene Deload-Woche; am Mesozyklus-Ende beginnt der neue Zyklus danach", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: null, assessment, generated: ctx.generated });
    ctx.tick(35 * 24 * 3600_000);
    const deload: AdaptationProposal = {
      type: "deload",
      reason: "mesocycle_end",
      status: "suggested",
      before: { exercises: [] },
      after: { exercises: [] },
      guidelineKey: "deload.as_needed",
      explanation: "Test",
    };
    const swap = swapProposal(plan);
    const records = ctx.plans.getState().completeMesocycle({
      volume: [],
      accepted: [{ proposal: deload, planExerciseId: null }],
      rejected: [swap],
    });
    expect(records.map((r) => `${r.type}:${r.status}`)).toEqual(["swap_exercise:rejected", "deload:accepted"]);
    expect(ctx.plans.getState().adaptations[0].type).toBe("deload"); // Änderungen oben im Protokoll
    const after = ctx.plans.getState().plan!;
    const now = Date.parse(plan.createdAt) + 35 * 24 * 3600_000;
    expect(after.deloadWeekStart).toBe(new Date(now).toISOString());
    expect(after.cycleStartedAt).toBe(new Date(now + 7 * 24 * 3600_000).toISOString());
    expect(mesocyclePosition(after, new Date(now + 2 * 24 * 3600_000))).toMatchObject({ deload: true, due: false, mesocycle: 2 });
    // Abgelehnter Wechsel ändert nichts am Plan
    expect(byId(after, swap.planExerciseId)!.exerciseSlug).toBe("barbell-bench-press");

    ctx.plans.getState().revertAdaptation(records[1].id);
    expect(ctx.plans.getState().plan).toMatchObject({ deloadWeekStart: null, lastDeloadAt: null, cycleStartedAt: new Date(now).toISOString() });
  });

  it("Deload-Vorgabe: halbe Sätze (aufgerundet), RIR 3–4, keine Intensitätstechnik", () => {
    expect(deloadPrescription({ sets: 3, rirMin: 0, rirMax: 2, lastSetTechnique: "myo_reps" as const })).toEqual({
      sets: 2,
      rirMin: 3,
      rirMax: 4,
      lastSetTechnique: null,
    });
    expect(deloadPrescription({ sets: 1, rirMin: 1, rirMax: 2, lastSetTechnique: null }).sets).toBe(1);
  });

  it("lehnt Vorschläge ab und schließt nicht mehr anwendbare als abgelehnt", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: null, assessment, generated: ctx.generated });
    const swap = swapProposal(plan);
    const a = ctx.plans.getState().addSuggestion(swap)!;
    ctx.plans.getState().rejectSuggestion(a.id);
    expect(ctx.plans.getState().adaptations.find((r) => r.id === a.id)).toMatchObject({ status: "rejected" });
    expect(ctx.plans.getState().adaptations.find((r) => r.id === a.id)?.resolvedAt).not.toBeNull();

    const stale = ctx.plans.getState().addSuggestion({ ...swap, planExerciseId: "gibt-es-nicht" })!;
    ctx.plans.getState().acceptSuggestion(stale.id);
    expect(ctx.plans.getState().adaptations.find((r) => r.id === stale.id)?.status).toBe("rejected");
  });

  it("migriert gespeicherte Pläne von Version 1", async () => {
    const storage = memory();
    const v1Plan = { ...setup().generated, id: "p1", startedAt: "2026-10-01T08:00:00.000Z", days: [], volume: [] };
    storage.setItem("gym-active-plan", JSON.stringify({ state: { plan: v1Plan, adaptations: [] }, version: 1 }));
    const store = createPlanStore({ sink: () => {}, storage: () => storage });
    await store.persist.rehydrate();
    expect(store.getState().plan).toMatchObject({
      cycleStartedAt: "2026-10-01T08:00:00.000Z",
      completedMesocycles: 0,
      deloadWeekStart: null,
      lastDeloadAt: null,
    });
  });
});

describe("Training in der Deload-Woche", () => {
  it("markiert die Einheit, ändert keine Last und synchronisiert is_deload/plan_week", async () => {
    const ctx = setup();
    const db = new GymDB(`d-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const pe = plan.days[0].exercises[0];
    ctx.workout.getState().start({ userId: "user-1", planId: plan.id, planDayId: plan.days[0].id, planWeek: 5, deload: true });
    const logId = ctx.workout.getState().ensureExercise(pe.exerciseId, pe.id);
    for (let i = 0; i < 2; i++) ctx.workout.getState().logSet(logId, { weightKg: 60, reps: pe.repsMax + 2, rir: 4 });
    ctx.tick(3600_000);
    const result = await completeWorkout({ db, workout: ctx.workout, plans: ctx.plans, sessionRpe: 5 });

    expect(result.session.deload).toBe(true);
    expect(result.adaptations).toEqual([]);
    expect(ctx.plans.getState().plan!.days[0].exercises[0].targetLoadKg).toBeNull();
    const row = ctx.entries.find((e) => e.table === "workout_sessions" && e.payload.status === "completed")!.payload;
    expect(row).toMatchObject({ is_deload: true, plan_week: 5 });
    expect(ctx.plans.getState().plan!.nextDayIndex).toBe(1);
  });
});

describe("Wochentage im Plan", () => {
  it("ändert Wochentage, synchronisiert die Tage und verhindert doppelte Tage", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated, weekdays: [1, 2, 4, 5] });
    expect(ctx.entries.find((e) => e.table === "plan_days")!.payload).toMatchObject({ weekday: 1, day_type: "upper" });
    ctx.entries.length = 0;
    ctx.plans.getState().setWeekdays({ [plan.days[3].id]: 6 });
    expect(ctx.plans.getState().plan!.days.map((d) => d.weekday)).toEqual([1, 2, 4, 6]);
    expect(ctx.entries).toEqual([
      expect.objectContaining({ table: "plan_days", op: "upsert", rowId: plan.days[3].id, payload: expect.objectContaining({ weekday: 6 }) }),
    ]);
    expect(() => ctx.plans.getState().setWeekdays({ [plan.days[0].id]: 2 })).toThrow(RangeError);
  });

  it("migriert gespeicherte Pläne von Version 2 (ohne Wochentage)", async () => {
    const storage = memory();
    const { generated } = setup();
    const v2Plan = {
      ...generated, id: "p2", startedAt: "2026-10-01T08:00:00.000Z", cycleStartedAt: "2026-10-01T08:00:00.000Z",
      completedMesocycles: 0, deloadWeekStart: null, lastDeloadAt: null, volume: [],
      days: generated.days.map((d, i) => ({ ...d, id: `d${i}`, exercises: [] })),
    };
    storage.setItem("gym-active-plan", JSON.stringify({ state: { plan: v2Plan, adaptations: [] }, version: 2 }));
    const store = createPlanStore({ sink: () => {}, storage: () => storage });
    await store.persist.rehydrate();
    expect(store.getState().plan!.days.every((d) => d.weekday === null)).toBe(true);
  });
});

describe("Übung tauschen", () => {
  it("tauscht nur für heute: Ersatzübung geloggt, Planübung bekommt keine Laständerung", async () => {
    const ctx = setup();
    const db = new GymDB(`t-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const pe = plan.days[0].exercises[0];
    const substitute = getExercise("machine-chest-press")!;
    ctx.workout.getState().start({ userId: "user-1", planId: plan.id, planDayId: plan.days[0].id });
    ctx.workout.getState().substitute(pe.id, substitute.id);
    expect(ctx.workout.getState().session!.substitutions).toEqual({ [pe.id]: substitute.id });
    const log = ctx.workout.getState().ensureExercise(substitute.id, pe.id);
    for (let i = 0; i < 2; i++) ctx.workout.getState().logSet(log, { weightKg: 50, reps: 20, rir: 1 });
    expect(() => ctx.workout.getState().substitute(pe.id, null)).toThrow(/schon Sätze/);
    ctx.tick(3600_000);
    const result = await completeWorkout({ db, workout: ctx.workout, plans: ctx.plans, sessionRpe: 7 });
    expect(result.session.exercises[0]).toMatchObject({ exerciseId: substitute.id, planExerciseId: pe.id });
    expect(result.adaptations).toEqual([]);
    expect(ctx.plans.getState().plan!.days[0].exercises[0]).toMatchObject({ exerciseId: pe.exerciseId, targetLoadKg: null });
  });

  it("stellt einen leeren Eintrag auf die Ersatzübung um und kann zurückgetauscht werden", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const pe = plan.days[0].exercises[0];
    ctx.workout.getState().start({ userId: "user-1", planId: plan.id, planDayId: plan.days[0].id });
    const log = ctx.workout.getState().ensureExercise(pe.exerciseId, pe.id);
    const set = ctx.workout.getState().logSet(log, { weightKg: 50, reps: 10, rir: 2 });
    ctx.workout.getState().removeSet(log, set);
    ctx.entries.length = 0;
    const substitute = getExercise("machine-chest-press")!;
    ctx.workout.getState().substitute(pe.id, substitute.id);
    expect(ctx.workout.getState().session!.exercises[0].exerciseId).toBe(substitute.id);
    expect(ctx.entries.at(-1)).toMatchObject({ table: "exercise_logs", payload: { exercise_id: substitute.id, plan_exercise_id: pe.id } });
    ctx.workout.getState().substitute(pe.id, null);
    expect(ctx.workout.getState().session!.substitutions).toEqual({});
  });

  it("tauscht dauerhaft im Plan – mit eigener Vorgabe, Protokoll und Rückgängig", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const pe = plan.days.flatMap((d) => d.exercises).find((e) => e.exerciseSlug === "barbell-bench-press")!;
    ctx.plans.getState().setTargetLoad(pe.id, 80);
    const record = ctx.plans.getState().swapExercise(pe.id, "dumbbell-bench-press")!;
    expect(record).toMatchObject({ type: "swap_exercise", reason: "user_request", status: "accepted" });
    expect(record.explanation).toMatch(/Im Training getauscht: Bankdrücken/);
    const swapped = ctx.plans.getState().plan!.days.flatMap((d) => d.exercises).find((e) => e.id === pe.id)!;
    expect(swapped).toMatchObject({ exerciseSlug: "dumbbell-bench-press", targetLoadKg: null, sets: pe.sets });
    expect(ctx.plans.getState().swapExercise(pe.id, "dumbbell-bench-press")).toBeNull(); // gleiche Übung
    ctx.plans.getState().revertAdaptation(record.id);
    expect(ctx.plans.getState().plan!.days.flatMap((d) => d.exercises).find((e) => e.id === pe.id)).toMatchObject({
      exerciseSlug: "barbell-bench-press",
      targetLoadKg: 80,
    });
  });
});

describe("Übung im Training entfernen", () => {
  it("nur heute: Sätze weg (Server: exercise_logs löschen), Planübung für heute ausgeblendet, Plan unverändert", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const day = plan.days[0];
    const [first, second] = day.exercises;
    ctx.workout.getState().start({ userId: "user-1", planId: plan.id, planDayId: day.id });
    const log = ctx.workout.getState().ensureExercise(first.exerciseId, first.id);
    ctx.workout.getState().logSet(log, { weightKg: 50, reps: 10, rir: 2 });
    ctx.entries.length = 0;

    ctx.workout.getState().removeExercise({ planExerciseId: first.id, exerciseLogId: log });
    const session = ctx.workout.getState().session!;
    expect(session.exercises).toEqual([]);
    expect(session.skipped).toEqual([first.id]);
    expect(ctx.entries).toEqual([{ table: "exercise_logs", op: "delete", rowId: log, payload: { id: log } }]);
    expect(ctx.plans.getState().plan).toEqual(plan);

    // Neue Übung danach bekommt keine schon vergebene Position
    const other = ctx.workout.getState().ensureExercise(second.exerciseId, second.id);
    const extra = ctx.workout.getState().addExercise(getExercise("plank")!.id);
    const positions = ctx.workout.getState().session!.exercises.map((e) => e.orderIndex);
    expect(new Set(positions).size).toBe(positions.length);
    expect([other, extra]).toHaveLength(2);
  });

  it("aus dem Plan: Protokoll vor dem Löschen der Planübung, Volumen neu, rückgängig an alter Position", () => {
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const day = plan.days[0];
    const pe = day.exercises[1];
    ctx.plans.getState().setTargetLoad(pe.id, 40);
    const before = ctx.plans.getState().plan!;
    ctx.entries.length = 0;

    const record = ctx.plans.getState().removeExercise(pe.id)!;
    expect(record).toMatchObject({ type: "remove_exercise", reason: "user_request", status: "accepted", planExerciseId: null });
    expect(record.before).toMatchObject({ plan_day_id: day.id, exercise_slug: pe.exerciseSlug, plan_exercise: { id: pe.id, targetLoadKg: 40 } });
    expect(ctx.entries.map((e) => `${e.table}:${e.op}`)).toEqual(["plan_adaptations:upsert", "plan_exercises:delete"]);
    const after = ctx.plans.getState().plan!;
    expect(after.days[0].exercises.map((e) => e.id)).not.toContain(pe.id);
    expect(after.days[0].estimatedMinutes).toBeLessThan(before.days[0].estimatedMinutes);
    expect(ctx.plans.getState().removeExercise(pe.id)).toBeNull(); // schon weg

    ctx.plans.getState().revertAdaptation(record.id);
    const restored = ctx.plans.getState().plan!;
    expect(restored.days[0].exercises.map((e) => e.id)).toEqual(before.days[0].exercises.map((e) => e.id));
    expect(restored.days[0].exercises[1]).toMatchObject({ id: pe.id, targetLoadKg: 40 });
    expect(restored.volume).toEqual(before.volume);
    expect(ctx.entries.at(-2)).toMatchObject({ table: "plan_exercises", op: "upsert", rowId: pe.id });
    expect(ctx.plans.getState().adaptations.find((a) => a.id === record.id)?.status).toBe("reverted");
  });

  it("warnt, wenn ein Muskel danach unter den Wochen-Richtwert fällt – sonst nicht", async () => {
    const { removalWarnings } = await import("@/lib/training/removal");
    const ctx = setup();
    const plan = ctx.plans.getState().createPlan({ userId: "user-1", assessment, generated: ctx.generated });
    const chestPrimary = (slug: string) => getExercise(slug)!.muscles.some((m) => m.role === "primary" && m.muscle === "chest");
    const chestIds = plan.days.flatMap((d) => d.exercises).filter((e) => chestPrimary(e.exerciseSlug)).map((e) => e.id);
    expect(chestIds.length).toBeGreaterThan(1);

    // Plan mit nur noch einer Brustübung: Wer die entfernt, fällt unter 10 Sätze/Woche
    const [last, ...others] = chestIds;
    const thin = { ...plan, days: plan.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => !others.includes(e.id)) })) };
    const warning = removalWarnings(thin, last).find((w) => w.muscle === "chest")!;
    expect(warning.min).toBe(10);
    expect(warning.after).toBeLessThan(warning.before);
    expect(warning.after).toBeLessThan(10);
    expect(warning.after).toBe(Math.round((planVolume(thin.days.map((d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== last) }))).get("chest") ?? 0) * 10) / 10);

    // Übung, deren Muskeln im vollen Plan genug Volumen behalten → keine Warnung für diese Muskeln
    for (const id of plan.days.flatMap((d) => d.exercises).map((e) => e.id))
      for (const w of removalWarnings(plan, id)) expect(w.after).toBeLessThan(w.min);
  });
});
