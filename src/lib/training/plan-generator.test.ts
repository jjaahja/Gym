import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { TRACKED_MUSCLES, type TrackedMuscle } from "@/data/catalog/muscles";
import { getExercise, isExerciseAvailable, primaryMuscles } from "@/lib/catalog";
import { DB_ENUMS } from "@/lib/db/enums";
import { resolveMuscleGuidelines } from "@/lib/science";
import { generatePlan, type PlanInput } from "./plan-generator";

const presets = Object.entries(EQUIPMENT_PRESETS) as [keyof typeof EQUIPMENT_PRESETS, readonly string[]][];
const PRIORITIES: TrackedMuscle[][] = [[], ["side_delts", "glutes"]];

const matrix: PlanInput[] = [];
for (let days = 1; days <= 7; days++)
  for (const goal of DB_ENUMS.training_goal)
    for (const experience of DB_ENUMS.experience_level)
      for (const [, equipment] of presets)
        for (const sessionDurationMin of [45, 75])
          for (const priorityMuscles of PRIORITIES)
            matrix.push({
              goal,
              experience,
              daysPerWeek: days,
              sessionDurationMin,
              equipment: equipment as PlanInput["equipment"],
              priorityMuscles,
            });

const plans = matrix.map((input) => ({ input, plan: generatePlan(input) }));
const label = (i: PlanInput) =>
  `${i.daysPerWeek}d/${i.goal}/${i.experience}/${i.equipment.length}eq/${i.sessionDurationMin}min/${i.priorityMuscles?.join("+") || "-"}`;

describe("Plan-Generator – gilt für alle Kombinationen", () => {
  it(`erzeugt ${matrix.length} Pläne`, () => {
    expect(plans.length).toBe(756);
  });

  it("wählt den Split nach Trainingstagen und nutzt höchstens 6 Tage", () => {
    for (const { input, plan } of plans) {
      const expected = input.daysPerWeek <= 3 ? "full_body" : input.daysPerWeek === 4 ? "upper_lower" : input.daysPerWeek === 5 ? "custom" : "push_pull_legs";
      expect(plan.splitType, label(input)).toBe(expected);
      expect(plan.days.length).toBe(Math.min(input.daysPerWeek, 6));
    }
  });

  it("nimmt nur Übungen, die mit Ausstattung und Erfahrung machbar sind – keine doppelt am selben Tag", () => {
    for (const { input, plan } of plans)
      for (const day of plan.days) {
        const slugs = day.exercises.map((e) => e.exerciseSlug);
        expect(new Set(slugs).size, label(input)).toBe(slugs.length);
        for (const e of day.exercises) {
          const exercise = getExercise(e.exerciseSlug)!;
          expect(isExerciseAvailable(exercise, input.equipment, input.experience), `${label(input)} ${e.exerciseSlug}`).toBe(true);
        }
      }
  });

  it("plant 2 bis 5 Sätze pro Übung (Einsteiger höchstens 4)", () => {
    for (const { input, plan } of plans)
      for (const day of plan.days)
        for (const e of day.exercises) {
          expect(e.sets).toBeGreaterThanOrEqual(2);
          expect(e.sets).toBeLessThanOrEqual(input.experience === "beginner" ? 4 : 5);
        }
  });

  it("hält das Zeitbudget ein oder warnt ausdrücklich", () => {
    for (const { input, plan } of plans)
      for (const day of plan.days)
        if (day.estimatedMinutes > input.sessionDurationMin)
          expect(plan.warnings.some((w) => w.startsWith(day.name)), label(input)).toBe(true);
  });

  it("überschreitet nie das Wochen-Maximum und nie das Maximum pro Einheit", () => {
    for (const { input, plan } of plans) {
      for (const v of plan.volume) expect(v.plannedSets, `${label(input)} ${v.muscle}`).toBeLessThanOrEqual(v.max + 1e-9);
      for (const day of plan.days)
        for (const muscle of TRACKED_MUSCLES) {
          const cap = resolveMuscleGuidelines(muscle, input.goal, input.experience).session_volume!.max!;
          const direct = day.exercises
            .filter((e) => primaryMuscles(getExercise(e.exerciseSlug)!).includes(muscle))
            .reduce((sum, e) => sum + e.sets + (e.lastSetTechnique ? 0.5 : 0), 0);
          expect(direct, `${label(input)} ${day.name} ${muscle}`).toBeLessThanOrEqual(cap);
        }
    }
  });

  it("warnt, wenn ein Muskel unter dem Mindestvolumen bleibt", () => {
    for (const { input, plan } of plans)
      if (plan.volume.some((v) => v.status === "below"))
        expect(plan.warnings.some((w) => w.startsWith("Unter dem Mindestvolumen")), label(input)).toBe(true);
  });

  it("setzt Pump-Finisher nur bei Muskelaufbau, nicht für Einsteiger, nur an Isolationsübungen (ohne Rumpf), max. 2 pro Tag", () => {
    for (const { input, plan } of plans)
      for (const day of plan.days) {
        const withTechnique = day.exercises.filter((e) => e.lastSetTechnique);
        expect(withTechnique.length).toBeLessThanOrEqual(2);
        for (const e of withTechnique) {
          const exercise = getExercise(e.exerciseSlug)!;
          expect(input.goal).toBe("hypertrophy");
          expect(input.experience).not.toBe("beginner");
          expect(exercise.mechanic).toBe("isolation");
          expect(exercise.movementPattern.startsWith("core_")).toBe(false);
        }
      }
  });

  it("stellt Grundübungen vor Isolationsübungen", () => {
    for (const { plan } of plans)
      for (const day of plan.days) {
        const mechanics = day.exercises.map((e) => getExercise(e.exerciseSlug)!.mechanic);
        const firstIsolation = mechanics.indexOf("isolation");
        if (firstIsolation >= 0) expect(mechanics.slice(firstIsolation)).not.toContain("compound");
      }
  });

  it("übernimmt Wiederholungen, RIR und Pause aus den Richtwerten", () => {
    for (const { plan } of plans)
      for (const day of plan.days)
        for (const e of day.exercises) {
          expect(e.repsMin).toBeLessThanOrEqual(e.repsMax);
          expect(e.rirMin).toBeLessThanOrEqual(e.rirMax);
          expect(e.restSeconds).toBeGreaterThanOrEqual(30);
          expect(e.guidelineKeys.length).toBe(4);
        }
  });
});

