import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { getExercise } from "@/lib/catalog";
import { catalogId } from "@/lib/db/stable-id";
import { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { generatePlan } from "@/lib/training/plan-generator";
import { completeWorkout } from "@/lib/workout/complete";
import { createPlanStore, mesocyclePosition, type AssessmentInput } from "./plan-store";
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

  it("berechnet Woche und Mesozyklus", () => {
    const plan = { startedAt: "2026-11-02T08:00:00Z", mesocycleWeeks: 5 };
    expect(mesocyclePosition(plan, new Date("2026-11-02T09:00:00Z"))).toEqual({ week: 1, mesocycle: 1 });
    expect(mesocyclePosition(plan, new Date("2026-11-16T09:00:00Z"))).toEqual({ week: 3, mesocycle: 1 });
    expect(mesocyclePosition(plan, new Date("2026-12-07T09:00:00Z"))).toEqual({ week: 1, mesocycle: 2 });
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
