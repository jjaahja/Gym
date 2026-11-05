import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { getExercise } from "@/lib/catalog";
import {
  ADAPTATION_MODE,
  buildDeloadWeek,
  buildSwapProposal,
  checkDeload,
  detectStagnation,
  estimateOneRepMax,
  evaluateDoubleProgression,
  findReplacement,
  isRegressing,
  mesocycleTrend,
  reviewVolume,
  suggestNextSet,
  swapTrigger,
  type LoggedSetLike,
  type Prescription,
  type SessionPerformance,
} from "./progression";

const p: Prescription = { repsMin: 6, repsMax: 10, rirMin: 1, rirMax: 3, targetLoadKg: 80, loadIncrementKg: 2.5 };
const set = (weightKg: number, reps: number, rir: number | null = 2): LoggedSetLike => ({ setType: "working", weightKg, reps, rir });

describe("e1RM", () => {
  it("rechnet wie die DB-Spalte", () => {
    expect(estimateOneRepMax(set(82.5, 8, 2))).toBe(110);
    expect(estimateOneRepMax(set(82.5, 6, 5))).toBeNull();
    expect(estimateOneRepMax({ setType: "dropset", weightKg: 60, reps: 8, rir: 0 })).toBeNull();
    expect(estimateOneRepMax(set(40, 15, 1))).toBeNull();
  });
});

describe("Vorschlag für den nächsten Satz", () => {
  it("startet mit dem Zielgewicht", () => {
    expect(suggestNextSet(p, [])).toMatchObject({ weightKg: 80, change: "same" });
    expect(suggestNextSet({ ...p, targetLoadKg: null }, []).weightKg).toBeNull();
  });

  it("erhöht bei deutlich mehr Reserve als geplant", () => {
    expect(suggestNextSet(p, [set(80, 10, 5)])).toMatchObject({ weightKg: 82.5, change: "increase" });
  });

  it("senkt bei zu wenig Reserve oder zu wenig Wiederholungen", () => {
    expect(suggestNextSet(p, [set(80, 8, 0)])).toMatchObject({ weightKg: 77.5, change: "decrease" });
    expect(suggestNextSet(p, [set(80, 5, 1)])).toMatchObject({ weightKg: 77.5, change: "decrease" });
  });

  it("hält im Zielbereich und ignoriert Aufwärm- und Technik-Sätze", () => {
    const sets: LoggedSetLike[] = [{ setType: "warmup", weightKg: 40, reps: 10, rir: null }, set(80, 8, 2)];
    expect(suggestNextSet(p, sets)).toMatchObject({ weightKg: 80, change: "same" });
    sets.push({ setType: "dropset", weightKg: 60, reps: 10, rir: 0 });
    expect(suggestNextSet(p, sets).change).toBe("same");
  });
});

describe("Doppelte Progression", () => {
  it("erhöht automatisch, wenn alle Sätze das obere Ende erreichen", () => {
    const r = evaluateDoubleProgression(p, [[set(80, 10), set(80, 10), set(80, 11)]]);
    expect(r.targetLoadKg).toBe(82.5);
    expect(r.proposal).toMatchObject({ type: "increase_load", status: "auto_applied", reason: "progression_achieved" });
  });

  it("hält das Gewicht, solange noch Wiederholungen fehlen", () => {
    const r = evaluateDoubleProgression(p, [[set(80, 10), set(80, 9), set(80, 8)]]);
    expect(r).toEqual({ targetLoadKg: 80, proposal: null });
  });

  it("senkt erst, wenn der erste Satz zweimal in Folge unter der Grenze liegt", () => {
    expect(evaluateDoubleProgression(p, [[set(80, 5)]]).proposal).toBeNull();
    const r = evaluateDoubleProgression(p, [[set(80, 5), set(80, 4)], [set(80, 5), set(80, 4)]]);
    expect(r.targetLoadKg).toBe(77.5);
    expect(r.proposal).toMatchObject({ type: "decrease_load", status: "auto_applied", reason: "regression" });
  });

  it("ändert nichts ohne Arbeitssätze", () => {
    expect(evaluateDoubleProgression(p, [])).toEqual({ targetLoadKg: 80, proposal: null });
  });
});

