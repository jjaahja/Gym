import { describe, expect, it } from "vitest";
import { getExercise } from "@/lib/catalog";
import type { CompletedSession, CompletedSet } from "@/lib/offline/db";
import { exerciseFeedback, exerciseSeries, exercisesWithHistory, jointHistory, weeklyMuscleSeries } from "./analytics";

const bench = getExercise("barbell-bench-press")!;
const fly = getExercise("cable-fly")!;

let n = 0;
const set = (weightKg: number, reps: number, rir: number | null = 1, setType: CompletedSet["setType"] = "working"): CompletedSet => ({
  id: `s${++n}`,
  setIndex: n,
  setType,
  weightKg,
  reps,
  durationSeconds: null,
  rir,
});

function session(
  endedAt: string,
  exercises: { id: string; sets: CompletedSet[]; pump?: number | null; joint?: number | null }[],
  extra: Partial<CompletedSession> = {},
): CompletedSession {
  return {
    id: `session-${endedAt}`,
    planId: "plan",
    planDayId: null,
    startedAt: new Date(Date.parse(endedAt) - 3600_000).toISOString(),
    endedAt,
    sessionRpe: 8,
    exerciseIds: exercises.map((e) => e.id),
    exercises: exercises.map((e, i) => ({
      logId: `log-${endedAt}-${i}`,
      exerciseId: e.id,
      planExerciseId: null,
      pumpRating: e.pump ?? null,
      jointDiscomfort: e.joint ?? null,
      sets: e.sets,
    })),
    ...extra,
  };
}

describe("exerciseSeries", () => {
  it("liefert je Einheit e1RM, Topgewicht, Arbeitssätze und Volumenlast – Aufwärmsätze zählen nicht", () => {
    const sessions = [
      session("2026-11-05T10:00:00Z", [{ id: bench.id, sets: [set(40, 10, null, "warmup"), set(80, 8, 2), set(80, 7, 1)] }]),
      session("2026-11-02T10:00:00Z", [{ id: bench.id, sets: [set(77.5, 8, 2), set(77.5, 7, 1)] }]),
    ];
    const series = exerciseSeries(sessions, bench.id);
    expect(series.map((p) => p.date)).toEqual(["2026-11-02T10:00:00Z", "2026-11-05T10:00:00Z"]);
    const latest = series[1];
    // Epley mit RIR: 80 × (1 + (8 + 2) / 30)
    expect(latest.bestE1rmKg).toBeCloseTo(80 * (1 + 10 / 30), 2);
    expect(latest.topWeightKg).toBe(80);
    expect(latest.workingSets).toBe(2);
    expect(latest.totalReps).toBe(15);
    expect(latest.volumeLoadKg).toBe(80 * 15);
    expect(latest.score).toBe(latest.bestE1rmKg);
  });

  it("ignoriert Einheiten ohne die Übung", () => {
    const sessions = [session("2026-11-02T10:00:00Z", [{ id: fly.id, sets: [set(15, 12)] }])];
    expect(exerciseSeries(sessions, bench.id)).toEqual([]);
  });
});

describe("exercisesWithHistory", () => {
  it("sortiert nach Häufigkeit, dann nach letzter Nutzung", () => {
    const sessions = [
      session("2026-11-01T10:00:00Z", [{ id: bench.id, sets: [set(80, 8)] }]),
      session("2026-11-03T10:00:00Z", [{ id: bench.id, sets: [set(80, 8)] }, { id: fly.id, sets: [set(15, 12)] }]),
    ];
    expect(exercisesWithHistory(sessions)).toEqual([
      { exerciseId: bench.id, sessions: 2, lastDate: "2026-11-03T10:00:00Z" },
      { exerciseId: fly.id, sessions: 1, lastDate: "2026-11-03T10:00:00Z" },
    ]);
  });
});

describe("weeklyMuscleSeries", () => {
  it("zählt harte Sätze je Kalenderwoche inkl. leerer Wochen", () => {
    const now = new Date("2026-11-18T12:00:00"); // Mittwoch
    const sessions = [
      // Woche ab 16.11.: 3 harte Sätze Brust (Bankdrücken primär)
      session("2026-11-17T18:00:00", [{ id: bench.id, sets: [set(80, 8, 2), set(80, 8, 2), set(80, 8, 2)] }]),
      // Woche ab 02.11.: 2 harte + 1 zu leichter Satz (RIR 6)
      session("2026-11-03T18:00:00", [{ id: fly.id, sets: [set(15, 12, 1), set(15, 12, 2), set(10, 12, 6)] }]),
    ];
    const series = weeklyMuscleSeries(sessions, "chest", 4, now);
    expect(series.map((p) => p.weekStart.getDate())).toEqual([26, 2, 9, 16]);
    expect(series.map((p) => p.sets)).toEqual([0, 2, 0, 3]);
  });
});

describe("Feedback", () => {
  it("mittelt Pump und Gelenkbeschwerden je Übung und liefert die Gelenk-Historie chronologisch", () => {
    const sessions = [
      session("2026-11-05T10:00:00Z", [{ id: fly.id, sets: [set(15, 12)], pump: 3, joint: 2 }]),
      session("2026-11-02T10:00:00Z", [{ id: fly.id, sets: [set(15, 12)], pump: 2, joint: 0 }]),
      session("2026-11-03T10:00:00Z", [{ id: fly.id, sets: [set(15, 12)] }]),
    ];
    expect(exerciseFeedback(sessions)).toEqual([{ exerciseId: fly.id, avgPump: 2.5, avgJointDiscomfort: 1, ratings: 2 }]);
    expect(jointHistory(sessions, fly.id)).toEqual([0, null, 2]);
  });
});
