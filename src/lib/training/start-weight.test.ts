import { describe, expect, it } from "vitest";
import { exercises, getExercise } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { BODY_FRACTION, recommendLoad, standardOneRepMax, STRENGTH_RATIO, transferOneRepMax, weightFieldLabel, type RecommendInput } from "./start-weight";

const ex = (slug: string) => getExercise(slug)!;
const session = (date: string, slug: string, sets: { w: number; r: number; rir: number }[]): CompletedSession => ({
  id: `${slug}-${date}`,
  planId: null,
  planDayId: null,
  startedAt: `${date}T17:00:00.000Z`,
  endedAt: `${date}T18:00:00.000Z`,
  sessionRpe: 8,
  exerciseIds: [ex(slug).id],
  exercises: [
    {
      logId: `${slug}-${date}-l`,
      exerciseId: ex(slug).id,
      planExerciseId: null,
      pumpRating: null,
      jointDiscomfort: null,
      sets: sets.map((s, i) => ({ id: `${slug}-${date}-${i}`, setIndex: i, setType: "working" as const, weightKg: s.w, reps: s.r, durationSeconds: null, rir: s.rir })),
    },
  ],
});

const base = (slug: string, over: Partial<RecommendInput> = {}): RecommendInput => ({
  exercise: ex(slug),
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  rirMin: 1,
  rirMax: 2,
  targetLoadKg: null,
  mode: "failure_last_set",
  previous: [],
  today: [],
  history: [],
  bodyWeightKg: 80,
  sex: "male",
  experience: "intermediate",
  correction: 0,
  ...over,
});

describe("Kraftverhältnisse", () => {
  it("decken alle Übungen mit Gewicht ab (außer Zeit/Band/Körpergewicht)", () => {
    const missing = exercises.filter((e) => e.trackingType === "weight_reps" && !e.equipment.includes("resistance_band") && STRENGTH_RATIO[e.slug] == null);
    expect(missing.map((e) => e.slug)).toEqual([]);
    for (const slug of Object.keys(BODY_FRACTION)) expect(ex(slug).trackingType).toBe("bodyweight_reps");
  });

  it("Kraftnorm: Erfahrung und Geschlecht, ohne Angabe vorsichtig wie Frauen", () => {
    const bench = ex("barbell-bench-press");
    const squat = ex("barbell-back-squat");
    expect(standardOneRepMax(bench, { bodyWeightKg: 80, sex: "male", experience: "intermediate" })).toBeCloseTo(80);
    expect(standardOneRepMax(bench, { bodyWeightKg: 80, sex: "female", experience: "intermediate" })).toBeCloseTo(44);
    expect(standardOneRepMax(squat, { bodyWeightKg: 80, sex: "female", experience: "intermediate" })).toBeCloseTo(78);
    expect(standardOneRepMax(bench, { bodyWeightKg: 80, sex: null, experience: "beginner" })).toBeCloseTo(26.4);
    expect(standardOneRepMax(bench, { bodyWeightKg: null, sex: "male", experience: "advanced" })).toBeNull();
  });

  it("Umrechnung aus verwandter Übung mit den meisten gemeinsamen Hauptmuskeln", () => {
    const history = [session("2026-11-02", "barbell-bench-press", [{ w: 80, r: 8, rir: 2 }]), session("2026-11-05", "machine-chest-press", [{ w: 50, r: 10, rir: 2 }])];
    const t = transferOneRepMax(ex("dumbbell-bench-press"), history)!;
    expect(t).not.toBeNull();
    // e1RM Langhantel 80 × (1 + 10/30) ≈ 106,7 → Kurzhantel je Hantel 0,38
    expect(["barbell-bench-press", "machine-chest-press"]).toContain(t.from.slug);
    expect(transferOneRepMax(ex("leg-extension"), history)).toBeNull();
  });
});

