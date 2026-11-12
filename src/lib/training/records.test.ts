import { describe, expect, it } from "vitest";
import type { CompletedSession } from "@/lib/offline/db";
import { bestsFrom, recordsToday } from "./records";

const session = (id: string, endedAt: string, sets: [number, number, number][]): CompletedSession => ({
  id, planId: null, planDayId: null, startedAt: endedAt, endedAt, sessionRpe: null, exerciseIds: ["bp"],
  exercises: [{ logId: `${id}-l`, exerciseId: "bp", planExerciseId: null, pumpRating: null, jointDiscomfort: null,
    sets: sets.map(([w, r, rir], i) => ({ id: `${id}-${i}`, setIndex: i, setType: "working" as const, weightKg: w, reps: r, durationSeconds: null, rir })) }],
});

describe("Rekorde", () => {
  it("Bestwerte aus der Historie (1RM RIR-korrigiert, schwerstes Gewicht bei mehr Wdh. bevorzugt)", () => {
    const bests = bestsFrom([session("a", "2026-11-01", [[60, 10, 2], [65, 5, 0]]), session("b", "2026-11-05", [[65, 6, 0]])], "bp");
    expect(bests.e1rm).toEqual({ value: 84, date: "2026-11-01" }); // 60 × (1 + 12/30)
    expect(bests.weight).toEqual({ value: 65, reps: 6, date: "2026-11-05" });
    expect(bestsFrom([session("a", "2026-11-01", [[60, 10, 2]])], "bp", "a")).toEqual({ e1rm: null, weight: null });
  });

  it("markiert nur den ersten Satz, der die Bestmarke übertrifft – und nicht beim allerersten Training", () => {
    const previous = bestsFrom([session("a", "2026-11-01", [[60, 10, 2]])], "bp");
    const today = [
      { id: "1", setType: "working" as const, weightKg: 62.5, reps: 10, rir: 2 }, // 1RM 87,5, Gewicht 62,5 → beides neu
      { id: "2", setType: "working" as const, weightKg: 62.5, reps: 9, rir: 2 }, // schlechter als Satz 1 → nichts
      { id: "3", setType: "warmup" as const, weightKg: 100, reps: 1, rir: null }, // Aufwärmen zählt nicht
    ];
    const hits = recordsToday(today, previous);
    expect([...hits.keys()]).toEqual(["1"]);
    expect(hits.get("1")!.map((h) => h.kind)).toEqual(["e1rm", "weight"]);
    expect(recordsToday(today, { e1rm: null, weight: null }).size).toBe(0);
  });
});
