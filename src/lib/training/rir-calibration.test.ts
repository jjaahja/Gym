import { describe, expect, it } from "vitest";
import { actualRir, calibrationSuitable, correctRir, myoContinues, rirBias, validateCalibration, type Calibration } from "./rir-calibration";

const cal = (i: number, predictedRir: number, stopReps: number, failureReps: number): Calibration => ({
  id: `c${i}`,
  exerciseId: "e",
  performedOn: "2026-11-01",
  weightKg: 40,
  stopReps,
  predictedRir,
  failureReps,
  createdAt: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
});

describe("RIR-Check", () => {
  it("berechnet den tatsächlichen RIR und prüft die Eingaben", () => {
    expect(actualRir({ stopReps: 10, failureReps: 13 })).toBe(3);
    expect(validateCalibration({ stopReps: 10, predictedRir: 2, failureReps: 9 })).toMatch(/mindestens/);
    expect(validateCalibration({ stopReps: 10, predictedRir: 2, failureReps: 12 })).toBeNull();
  });

  it("korrigiert erst ab 3 Tests, gerundet und begrenzt", () => {
    expect(rirBias([])).toBeNull();
    const two = [cal(1, 2, 10, 13), cal(2, 1, 10, 12)];
    expect(rirBias(two)).toEqual({ mean: 1, count: 2, correction: 0 });
    const three = [...two, cal(3, 2, 8, 11)];
    expect(rirBias(three)).toMatchObject({ count: 3, correction: 1 });
    const big = [cal(1, 0, 5, 12), cal(2, 0, 5, 12), cal(3, 0, 5, 12)];
    expect(rirBias(big)!.correction).toBe(2);
    const over = [cal(1, 3, 10, 10), cal(2, 3, 10, 10), cal(3, 3, 10, 11)];
    expect(rirBias(over)!.correction).toBe(-1);
  });

  it("nimmt nur die letzten 10 Tests", () => {
    const old = Array.from({ length: 10 }, (_, i) => cal(i, 0, 10, 15));
    const recent = Array.from({ length: 10 }, (_, i) => cal(i + 15, 2, 10, 12));
    expect(rirBias([...old, ...recent])!.mean).toBe(0);
  });

  it("korrigiert geschätzte RIR-Werte, Versagen bleibt Versagen", () => {
    const sets = [
      { setType: "working" as const, weightKg: 40, reps: 10, rir: 2 },
      { setType: "working" as const, weightKg: 40, reps: 12, rir: 0 },
      { setType: "working" as const, weightKg: 40, reps: 9, rir: null },
    ];
    expect(correctRir(sets, 1).map((s) => s.rir)).toEqual([3, 0, null]);
    expect(correctRir(sets, -1).map((s) => s.rir)).toEqual([1, 0, null]);
  });

  it("nur für Übungen ohne Risiko beim Versagen", () => {
    expect(calibrationSuitable({ equipment: ["cable"], systemicFatigue: 1 })).toBe(true);
    expect(calibrationSuitable({ equipment: ["barbell", "bench"], systemicFatigue: 3 })).toBe(false);
    expect(calibrationSuitable({ equipment: ["machine"], systemicFatigue: 4 })).toBe(false);
  });
});

describe("Myo-Reps", () => {
  it("weiter bis die Wiederholungen unter 3 fallen, höchstens 5 Mini-Sätze", () => {
    expect(myoContinues([])).toBe(true);
    expect(myoContinues([5, 4])).toBe(true);
    expect(myoContinues([5, 2])).toBe(false);
    expect(myoContinues([5, 5, 4, 4, 3])).toBe(false);
  });
});
