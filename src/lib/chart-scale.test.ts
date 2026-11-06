import { describe, expect, it } from "vitest";
import { columnPath, nearestIndex, niceTicks, spreadIndices } from "./chart-scale";

describe("niceTicks", () => {
  it("wählt runde Schritte, die den Bereich einschließen", () => {
    expect(niceTicks(0, 17)).toEqual({ min: 0, max: 20, step: 5, ticks: [0, 5, 10, 15, 20] });
    expect(niceTicks(92.4, 108.7)).toMatchObject({ min: 90, max: 110, step: 5 });
    expect(niceTicks(0.1, 0.9).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 10).ticks).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0, 3, 3).ticks).toEqual([0, 1, 2, 3]);
  });

  it("behandelt gleiche Werte und ungültige Eingaben", () => {
    const flat = niceTicks(80, 80);
    expect(flat.min).toBeLessThan(80);
    expect(flat.max).toBeGreaterThan(80);
    expect(niceTicks(0, 0).ticks.length).toBeGreaterThan(1);
    expect(niceTicks(Number.NaN, 5)).toEqual({ min: 0, max: 1, step: 1, ticks: [0, 1] });
  });
});

describe("Hilfen", () => {
  it("verteilt Beschriftungen mit erstem und letztem Punkt", () => {
    expect(spreadIndices(3, 4)).toEqual([0, 1, 2]);
    expect(spreadIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(spreadIndices(0, 4)).toEqual([]);
  });

  it("findet den nächsten Punkt", () => {
    expect(nearestIndex([0, 50, 100], 70)).toBe(1);
    expect(nearestIndex([0, 50, 100], 80)).toBe(2);
  });

  it("zeichnet Säulen mit gerundetem Datenende und eckiger Grundlinie", () => {
    expect(columnPath(10, 20, 20, 100)).toBe("M10,100 V24 Q10,20 14,20 H26 Q30,20 30,24 V100 Z");
    expect(columnPath(10, 98, 20, 100)).toContain("V100"); // flache Säule: Radius ≤ Höhe
    expect(columnPath(10, 100, 20, 100)).toBe("");
  });
});
