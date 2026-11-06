import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { GymDB } from "./db";
import { enqueue, flushOutbox, type SyncBackend } from "./outbox";

function createDb() {
  return new GymDB(`test-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
}

function fakeBackend(failOn?: (table: string, row: Record<string, unknown>) => boolean) {
  const calls: string[] = [];
  const backend: SyncBackend = {
    async upsert(table, row) {
      if (failOn?.(table, row)) throw new Error("Netzwerkfehler");
      calls.push(`upsert:${table}:${row.id}`);
    },
    async remove(table, match) {
      calls.push(`delete:${table}:${Object.entries(match).map(([k, v]) => `${k}=${v}`).join(",")}`);
    },
  };
  return { backend, calls };
}

describe("Outbox", () => {
  let db: GymDB;

  beforeEach(async () => {
    db = createDb();
    await enqueue(db, { table: "workout_sessions", op: "upsert", rowId: "s1", payload: { id: "s1" } });
    await enqueue(db, { table: "exercise_logs", op: "upsert", rowId: "e1", payload: { id: "e1" } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x1", payload: { id: "x1" } });
    await enqueue(db, { table: "set_logs", op: "delete", rowId: "x1", payload: {} });
    await enqueue(db, { table: "user_equipment", op: "delete", rowId: "u1", payload: { user_id: "u1" } });
  });

  it("überträgt in Einfüge-Reihenfolge und leert sich", async () => {
    const { backend, calls } = fakeBackend();
    const result = await flushOutbox(db, backend);

    expect(calls).toEqual([
      "upsert:workout_sessions:s1",
      "upsert:exercise_logs:e1",
      "upsert:set_logs:x1",
      "delete:set_logs:id=x1",
      "delete:user_equipment:user_id=u1",
    ]);
    expect(result).toEqual({ synced: 5, remaining: 0 });
  });

  it("bricht beim ersten Fehler ab und behält den Rest für später", async () => {
    const { backend, calls } = fakeBackend((table) => table === "exercise_logs");
    const result = await flushOutbox(db, backend);

    expect(calls).toEqual(["upsert:workout_sessions:s1"]);
    expect(result.synced).toBe(1);
    expect(result.remaining).toBe(4);
    expect(result.error).toBe("Netzwerkfehler");

    const failed = await db.outbox.orderBy("seq").first();
    expect(failed?.rowId).toBe("e1");
    expect(failed?.attempts).toBe(1);
  });

  it("setzt nach einem Fehler beim nächsten Versuch nahtlos fort", async () => {
    await flushOutbox(db, fakeBackend((table) => table === "exercise_logs").backend);
    const { backend, calls } = fakeBackend();
    const result = await flushOutbox(db, backend);

    expect(calls).toEqual([
      "upsert:exercise_logs:e1",
      "upsert:set_logs:x1",
      "delete:set_logs:id=x1",
      "delete:user_equipment:user_id=u1",
    ]);
    expect(result.remaining).toBe(0);
  });
});

describe("Outbox – gebündelte Übertragung", () => {
  function batchingBackend(failTable?: string) {
    const calls: string[] = [];
    const rows: Record<string, unknown>[][] = [];
    const backend: SyncBackend = {
      async upsert(table, row) {
        if (table === failTable) throw new Error("abgelehnt");
        calls.push(`upsert:${table}:${row.id}`);
      },
      async upsertMany(table, batch) {
        if (table === failTable) throw new Error("abgelehnt");
        calls.push(`many:${table}:${batch.map((r) => r.id).join(",")}`);
        rows.push(batch);
      },
      async remove(table) {
        calls.push(`delete:${table}`);
      },
    };
    return { backend, calls, rows };
  }

  it("bündelt aufeinanderfolgende Zeilen einer Tabelle, behält die Reihenfolge zwischen Tabellen", async () => {
    const db = createDb();
    await enqueue(db, { table: "workout_sessions", op: "upsert", rowId: "s1", payload: { id: "s1", status: "in_progress" } });
    await enqueue(db, { table: "exercise_logs", op: "upsert", rowId: "e1", payload: { id: "e1", n: 1 } });
    await enqueue(db, { table: "exercise_logs", op: "upsert", rowId: "e2", payload: { id: "e2", n: 2 } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x1", payload: { id: "x1", reps: 8 } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x2", payload: { id: "x2", reps: 9 } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x1", payload: { id: "x1", reps: 10 } });
    await enqueue(db, { table: "set_logs", op: "delete", rowId: "x2", payload: { id: "x2" } });
    await enqueue(db, { table: "workout_sessions", op: "upsert", rowId: "s1", payload: { id: "s1", status: "completed" } });

    const { backend, calls, rows } = batchingBackend();
    const result = await flushOutbox(db, backend);
    expect(calls).toEqual([
      "upsert:workout_sessions:s1",
      "many:exercise_logs:e1,e2",
      "many:set_logs:x2,x1", // letzte Version von x1 zählt
      "delete:set_logs",
      "upsert:workout_sessions:s1",
    ]);
    expect(rows[1].find((r) => r.id === "x1")).toEqual({ id: "x1", reps: 10 });
    expect(result).toEqual({ synced: 8, remaining: 0 });
  });

  it("bündelt nur Zeilen mit denselben Spalten (Teil-Updates bleiben einzeln)", async () => {
    const db = createDb();
    await enqueue(db, { table: "profiles", op: "upsert", rowId: "u", payload: { id: "u", timezone: "Europe/Berlin" } });
    await enqueue(db, { table: "profiles", op: "upsert", rowId: "u", payload: { id: "u", unit_system: "imperial" } });
    const { backend, calls } = batchingBackend();
    await flushOutbox(db, backend);
    expect(calls).toEqual(["upsert:profiles:u", "upsert:profiles:u"]);
  });

  it("teilt große Mengen in Anfragen zu höchstens 200 Zeilen", async () => {
    const db = createDb();
    await db.outbox.bulkAdd(
      Array.from({ length: 450 }, (_, i) => ({
        table: "plan_exercises" as const, op: "upsert" as const, rowId: `p${i}`, payload: { id: `p${i}` }, createdAt: i, attempts: 0,
      })),
    );
    const { backend, rows } = batchingBackend();
    const result = await flushOutbox(db, backend);
    expect(rows.map((r) => r.length)).toEqual([200, 200, 50]);
    expect(result.remaining).toBe(0);
  });

  it("behält bei einem Fehler das ganze Bündel und alles danach", async () => {
    const db = createDb();
    await enqueue(db, { table: "workout_sessions", op: "upsert", rowId: "s1", payload: { id: "s1" } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x1", payload: { id: "x1" } });
    await enqueue(db, { table: "set_logs", op: "upsert", rowId: "x2", payload: { id: "x2" } });
    await enqueue(db, { table: "body_measurements", op: "upsert", rowId: "m1", payload: { id: "m1" } });
    const result = await flushOutbox(db, batchingBackend("set_logs").backend);
    expect(result).toMatchObject({ synced: 1, remaining: 3, error: "abgelehnt" });
    const left = await db.outbox.orderBy("seq").toArray();
    expect(left.map((e) => e.rowId)).toEqual(["x1", "x2", "m1"]);
    expect(left[0]).toMatchObject({ attempts: 1, lastError: "abgelehnt" });
  });
});