const perf = (e1rm: number): SessionPerformance => ({ bestE1rmKg: e1rm, topWeightKg: null, totalReps: null, workingSets: 3 });

describe("Leistungsverlauf", () => {
  it("erkennt Stagnation über drei Einheiten", () => {
    expect(detectStagnation([100, 102, 104, 106].map(perf))).toBe(false);
    expect(detectStagnation([100, 106, 105, 106, 104].map(perf))).toBe(true);
    expect(detectStagnation([100, 101].map(perf))).toBe(false);
  });

  it("nutzt bei hohen Wiederholungen Topgewicht und Ø-Wiederholungen", () => {
    const high = (top: number, reps: number): SessionPerformance => ({ bestE1rmKg: null, topWeightKg: top, totalReps: reps, workingSets: 3 });
    expect(detectStagnation([high(20, 45), high(20, 48), high(22.5, 45), high(22.5, 48)])).toBe(false);
  });

  it("erkennt Rückgang und Trend", () => {
    expect(isRegressing([100, 100, 100, 94].map(perf))).toBe(true);
    expect(isRegressing([100, 100, 100, 97].map(perf))).toBe(false);
    expect(mesocycleTrend([100, 101, 103, 104].map(perf))).toBe("up");
    expect(mesocycleTrend([100, 100, 95, 94].map(perf))).toBe("down");
    expect(mesocycleTrend([100, 100, 100, 100.5].map(perf))).toBe("flat");
  });
});

describe("Volumen am Mesozyklus-Ende", () => {
  const base = { muscle: "chest" as const, min: 10, max: 20, jointIssues: false, fatigue: false };

  it("erhöht automatisch um ~20 % bei steigender Leistung, gedeckelt auf das Maximum", () => {
    expect(reviewVolume({ ...base, currentSets: 10, trend: "up" })).toMatchObject({ type: "add_set", status: "auto_applied", after: { weekly_sets: 12 } });
    expect(reviewVolume({ ...base, currentSets: 5, min: 4, trend: "up" })).toMatchObject({ after: { weekly_sets: 6 } });
    expect(reviewVolume({ ...base, currentSets: 19, trend: "up" })).toMatchObject({ after: { weekly_sets: 20 } });
    expect(reviewVolume({ ...base, currentSets: 20, trend: "up" })).toBeNull();
  });

  it("reduziert bei Ermüdung, Gelenkproblemen oder Rückgang – nicht unter das Minimum", () => {
    expect(reviewVolume({ ...base, currentSets: 14, trend: "flat", fatigue: true })).toMatchObject({ type: "remove_set", reason: "high_fatigue", after: { weekly_sets: 12 } });
    expect(reviewVolume({ ...base, currentSets: 14, trend: "flat", jointIssues: true })?.reason).toBe("stimulus_feedback");
    expect(reviewVolume({ ...base, currentSets: 11, trend: "down" })).toMatchObject({ after: { weekly_sets: 10 } });
    expect(reviewVolume({ ...base, currentSets: 10, trend: "down" })).toBeNull();
  });

  it("schlägt über dem Maximum nur vor (Junk Volume) und hebt Unterschreitungen automatisch an", () => {
    expect(reviewVolume({ ...base, currentSets: 24, trend: "up" })).toMatchObject({ status: "suggested", reason: "volume_above_max" });
    expect(reviewVolume({ ...base, currentSets: 8, trend: "flat" })).toMatchObject({ status: "auto_applied", reason: "volume_below_min", after: { weekly_sets: 10 } });
  });

  it("hält bei gleichbleibender Leistung", () => {
    expect(reviewVolume({ ...base, currentSets: 12, trend: "flat" })).toBeNull();
  });
});

