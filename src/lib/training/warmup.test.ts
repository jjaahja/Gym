import { describe, expect, it } from "vitest";
import { getExercise } from "@/lib/catalog";
import { platesPerSide, warmupSets } from "./warmup";

describe("Aufwärmsätze", () => {
  it("Langhantel-Grundübung: leere Stange, dann ~50/70/85 %, gerundet und streng steigend", () => {
    expect(warmupSets(getExercise("barbell-bench-press")!, 80)).toEqual([
      { weightKg: 20, reps: 10 },
      { weightKg: 40, reps: 8 },
      { weightKg: 55, reps: 4 },
      { weightKg: 67.5, reps: 2 },
    ]);
  });

  it("Isolationsübung: ein Satz mit etwa der Hälfte", () => {
    const curl = getExercise("dumbbell-curl")!;
    expect(warmupSets(curl, 14)).toEqual([{ weightKg: Math.round(7 / curl.loadIncrementKg) * curl.loadIncrementKg, reps: 10 }]);
  });

  it("leichtes Arbeitsgewicht: keine doppelten oder zu schweren Sätze, ohne Gewicht nichts", () => {
    const sets = warmupSets(getExercise("barbell-bench-press")!, 30);
    for (let i = 1; i < sets.length; i++) expect(sets[i].weightKg).toBeGreaterThan(sets[i - 1].weightKg);
    for (const s of sets) expect(s.weightKg).toBeLessThan(30);
    expect(warmupSets(getExercise("barbell-bench-press")!, null)).toEqual([]);
    expect(warmupSets(getExercise("plank")!, 20)).toEqual([]);
  });
});

describe("Scheibenrechner", () => {
  it("rechnet Scheiben pro Seite (größte zuerst)", () => {
    expect(platesPerSide(82.5, 20)).toEqual({ plates: [25, 5, 1.25], restKg: 0 });
    expect(platesPerSide(100, 20)).toEqual({ plates: [25, 15], restKg: 0 });
    expect(platesPerSide(20, 20)).toEqual({ plates: [], restKg: 0 });
    expect(platesPerSide(31, 20)).toEqual({ plates: [5], restKg: 1 }); // 1 kg lässt sich nicht stecken
  });
});
