import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { GymDB } from "./db";

const db = new GymDB(`sink-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
const bulkAdd = vi.spyOn(db.outbox, "bulkAdd");
vi.mock("./db", async (original) => ({ ...(await original<typeof import("./db")>()), getDb: () => db }));
vi.mock("./sync", () => ({ requestSync: vi.fn() }));

describe("Outbox-Schreibweg", () => {
  it("schreibt alle Einträge einer Aktion in einer Transaktion und in Aufruf-Reihenfolge", async () => {
    const { writeToOutbox, outboxIdle } = await import("./sink");
    for (let i = 0; i < 60; i++) writeToOutbox({ table: "plan_exercises", op: "upsert", rowId: `p${i}`, payload: { id: `p${i}` } });
    await outboxIdle();
    expect(bulkAdd).toHaveBeenCalledTimes(1);
    writeToOutbox({ table: "workout_sessions", op: "upsert", rowId: "s1", payload: { id: "s1" } });
    await outboxIdle();
    expect(bulkAdd).toHaveBeenCalledTimes(2);
    const rows = await db.outbox.orderBy("seq").toArray();
    expect(rows.map((r) => r.rowId)).toEqual([...Array.from({ length: 60 }, (_, i) => `p${i}`), "s1"]);
  });
});
