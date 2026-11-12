import { describe, expect, it } from "vitest";
import { changedFields, describeChange, freshOrderIndexes, planSupersets, supersetNumbers, validateFields, type PlanExerciseFields } from "./plan-edit";

const base: PlanExerciseFields = { sets: 3, repsMin: 8, repsMax: 12, rirMin: 1, rirMax: 2, restSeconds: 120, lastSetTechnique: null };

describe("freshOrderIndexes", () => {
  it("kollidiert nie mit bestehenden Positionen und wächst nicht endlos", () => {
    let current = [0, 1, 2, 3];
    for (let round = 0; round < 20; round++) {
      const next = freshOrderIndexes(current, current.length);
      expect(next.some((n) => current.includes(n))).toBe(false);
      expect(new Set(next).size).toBe(next.length);
      expect(Math.max(...next)).toBeLessThan(current.length * 3);
      current = next;
    }
  });

  it("berücksichtigt eine zusätzliche (wieder eingefügte) Übung", () => {
    const next = freshOrderIndexes([0, 1, 2], 4);
    expect(next).toEqual([3, 4, 5, 6]);
    expect(freshOrderIndexes([5, 6, 7, 9], 4)).toEqual([0, 1, 2, 3]);
    expect(freshOrderIndexes([], 2)).toEqual([0, 1]);
  });
});

describe("Supersätze im Plan", () => {
  it("bildet Gruppen nur aus direkt aufeinanderfolgenden Übungen mit gleicher Nummer", () => {
    const groups = planSupersets([
      { id: "a", supersetGroup: 1 },
      { id: "b", supersetGroup: 1 },
      { id: "c", supersetGroup: null },
      { id: "d", supersetGroup: 2 },
      { id: "e", supersetGroup: 2 },
      { id: "f", supersetGroup: 2 },
      { id: "g", supersetGroup: 3 },
    ]);
    expect(groups).toEqual([["a", "b"], ["d", "e", "f"]]);
    expect([...supersetNumbers(groups)]).toEqual([["a", 1], ["b", 1], ["d", 2], ["e", 2], ["f", 2]]);
  });
});

describe("Änderungen", () => {
  it("prüft Grenzen und Reihenfolge von/bis", () => {
    expect(validateFields(base)).toBeNull();
    expect(validateFields({ ...base, sets: 0 })).toMatch(/Sätze/);
    expect(validateFields({ ...base, repsMin: 13 })).toMatch(/Wiederholungen/);
    expect(validateFields({ ...base, rirMin: 3 })).toMatch(/RIR/);
    expect(validateFields({ ...base, restSeconds: 5 })).toMatch(/Pause/);
    expect(validateFields({ ...base, lastSetTechnique: "warmup" })).toMatch(/Technik/);
  });

  it("nimmt nur geänderte Felder und beschreibt sie", () => {
    const patch = changedFields(base, { sets: 4, repsMin: 8, restSeconds: 90, lastSetTechnique: "myo_reps" });
    expect(patch).toEqual({ sets: 4, restSeconds: 90, lastSetTechnique: "myo_reps" });
    expect(describeChange(base, { ...base, ...patch, repsMax: 15 })).toBe(
      "Sätze 3 → 4 · Wdh. 8–12 → 8–15 · Pause 120 → 90 s · Technik im letzten Satz: keine → Myo-Reps",
    );
  });
});
