import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { getExercise } from "@/lib/catalog";
import { GymDB, type CompletedSession } from "@/lib/offline/db";
import type { WorkoutPayload } from "./workout-export";
import { exportWorkouts, rememberSetTimes, type WriteState } from "./workout-sync";

const session = (id: string, day: string): CompletedSession => ({
  id,
  planId: null,
  planDayId: "d1",
  startedAt: `${day}T16:00:00.000Z`,
  endedAt: `${day}T17:00:00.000Z`,
  sessionRpe: 7,
  exerciseIds: [],
  exercises: [
    {
      logId: `${id}-l`,
      exerciseId: getExercise("lat-pulldown")!.id,
      planExerciseId: null,
      pumpRating: null,
      jointDiscomfort: null,
      sets: [{ id: `${id}-s1`, setIndex: 0, setType: "working", weightKg: 50, reps: 10, durationSeconds: null, rir: 2 }],
    },
  ],
});

async function setup() {
  const db = new GymDB(`hcw-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  await db.sessions.bulkPut([session("old", "2026-09-01"), session("a", "2026-11-02"), session("b", "2026-11-09")]);
  await db.measurements.put({
    id: "m1", measuredOn: "2026-11-01", bodyWeightKg: 80, bodyFatPercent: null, shouldersCm: null, chestCm: null,
    waistCm: null, hipsCm: null, armCm: null, thighCm: null, calfCm: null, notes: null,
  });
  const written: WorkoutPayload[] = [];
  let state: WriteState = { enabled: true, since: "2026-10-12T00:00:00.000Z", written: [] };
  const deps = {
    write: async (p: WorkoutPayload) => {
      written.push(p);
      return { segments: p.segments.length, segmentMode: "exact" as const, calories: p.activeCaloriesKcal != null };
    },
    titleFor: () => "Rücken",
    get state() {
      return state;
    },
    save: (s: WriteState) => void (state = s),
  };
  return { db, written, deps, getState: () => state };
}

describe("Trainings nach Health Connect", () => {
  it("überträgt jedes Training ab dem Stichtag genau einmal, älteste zuerst, mit Körpergewicht für Kalorien", async () => {
    const { db, written, deps, getState } = await setup();
    expect(await exportWorkouts(db, deps)).toEqual({ written: 2, withoutCalories: 0, error: null });
    expect(written.map((p) => p.id)).toEqual(["a", "b"]);
    expect(written[0]).toMatchObject({ title: "Rücken", activeCaloriesKcal: 200 }); // (3,5 − 1) × 80 kg × 1 h
    expect(getState().written).toEqual(["a", "b"]);

    // zweiter Lauf: nichts Neues
    expect(await exportWorkouts(db, deps)).toEqual({ written: 0, withoutCalories: 0, error: null });
    expect(written).toHaveLength(2);
  });

  it("nutzt die gemerkten Satzzeiten des gerade beendeten Trainings", async () => {
    const { db, written, deps } = await setup();
    rememberSetTimes([{ id: "b-s1", completedAt: "2026-11-09T16:30:00.000Z" }]);
    await exportWorkouts(db, deps);
    expect(written[1].segments[0].endTime).toBe("2026-11-09T16:30:00.000Z");
  });

  it("bricht beim ersten Fehler ab und versucht es beim nächsten Mal erneut", async () => {
    const { db, deps, getState } = await setup();
    const failing = { ...deps, write: async () => Promise.reject(new Error("Keine Berechtigung zum Speichern von Trainings")) };
    expect(await exportWorkouts(db, failing)).toEqual({ written: 0, withoutCalories: 0, error: "Keine Berechtigung zum Speichern von Trainings" });
    expect(getState().written).toEqual([]);
    expect((await exportWorkouts(db, deps)).written).toBe(2);
  });

  it("macht nichts, solange das Speichern aus ist", async () => {
    const { db, written, deps } = await setup();
    const off = { ...deps, state: { enabled: false, since: null, written: [] } };
    expect((await exportWorkouts(db, off)).written).toBe(0);
    expect(written).toEqual([]);
  });
});