describe("Plan-Generator – Qualität", () => {
  it("bringt im Studio ab 3 Tagen à 75 min jeden Muskel mindestens auf das Mindestvolumen", () => {
    for (const { input, plan } of plans) {
      if (input.equipment !== EQUIPMENT_PRESETS.gym || input.daysPerWeek < 3 || input.sessionDurationMin < 75) continue;
      const below = plan.volume.filter((v) => v.status === "below").map((v) => `${v.muscle} ${v.plannedSets}/${v.min}`);
      expect(below, label(input)).toEqual([]);
    }
  });

  it("gibt Prioritätsmuskeln mindestens so viel Volumen wie ohne Priorität", () => {
    for (let i = 0; i < plans.length; i += 2) {
      const without = plans[i];
      const withPrio = plans[i + 1];
      expect(withPrio.input.priorityMuscles).toEqual(["side_delts", "glutes"]);
      for (const muscle of ["side_delts", "glutes"] as const) {
        const a = without.plan.volume.find((v) => v.muscle === muscle)!.plannedSets;
        const b = withPrio.plan.volume.find((v) => v.muscle === muscle)!.plannedSets;
        expect(b, `${label(withPrio.input)} ${muscle}`).toBeGreaterThanOrEqual(a);
      }
    }
  });

  it("ist deterministisch", () => {
    const input = matrix[700];
    expect(generatePlan(input)).toEqual(generatePlan(input));
  });

  it("schließt gemiedene Übungen aus und bevorzugt Favoriten", () => {
    const base: PlanInput = { goal: "hypertrophy", experience: "intermediate", daysPerWeek: 4, sessionDurationMin: 75, equipment: EQUIPMENT_PRESETS.gym };
    const avoided = generatePlan({ ...base, avoidExercises: ["dips", "leg-press", "lat-pulldown"] });
    const used = avoided.days.flatMap((d) => d.exercises.map((e) => e.exerciseSlug));
    expect(used).not.toContain("dips");
    expect(used).not.toContain("leg-press");
    expect(used).not.toContain("lat-pulldown");

    const fav = generatePlan({ ...base, favoriteExercises: ["incline-dumbbell-press"] });
    expect(fav.days.flatMap((d) => d.exercises.map((e) => e.exerciseSlug))).toContain("incline-dumbbell-press");
  });

  it("bevorzugt für Fortgeschrittene im Studio belastbare Beinübungen statt Goblet Squats", () => {
    const plan = generatePlan({ goal: "hypertrophy", experience: "intermediate", daysPerWeek: 4, sessionDurationMin: 75, equipment: EQUIPMENT_PRESETS.gym });
    const lower = plan.days.filter((d) => d.type === "lower").flatMap((d) => d.exercises.map((e) => e.exerciseSlug));
    expect(lower).not.toContain("goblet-squat");
    expect(lower.some((s) => ["leg-press", "barbell-back-squat"].includes(s))).toBe(true);
  });

  it("warnt bei 7 Tagen und bei unpassendem Wunsch-Split", () => {
    const base: PlanInput = { goal: "hypertrophy", experience: "intermediate", daysPerWeek: 7, sessionDurationMin: 60, equipment: EQUIPMENT_PRESETS.gym };
    expect(generatePlan(base).warnings.some((w) => w.includes("Ruhetag"))).toBe(true);
    const ppl = generatePlan({ ...base, daysPerWeek: 2, preferredSplit: "push_pull_legs" });
    expect(ppl.splitType).toBe("full_body");
    expect(ppl.warnings.some((w) => w.includes("mindestens 3 Tage"))).toBe(true);
  });
});
