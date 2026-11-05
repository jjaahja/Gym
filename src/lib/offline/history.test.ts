import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { getExercise } from "@/lib/catalog";
import { muscleVolume, startOfWeek } from "@/lib/training/volume";
import { GymDB, type CompletedSession } from "./db";
import { lastPerformance, recentPerformances, saveSession, sessionsSince } from "./history";

const bench = getExercise("barbell-bench-press")!.id;
const curl = getExercise("cable-curl")!.id;

function session(id: string, endedAt: string, exercises: CompletedSession["exercises"]): CompletedSession {
  return {
    id,
    planId: null,
    planDayId: null,
    startedAt: endedAt,
    endedAt,
    sessionRpe: null,
    exerciseIds: exercises.map((e) => e.exerciseId),
    exercises,
  };
}

const set = (setIndex: number, weightKg: number, reps: number, rir: number | null = 2, setType: "working" | "warmup" | "dropset" = "working") => ({
  id: `s${setIndex}-${weightKg}`,
  setIndex,
  setType,
  weightKg,
  reps,
  durationSeconds: null,
  rir,
});

const ex = (exerciseId: string, sets: ReturnType<typeof set>[]) => ({
  logId: `log-${exerciseId}-${sets.length}`,
  exerciseId,
  planExerciseId: null,
  pumpRating: null,
  jointDiscomfort: null,
  sets,
});

async function seededDb() {
  const db = new GymDB(`h-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  await saveSession(db, session("a", "2026-11-02T18:00:00.000Z", [ex(bench, [set(0, 80, 8), set(1, 80, 7)])]));
  await saveSession(db, session("b", "2026-11-04T18:00:00.000Z", [ex(bench, [set(0, 82.5, 8), set(1, 82.5, 8)]), ex(curl, [set(0, 20, 12)])]));
  await saveSession(db, session("c", "2026-11-06T18:00:00.000Z", [ex(curl, [set(0, 22.5, 10)])]));
  return db;
}

describe("Lokale Historie", () => {
  it("findet das letzte Mal je Übung", async () => {
    const db = await seededDb();
    expect((await lastPerformance(db, bench))?.sessionId).toBe("b");
    expect((await lastPerformance(db, curl))?.sets[0].weightKg).toBe(22.5);
    expect((await lastPerformance(db, bench, "b"))?.sessionId).toBe("a");
    expect(await lastPerformance(db, getExercise("deadlift")!.id)).toBeNull();
  });

  it("liefert die letzten Einheiten chronologisch", async () => {
    const db = await seededDb();
    expect((await recentPerformances(db, bench, 5)).map((p) => p.sessionId)).toEqual(["a", "b"]);
    expect((await recentPerformances(db, bench, 1)).map((p) => p.sessionId)).toEqual(["b"]);
  });

  it("filtert nach Zeitraum", async () => {
    const db = await seededDb();
    expect((await sessionsSince(db, "2026-11-04T00:00:00.000Z")).map((s) => s.id)).toEqual(["b", "c"]);
  });
});

describe("Volumen pro Muskel (wie die View weekly_muscle_volume)", () => {
  it("zählt harte Sätze, Mitbeanspruchung anteilig, Technik-Segmente halb", () => {
    const v = muscleVolume([
      ex(bench, [set(0, 40, 10, null, "warmup"), set(1, 80, 8, 2), set(2, 80, 8, 1), set(3, 80, 6, 5), set(4, 60, 8, 0, "dropset")]),
    ]);
    // 2 harte Arbeitssätze + 0,5 Dropsatz; RIR 5 und Aufwärmen zählen nicht
    expect(v.get("chest")).toEqual({ total: 2.5, direct: 2.5 });
    expect(v.get("triceps")).toEqual({ total: 1.25, direct: 0 });
  });

  it("beginnt die Woche am Montag", () => {
    expect(startOfWeek(new Date(2026, 10, 8, 23, 30)).getDate()).toBe(2); // So 8.11. → Mo 2.11.
    expect(startOfWeek(new Date(2026, 10, 2, 0, 5)).getDate()).toBe(2);
  });
});
