import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { createWorkoutStore } from "./workout-store";

function memoryStorage(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function setup(userId: string | null = "user-1") {
  const entries: NewOutboxEntry[] = [];
  const storage = memoryStorage();
  let id = 0;
  const store = createWorkoutStore({
    sink: (entry) => entries.push(entry),
    storage: () => storage,
    now: () => new Date("2026-11-05T18:00:00Z"),
    uuid: () => `id-${++id}`,
  });
  return { store, entries, storage, userId };
}

describe("Workout-Store", () => {
  it("schreibt ein komplettes Training in richtiger Reihenfolge in die Outbox", () => {
    const { store, entries } = setup();
    const s = store.getState();

    const sessionId = s.start({ userId: "user-1" });
    const logId = store.getState().addExercise("bench-press");
    store.getState().logSet(logId, { weightKg: 82.5, reps: 8, rir: 2 });
    store.getState().logSet(logId, { weightKg: 60, reps: 10, rir: 0, setType: "dropset" });
    store.getState().rateExercise(logId, { pumpRating: 3, jointDiscomfort: 0 });
    store.getState().finish();

    expect(entries.map((e) => `${e.op}:${e.table}`)).toEqual([
      "upsert:workout_sessions",
      "upsert:exercise_logs",
      "upsert:set_logs",
      "upsert:set_logs",
      "upsert:exercise_logs",
      "upsert:workout_sessions",
    ]);

    expect(entries[0].payload).toMatchObject({ id: sessionId, user_id: "user-1", status: "in_progress" });
    expect(entries[1].payload).toMatchObject({ id: logId, session_id: sessionId, order_index: 0 });
    expect(entries[2].payload).toEqual({
      id: "id-3",
      exercise_log_id: logId,
      set_index: 0,
      set_type: "working",
      weight_kg: 82.5,
      reps: 8,
      rir: 2,
      is_completed: true,
      completed_at: "2026-11-05T18:00:00.000Z",
    });
    expect(entries[3].payload).toMatchObject({ set_index: 1, set_type: "dropset" });
    expect(entries[4].payload).toMatchObject({ pump_rating: 3, joint_discomfort: 0 });
    expect(entries[5].payload).toMatchObject({ status: "completed", ended_at: "2026-11-05T18:00:00.000Z" });
    expect(store.getState().session).toBeNull();
  });

  it("schickt keine generierten Spalten mit", () => {
    const { store, entries } = setup();
    store.getState().start({ userId: "user-1" });
    const logId = store.getState().addExercise("curl");
    store.getState().logSet(logId, { weightKg: 12, reps: 12, rir: 1 });
    expect(entries.at(-1)?.payload).not.toHaveProperty("e1rm_kg");
  });

  it("nummeriert nach dem Löschen eines Satzes kollisionsfrei neu", () => {
    const { store, entries } = setup();
    store.getState().start({ userId: "user-1" });
    const logId = store.getState().addExercise("row");
    const a = store.getState().logSet(logId, { weightKg: 60, reps: 10, rir: 2 });
    store.getState().logSet(logId, { weightKg: 60, reps: 9, rir: 1 });
    store.getState().logSet(logId, { weightKg: 60, reps: 8, rir: 0 });
    entries.length = 0;

    store.getState().removeSet(logId, a);

    expect(entries.map((e) => `${e.op}:${e.payload.set_index ?? "-"}`)).toEqual([
      "delete:-",
      "upsert:0",
      "upsert:1",
    ]);
    expect(store.getState().session?.exercises[0].sets.map((s) => s.setIndex)).toEqual([0, 1]);
  });

  it("lehnt ungültige Eingaben wie die DB-Constraints ab", () => {
    const { store } = setup();
    store.getState().start({ userId: "user-1" });
    const logId = store.getState().addExercise("squat");
    expect(() => store.getState().logSet(logId, { weightKg: -5, reps: 5, rir: 2 })).toThrow(RangeError);
    expect(() => store.getState().logSet(logId, { weightKg: 100, reps: 5.5, rir: 2 })).toThrow(RangeError);
    expect(() => store.getState().logSet(logId, { weightKg: 100, reps: 5, rir: 11 })).toThrow(RangeError);
    expect(() => store.getState().rateExercise(logId, { pumpRating: 4 })).toThrow(RangeError);
  });

  it("verhindert zwei parallele Trainings", () => {
    const { store } = setup();
    store.getState().start({ userId: "user-1" });
    expect(() => store.getState().start({ userId: "user-1" })).toThrow();
  });

  it("synchronisiert im Demo-Modus nichts", () => {
    const { store, entries } = setup();
    store.getState().start({ userId: null });
    const logId = store.getState().addExercise("press");
    store.getState().logSet(logId, { weightKg: 40, reps: 10, rir: 2 });
    store.getState().finish();
    expect(entries).toHaveLength(0);
  });

  it("überlebt einen Reload (Persistenz)", async () => {
    const { store, storage } = setup();
    store.getState().start({ userId: "user-1" });
    store.getState().addExercise("deadlift");

    const reloaded = createWorkoutStore({ sink: () => {}, storage: () => storage });
    await reloaded.persist.rehydrate();
    expect(reloaded.getState().session?.exercises[0].exerciseId).toBe("deadlift");
  });
});
