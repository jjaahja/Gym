import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { applyDaily } from "./extras";

describe("Health Connect: Ernährung, Schlaf, Ruhepuls", () => {
  it("Ernährung in die Datenbank (synchronisiert), Schlaf/Ruhepuls nur in den Gerätespeicher", async () => {
    const db = new GymDB(`extras-${Math.random()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const entries: NewOutboxEntry[] = [];
    const { cache, nutritionChanged } = await applyDaily(
      db,
      {
        nutrition: [{ day: "2026-11-12", proteinG: 98.4, energyKcal: 2210 }],
        sleep: [{ day: "2026-11-12", minutes: 412 }],
        restingHeartRate: [{ day: "2026-11-12", bpm: 54 }],
      },
      { status: null, lastRead: null, sleep: [], restingHr: [] },
      { userId: "u1", sink: (e) => entries.push(e), now: new Date("2026-11-12T08:00:00Z") },
    );
    expect(nutritionChanged).toBe(1);
    expect(entries.map((e) => e.table)).toEqual(["nutrition_days"]);
    expect(entries[0].payload).toMatchObject({ protein_g: 98.4, energy_kcal: 2210, source: "health_connect" });
    expect(cache).toMatchObject({ lastRead: "2026-11-12T08:00:00.000Z", sleep: [{ day: "2026-11-12", value: 412 }], restingHr: [{ day: "2026-11-12", value: 54 }] });
  });

  it("fehlende Arten lassen den bisherigen Speicher stehen", async () => {
    const db = new GymDB(`extras-${Math.random()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const before = { status: null, lastRead: null, sleep: [{ day: "2026-11-11", value: 400 }], restingHr: [] };
    const { cache } = await applyDaily(db, { restingHeartRate: [] }, before, { userId: null, sink: () => {} });
    expect(cache.sleep).toEqual(before.sleep);
    expect(cache.restingHr).toEqual([]);
  });
});