describe("Deload", () => {
  const exercises = [{ planExerciseId: "a", sets: 4, rirMin: 1, rirMax: 3 }, { planExerciseId: "b", sets: 3, rirMin: 0, rirMax: 2 }];

  it("halbiert die Sätze und setzt RIR 3–4", () => {
    expect(buildDeloadWeek(exercises)).toEqual([
      { planExerciseId: "a", sets: 2, rirMin: 3, rirMax: 4 },
      { planExerciseId: "b", sets: 2, rirMin: 3, rirMax: 4 },
    ]);
  });

  it("schlägt bei Ermüdungssignalen jederzeit vor – nie automatisch", () => {
    const r = checkDeload({ weeksSinceLastDeload: 2, atMesocycleEnd: false, recentSessionRpe: [9, 9.5], regressingExercises: 2 }, exercises);
    expect(r).toMatchObject({ type: "deload", status: "suggested", reason: "high_fatigue" });
    expect(ADAPTATION_MODE.deload).toBe("suggested");
  });

  it("schlägt am Mesozyklus-Ende nach ≥ 5 Wochen ohne leichtere Woche vor", () => {
    expect(checkDeload({ weeksSinceLastDeload: 5, atMesocycleEnd: true, recentSessionRpe: [7, 7], regressingExercises: 0 }, exercises)?.reason).toBe("mesocycle_end");
    expect(checkDeload({ weeksSinceLastDeload: 4, atMesocycleEnd: true, recentSessionRpe: [7, 7], regressingExercises: 0 }, exercises)).toBeNull();
    expect(checkDeload({ weeksSinceLastDeload: 8, atMesocycleEnd: false, recentSessionRpe: [8, 8], regressingExercises: 1 }, exercises)).toBeNull();
  });
});

describe("Übungswechsel", () => {
  it("wird bei Gelenkbeschwerden sofort, bei Stagnation erst am Mesozyklus-Ende ausgelöst", () => {
    expect(swapTrigger({ jointDiscomfort: [0, 2, 3], stagnating: false, atMesocycleEnd: false })).toBe("stimulus_feedback");
    expect(swapTrigger({ jointDiscomfort: [3, 1], stagnating: false, atMesocycleEnd: false })).toBeNull();
    expect(swapTrigger({ jointDiscomfort: [], stagnating: true, atMesocycleEnd: false })).toBeNull();
    expect(swapTrigger({ jointDiscomfort: [], stagnating: true, atMesocycleEnd: true })).toBe("stagnation");
  });

  const ctx = { goal: "hypertrophy" as const, experience: "intermediate" as const, equipment: EQUIPMENT_PRESETS.gym };

  it("findet Ersatz mit gleichem Muster und Muskel, bevorzugt Dehnungsfokus", () => {
    const pushdown = getExercise("cable-triceps-pushdown")!;
    const replacement = findReplacement(pushdown, ctx)!;
    expect(replacement.movementPattern).toBe("elbow_extension");
    expect(replacement.resistanceProfile).toBe("lengthened");
  });

  it("berücksichtigt Ausstattung, gemiedene Übungen, den Plan und persönliches Feedback", () => {
    const curl = getExercise("cable-curl")!;
    const home = findReplacement(curl, { ...ctx, equipment: EQUIPMENT_PRESETS.home_dumbbells })!;
    expect(home.equipment.every((e) => (EQUIPMENT_PRESETS.home_dumbbells as readonly string[]).includes(e))).toBe(true);

    const withFeedback = findReplacement(curl, {
      ...ctx,
      inPlan: new Set(["ez-bar-curl"]),
      avoid: new Set(["incline-dumbbell-curl"]),
      feedback: new Map([["hammer-curl", { avgPump: 3, avgJointDiscomfort: 0 }]]),
    })!;
    expect(withFeedback.slug).toBe("hammer-curl");
  });

  it("erzeugt einen Vorschlag mit Begründung", () => {
    const r = buildSwapProposal(getExercise("barbell-back-squat")!, getExercise("leg-press")!, "stimulus_feedback");
    expect(r).toMatchObject({ type: "swap_exercise", status: "suggested", guidelineKey: "exercise_variation.planned" });
    expect(r.explanation).toContain("Beinpresse");
  });
});
