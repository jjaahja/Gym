import { describe, expect, it } from "vitest";
import { expectedRepsAt, loadFor, strengthOf, suggestLoad, type LoadSuggestionInput } from "./load-suggestion";
import type { LoggedSetLike } from "./progression";

const set = (weightKg: number, reps: number, rir: number | null, setType: LoggedSetLike["setType"] = "working"): LoggedSetLike => ({
  setType,
  weightKg,
  reps,
  rir,
});

const base: LoadSuggestionInput = {
  mode: "failure_last_set",
  repsMin: 8,
  repsMax: 12,
  rirMin: 1,
  rirMax: 3,
  sets: 3,
  loadIncrementKg: 2.5,
  targetLoadKg: null,
  heavyCompound: false,
  previous: [],
  today: [],
};

describe("Gewichtsvorschlag aus der bisherigen Leistung", () => {
  it("rechnet Gewicht ↔ Wiederholungen über die RIR-korrigierte Epley-Beziehung", () => {
    const strength = strengthOf(set(60, 10, 2))!;
    expect(strength).toBeCloseTo(84); // 60 × (1 + 12/30)
    expect(expectedRepsAt(strength, 60, 0)).toBeCloseTo(12);
    expect(loadFor(strength, 10, 2)).toBeCloseTo(60);
    expect(strengthOf(set(60, 10, 2, "warmup"))).toBeNull();
  });

  it("behält das bisherige Gewicht, wenn es beim Ziel im Wiederholungsbereich liegt", () => {
    const s = suggestLoad({ ...base, previous: [set(60, 10, 2), set(60, 9, 1)] });
    expect(s).toMatchObject({ weightKg: 60, change: "same", lastSet: false, effortLabel: "1–2 im Tank" });
    expect(s.expectedReps).toBe(11); // 84 → 60 kg bei 1,5 im Tank: 10,5
    expect(s.reason).toBe("Letztes Mal: 60 kg × 10 (2 im Tank) → ca. 11 Wdh., 1–2 im Tank");
  });

  it("macht schwerer, wenn es mit dem alten Gewicht über dem Bereich läge", () => {
    // 60 × 12 bei 4 im Tank → 16 bis zum Versagen (92 kg 1RM); Ziel Mitte (10) bei 1,5 im Tank → 66,5 → 67,5 kg
    const s = suggestLoad({ ...base, previous: [set(60, 12, 4)] });
    expect(s).toMatchObject({ weightKg: 67.5, change: "increase", expectedReps: 9 });
    expect(s.reason).toContain("mit 60 kg wären es über 12 Wiederholungen");
  });

  it("macht leichter, wenn es unter dem Bereich läge", () => {
    const s = suggestLoad({ ...base, previous: [set(80, 5, 0)] });
    expect(s.change).toBe("decrease");
    expect(s.weightKg).toBeLessThan(80);
    expect(s.expectedReps).toBeGreaterThanOrEqual(8);
    expect(s.expectedReps).toBeLessThanOrEqual(12);
  });

  it("letzter Satz: bis zum Versagen – bei schweren Grundübungen 1 im Tank", () => {
    const today = [set(60, 11, 2), set(60, 10, 1)];
    const isolation = suggestLoad({ ...base, today });
    expect(isolation).toMatchObject({ lastSet: true, targetRir: 0, effortLabel: "bis zum Versagen", weightKg: 60 });
    // letzter Satz 60 × 10 bei 1 im Tank → 11 bis zum Versagen
    expect(isolation.reason).toBe("Letzter Satz: 60 kg × 10 (1 im Tank) → letzter Satz bis zum Versagen, ca. 11 Wdh.");

    const heavy = suggestLoad({ ...base, today, heavyCompound: true });
    expect(heavy).toMatchObject({ lastSet: true, targetRir: 1, effortLabel: "1 im Tank (schwere Grundübung)" });
  });

  it("nutzt heute den letzten Satz (inkl. Ermüdung) statt des Bestwerts vom letzten Mal", () => {
    // letztes Mal stark, heute deutlich schwächer → leichter
    const s = suggestLoad({ ...base, previous: [set(60, 12, 3)], today: [set(60, 6, 0)] });
    expect(s.change).toBe("decrease");
    expect(s.reason.startsWith("Letzter Satz: 60 kg × 6 (0 im Tank)")).toBe(true);
  });

  it("Modus Plan-Ziel: RIR-Bereich des Plans in jedem Satz, auch im letzten", () => {
    const s = suggestLoad({ ...base, mode: "plan", today: [set(60, 11, 2), set(60, 10, 2)] });
    expect(s).toMatchObject({ lastSet: true, targetRir: 2, effortLabel: "1–3 im Tank", weightKg: 60 });
    expect(s.expectedReps).toBe(10);
  });

  it("startet mit dem Zielgewicht aus der doppelten Progression, wenn es passt", () => {
    // Plan hat nach oben gesteigert (62,5); 60 × 12 bei 1 → 13 bis Versagen → mit 62,5 kg ca. 9,8 Wdh. bei 1,5
    const s = suggestLoad({ ...base, targetLoadKg: 62.5, previous: [set(60, 12, 1)] });
    expect(s).toMatchObject({ weightKg: 62.5, change: "same" });
    expect(s.expectedReps).toBe(10);
  });

  it("ohne Daten: Zielgewicht aus dem Plan oder Hinweis zum Bereich", () => {
    expect(suggestLoad({ ...base, targetLoadKg: 50 })).toMatchObject({ weightKg: 50, reason: "Zielgewicht aus dem Plan" });
    expect(suggestLoad(base)).toMatchObject({ weightKg: null, reason: "Wähle ein Gewicht, mit dem du 8–12 Wiederholungen schaffst" });
  });

  it("rundet auf die kleinste Steigerung der Übung (z. B. 2 kg bei Kurzhanteln)", () => {
    const s = suggestLoad({ ...base, loadIncrementKg: 2, previous: [set(20, 15, 3)] });
    expect(s.weightKg! % 2).toBe(0);
  });
});