describe("Empfehlung je Satz", () => {
  it("eigener Verlauf hat Vorrang (keine Schätzung)", () => {
    const r = recommendLoad(base("dumbbell-bench-press", { previous: [{ setType: "working", weightKg: 30, reps: 10, rir: 2 }] }))!;
    expect(r.estimated).toBe(false);
    expect(r.weightKg).toBe(30);
  });

  it("neue Übung: Startgewicht aus verwandter Übung, etwas leichter, ganzzahlig auf die Steigerung gerundet", () => {
    const history = [session("2026-11-02", "barbell-bench-press", [{ w: 80, r: 8, rir: 2 }])];
    const r = recommendLoad(base("dumbbell-bench-press", { history }))!;
    expect(r.estimated).toBe(true);
    // 106,7 × 0,38 × 0,9 ≈ 36,5 → für ~10 Wdh. bei 1,5 RIR ≈ 26,4 → 26 kg (Schritt 2 kg)
    expect(r.weightKg).toBe(26);
    expect(r.reason).toMatch(/Geschätzt aus Bankdrücken/);
    expect(r.reason).toMatch(/Nach dem ersten Satz passt die App an/);
  });

  it("ohne verwandte Übung: aus Körpergewicht; ohne Körpergewicht keine Empfehlung", () => {
    const r = recommendLoad(base("leg-extension"))!;
    expect(r.estimated).toBe(true);
    expect(r.weightKg).toBeGreaterThan(20);
    expect(r.reason).toMatch(/Körpergewicht \(80 kg\)/);
    expect(recommendLoad(base("leg-extension", { bodyWeightKg: null }))).toBeNull();
    const female = recommendLoad(base("leg-extension", { sex: "female" }))!;
    expect(female.weightKg!).toBeLessThan(r.weightKg!);
  });

  it("nach dem ersten Satz zählt die echte Leistung", () => {
    const r = recommendLoad(base("leg-extension", { today: [{ setType: "working", weightKg: 40, reps: 15, rir: 2 }] }))!;
    expect(r.estimated).toBe(false);
    expect(r.weightKg).toBeGreaterThan(40);
  });

  it("Zeitübungen und Bänder: keine Empfehlung", () => {
    expect(recommendLoad(base("plank"))).toBeNull();
    expect(recommendLoad(base("band-row"))).toBeNull();
  });
});

describe("Körpergewicht + Zusatz", () => {
  it("ohne Verlauf: erst ohne Zusatz", () => {
    const r = recommendLoad(base("dips"))!;
    expect(r).toMatchObject({ bodyweight: true, weightKg: 0, estimated: true });
    expect(recommendLoad(base("dips", { bodyWeightKg: null }))).toBeNull();
    expect(recommendLoad(base("crunch"))).toBeNull();
  });

  it("stark genug → Zusatzgewicht", () => {
    // 80 kg × 0,9 = 72 kg; 12 Wdh. mit 2 im Tank → 1RM ≈ 72 × 1,47 ≈ 105,6 → für ~10 Wdh. bei 1,5 RIR ≈ 76,6 → +5 kg
    const r = recommendLoad(base("dips", { previous: [{ setType: "working", weightKg: 0, reps: 12, rir: 2 }] }))!;
    expect(r.bodyweight).toBe(true);
    expect(r.weightKg).toBe(5);
    expect(r.reason).toBe("Letztes Mal: ohne Zusatz × 12 (2 im Tank) → +5 kg Zusatz, ca. 10 Wdh.");
  });

  it("zu schwach für das Ziel → ohne Zusatz mit Hinweis", () => {
    const r = recommendLoad(base("pull-up", { previous: [{ setType: "working", weightKg: 0, reps: 4, rir: 1 }] }))!;
    expect(r.weightKg).toBe(0);
    expect(r.reason).toMatch(/Ohne Zusatz ca\. \d+ Wdh\. – unter dem Ziel/);
  });
});

describe("Beschriftung", () => {
  it("Kurzhanteln je Hantel, Einzelhantel-Übungen nicht", () => {
    expect(weightFieldLabel(ex("dumbbell-curl"))).toBe("Gewicht je Hantel");
    expect(weightFieldLabel(ex("goblet-squat"))).toBe("Gewicht");
    expect(weightFieldLabel(ex("barbell-bench-press"))).toBe("Gewicht");
    expect(weightFieldLabel(ex("dips"))).toBe("Zusatz");
  });
});
