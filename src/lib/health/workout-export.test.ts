import { describe, expect, it } from "vitest";
import { getExercise } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { exercises } from "@/lib/catalog";
import { activeCalories, buildWorkoutPayload, SEGMENT, segmentTypeFor } from "./workout-export";

const set = (id: string, setIndex: number, reps: number, setType: "working" | "warmup" = "working") => ({
  id, setIndex, setType, weightKg: 60, reps, durationSeconds: null, rir: 2,
});

const session: CompletedSession = {
  id: "s1",
  planId: "p1",
  planDayId: "d1",
  startedAt: "2026-11-10T16:00:00.000Z",
  endedAt: "2026-11-10T17:00:00.000Z",
  sessionRpe: 8,
  exerciseIds: [],
  exercises: [
    { logId: "l1", exerciseId: getExercise("barbell-bench-press")!.id, planExerciseId: null, pumpRating: null, jointDiscomfort: null,
      sets: [set("a", 0, 12, "warmup"), set("b", 1, 10), set("c", 2, 9)] },
    { logId: "l2", exerciseId: getExercise("cable-fly")!.id, planExerciseId: null, pumpRating: null, jointDiscomfort: null, sets: [set("d", 0, 15)] },
  ],
};

describe("Training → Health Connect", () => {
  it("ordnet Übungen Segmenttypen zu, Unbekanntes als allgemeines Krafttraining", () => {
    expect(segmentTypeFor("barbell-bench-press")).toBe(SEGMENT.BENCH_PRESS);
    expect(segmentTypeFor("romanian-deadlift")).toBe(SEGMENT.DEADLIFT);
    expect(segmentTypeFor("cable-fly")).toBe(SEGMENT.WEIGHTLIFTING);
    // jede Übung im Katalog bekommt einen gültigen Typ
    for (const e of exercises) expect(Object.values(SEGMENT)).toContain(segmentTypeFor(e.slug));
  });

  it("schätzt aktive Kalorien nach MET (2024 Compendium): 3,5 normal, 6,0 ab RPE 8", () => {
    expect(activeCalories(3_600_000, 80, 7)).toBe(200); // (3,5 − 1) × 80 kg × 1 h
    expect(activeCalories(3_600_000, 80, 9)).toBe(400); // (6 − 1) × 80 × 1
    expect(activeCalories(1_800_000, 80, null)).toBe(100);
  });

  it("baut Einheit, Notiz, Kalorien und Segmente aus den echten Satzzeiten", () => {
    const setTimes = new Map([
      ["a", "2026-11-10T16:05:00.000Z"],
      ["b", "2026-11-10T16:08:00.000Z"],
      ["c", "2026-11-10T16:08:20.000Z"], // direkt danach: darf nicht überlappen
      ["d", "2026-11-10T16:20:00.000Z"],
    ]);
    const p = buildWorkoutPayload(session, { title: "Oberkörper A", bodyWeightKg: 80, setTimes });
    expect(p).toMatchObject({
      id: "s1",
      title: "Oberkörper A",
      notes: "2 Übungen · 3 Sätze – Gym-App",
      startTime: "2026-11-10T16:00:00.000Z",
      endTime: "2026-11-10T17:00:00.000Z",
      activeCaloriesKcal: 400,
    });
    expect(p.segments.map((s) => [s.type, s.repetitions])).toEqual([
      [SEGMENT.BENCH_PRESS, 12],
      [SEGMENT.BENCH_PRESS, 10],
      [SEGMENT.BENCH_PRESS, 9],
      [SEGMENT.WEIGHTLIFTING, 15],
    ]);
    // 10 Wdh. × 3,5 s + 5 s = 40 s vor dem Eintragen
    expect(p.segments[1]).toMatchObject({ startTime: "2026-11-10T16:07:20.000Z", endTime: "2026-11-10T16:08:00.000Z" });
    for (let i = 1; i < p.segments.length; i++) expect(p.segments[i].startTime >= p.segments[i - 1].endTime).toBe(true);
    expect(p.segments[2].startTime).toBe("2026-11-10T16:08:00.000Z");
  });

  it("verteilt Sätze ohne Zeitpunkte gleichmäßig, ohne Gewicht keine Kalorien", () => {
    const p = buildWorkoutPayload(session, { title: "Training", bodyWeightKg: null });
    expect(p.activeCaloriesKcal).toBeNull();
    expect(p.segments).toHaveLength(4);
    expect(p.segments[0].endTime).toBe("2026-11-10T16:15:00.000Z");
    expect(p.segments[3].endTime).toBe("2026-11-10T17:00:00.000Z");
    for (const s of p.segments) {
      expect(s.startTime >= p.startTime && s.endTime <= p.endTime).toBe(true);
      expect(Date.parse(s.endTime) - Date.parse(s.startTime)).toBeGreaterThanOrEqual(15_000);
    }
  });
});
