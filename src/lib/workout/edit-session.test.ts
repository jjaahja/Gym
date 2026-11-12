import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB, type CompletedSession } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { deleteCompletedSession, deleteCompletedSet, updateCompletedSet, updateSessionRpe } from "./edit-session";

const set = (id: string, setIndex: number, reps: number) => ({ id, setIndex, setType: "working" as const, weightKg: 60, reps, durationSeconds: null, rir: 2 });

async function setup() {
  const db = new GymDB(`ed-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  const session: CompletedSession = {
    id: "s1", planId: "p1", planDayId: "d1", startedAt: "2026-11-10T16:00:00.000Z", endedAt: "2026-11-10T17:00:00.000Z",
    sessionRpe: 8, exerciseIds: ["e1", "e2"],
    exercises: [
      { logId: "l1", exerciseId: "e1", planExerciseId: null, pumpRating: null, jointDiscomfort: null, sets: [set("a", 0, 10), set("b", 1, 9), set("c", 2, 8)] },
      { logId: "l2", exerciseId: "e2", planExerciseId: null, pumpRating: null, jointDiscomfort: null, sets: [set("d", 0, 12)] },
    ],
  };
  await db.sessions.put(session);
  const entries: NewOutboxEntry[] = [];
  return { db, entries, opts: { userId: "u1", sink: (e: NewOutboxEntry) => entries.push(e) } };
}

describe("Trainings nachträglich bearbeiten", () => {
  it("ändert einen Satz lokal und als set_logs-Upsert", async () => {
    const { db, entries, opts } = await setup();
    await updateCompletedSet(db, "s1", "l1", "b", { weightKg: 62.5, reps: 10 }, opts);
    expect((await db.sessions.get("s1"))!.exercises[0].sets[1]).toMatchObject({ weightKg: 62.5, reps: 10, rir: 2 });
    expect(entries).toEqual([
      { table: "set_logs", op: "upsert", rowId: "b", payload: { id: "b", exercise_log_id: "l1", set_index: 1, set_type: "working", weight_kg: 62.5, reps: 10, duration_seconds: null, rir: 2, is_completed: true } },
    ]);
    await expect(updateCompletedSet(db, "s1", "l1", "b", { reps: -1 }, opts)).rejects.toThrow(RangeError);
  });

  it("löscht einen Satz: erst löschen, dann nachfolgende aufsteigend neu nummerieren", async () => {
    const { db, entries, opts } = await setup();
    await deleteCompletedSet(db, "s1", "l1", "a", opts);
    expect((await db.sessions.get("s1"))!.exercises[0].sets.map((s) => [s.id, s.setIndex])).toEqual([["b", 0], ["c", 1]]);
    expect(entries.map((e) => `${e.op}:${e.rowId}:${(e.payload as { set_index?: number }).set_index ?? ""}`)).toEqual(["delete:a:", "upsert:b:0", "upsert:c:1"]);
  });

  it("letzter Satz einer Übung entfernt die Übung; letzte Übung entfernt das Training", async () => {
    const { db, entries, opts } = await setup();
    await deleteCompletedSet(db, "s1", "l2", "d", opts);
    const s = (await db.sessions.get("s1"))!;
    expect(s.exercises.map((e) => e.logId)).toEqual(["l1"]);
    expect(s.exerciseIds).toEqual(["e1"]);
    expect(entries.at(-1)).toEqual({ table: "exercise_logs", op: "delete", rowId: "l2", payload: { id: "l2" } });
    for (const id of ["a", "b"]) await deleteCompletedSet(db, "s1", "l1", id, opts);
    await deleteCompletedSet(db, "s1", "l1", "c", opts);
    expect(await db.sessions.get("s1")).toBeUndefined();
    expect(entries.at(-1)).toEqual({ table: "workout_sessions", op: "delete", rowId: "s1", payload: { id: "s1" } });
  });

  it("Session-RPE ändern (vollständige Pflichtfelder für den Upsert), Training löschen; ohne Konto nur lokal", async () => {
    const { db, entries, opts } = await setup();
    await updateSessionRpe(db, "s1", 6, opts);
    expect(entries[0].payload).toMatchObject({ id: "s1", user_id: "u1", status: "completed", session_rpe: 6, started_at: "2026-11-10T16:00:00.000Z" });
    await deleteCompletedSession(db, "s1", { userId: null, sink: (e) => entries.push(e) });
    expect(await db.sessions.get("s1")).toBeUndefined();
    expect(entries).toHaveLength(1);
  });
});
