import { describe, expect, it } from "vitest";
import { formatEffort, rirToRpe, rpeToRir } from "@/lib/training/effort";
import { formatWeight, fromDisplayWeight, toDisplayWeight } from "@/lib/units";

describe("Einheiten", () => {
  it("lässt kg unverändert", () => {
    expect(toDisplayWeight(82.5, "metric")).toBe(82.5);
    expect(fromDisplayWeight(82.5, "metric")).toBe(82.5);
  });

  it("rechnet kg ↔ lb ohne sichtbaren Rundungsdrift um", () => {
    expect(toDisplayWeight(100, "imperial")).toBe(220.5);
    const kg = fromDisplayWeight(100, "imperial");
    expect(kg).toBe(45.36);
    expect(toDisplayWeight(kg, "imperial")).toBe(100);
  });

  it("formatiert deutsch", () => {
    expect(formatWeight(82.5, "metric")).toBe("82,5 kg");
  });
});

describe("RIR/RPE", () => {
  it("nutzt RPE = 10 − RIR", () => {
    expect(rirToRpe(2)).toBe(8);
    expect(rirToRpe(0.5)).toBe(9.5);
    expect(rpeToRir(8.5)).toBe(1.5);
  });

  it("begrenzt auf gültige Skalen", () => {
    expect(rirToRpe(12)).toBe(1);
    expect(rpeToRir(11)).toBe(0);
  });

  it("zeigt die gewählte Skala an", () => {
    expect(formatEffort(2, "rir")).toBe("RIR 2");
    expect(formatEffort(1.5, "rpe")).toBe("RPE 8,5");
  });
});
