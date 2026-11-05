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
