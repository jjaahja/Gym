import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB } from "@/lib/offline/db";
import { saveMeasurement } from "@/lib/offline/measurements";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { importDays, isAndroidApp, mergeDay, samplesToDays } from "./health-connect";

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();

describe("Health Connect → Körpermaße", () => {
  it("nimmt je Tag die letzte Messung, rundet und filtert unplausible Werte", () => {
    const days = samplesToDays(
      [
        { value: 82.456, startDate: at(2026, 11, 2, 7) },
        { value: 81.9, startDate: at(2026, 11, 2, 21) }, // spätere Messung am selben Tag gewinnt
        { value: 82.1, startDate: at(2026, 11, 4, 7) },
        { value: 5, startDate: at(2026, 11, 5, 7) }, // Unsinn
      ],
      [
        { value: 15.27, startDate: at(2026, 11, 2, 7) },
        { value: 0.149, startDate: at(2026, 11, 4, 7) }, // Anteil statt Prozent
        { value: 95, startDate: at(2026, 11, 6, 7) }, // außerhalb 2–70 %
      ],
    );
    expect(Object.fromEntries(days)).toEqual({
      "2026-11-02": { bodyWeightKg: 81.9, bodyFatPercent: 15.3 },
      "2026-11-04": { bodyWeightKg: 82.1, bodyFatPercent: 14.9 },
    });
  });

  it("überschreibt nur Gewicht und Körperfett, andere Maße und Notizen bleiben", () => {
    const existing = {
      id: "m1", measuredOn: "2026-11-02", bodyWeightKg: 83, bodyFatPercent: null, shouldersCm: 121, chestCm: null,
      waistCm: 84, hipsCm: null, armCm: 38, thighCm: null, calfCm: null, notes: "nach dem Aufstehen",
    };
    expect(mergeDay("2026-11-02", existing, { bodyWeightKg: 81.9, bodyFatPercent: 15.3 })).toEqual({
      measuredOn: "2026-11-02", bodyWeightKg: 81.9, bodyFatPercent: 15.3, shouldersCm: 121, chestCm: null,
      waistCm: 84, hipsCm: null, armCm: 38, thighCm: null, calfCm: null, notes: "nach dem Aufstehen",
    });
    // nichts Neues → kein Schreiben
    expect(mergeDay("2026-11-02", { ...existing, bodyWeightKg: 81.9, bodyFatPercent: 15.3 }, { bodyWeightKg: 81.9, bodyFatPercent: 15.3 })).toBeNull();
    // nur Körperfett geliefert → Gewicht bleibt
    expect(mergeDay("2026-11-02", existing, { bodyFatPercent: 16 })).toMatchObject({ bodyWeightKg: 83, bodyFatPercent: 16 });
  });

  it("speichert neue Tage, ergänzt bestehende und synchronisiert nur Änderungen", async () => {
    const db = new GymDB(`hc-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
    const entries: NewOutboxEntry[] = [];
    const options = { userId: "user-1", sink: (e: NewOutboxEntry) => entries.push(e) };
    await saveMeasurement(db, {
      measuredOn: "2026-11-02", bodyWeightKg: null, bodyFatPercent: null, shouldersCm: null, chestCm: null,
      waistCm: 84, hipsCm: null, armCm: null, thighCm: null, calfCm: null, notes: null,
    }, options);
    entries.length = 0;

    const days = samplesToDays([{ value: 81.9, startDate: at(2026, 11, 2, 7) }, { value: 82.1, startDate: at(2026, 11, 4, 7) }], []);
    expect(await importDays(db, days, options)).toEqual({ updated: 2, days: 2 });
    const rows = await db.measurements.orderBy("measuredOn").toArray();
    expect(rows.map((r) => [r.measuredOn, r.bodyWeightKg, r.waistCm])).toEqual([
      ["2026-11-02", 81.9, 84],
      ["2026-11-04", 82.1, null],
    ]);
    expect(entries.map((e) => e.payload.measured_on)).toEqual(["2026-11-02", "2026-11-04"]);

    entries.length = 0;
    expect(await importDays(db, days, options)).toEqual({ updated: 0, days: 2 });
    expect(entries).toEqual([]);
  });

  it("erkennt den Browser nicht als Android-App", () => {
    expect(isAndroidApp()).toBe(false);
  });
});

describe("automatischer Abgleich", () => {
  it("läuft nur verbunden und höchstens stündlich", async () => {
    const { autoSyncDue } = await import("./health-connect");
    const now = new Date("2026-11-06T12:00:00Z");
    expect(autoSyncDue({ connected: false, lastSync: null }, now)).toBe(false);
    expect(autoSyncDue({ connected: true, lastSync: null }, now)).toBe(true);
    expect(autoSyncDue({ connected: true, lastSync: "2026-11-06T11:30:00Z" }, now)).toBe(false);
    expect(autoSyncDue({ connected: true, lastSync: "2026-11-06T11:00:00Z" }, now)).toBe(true);
  });
});
