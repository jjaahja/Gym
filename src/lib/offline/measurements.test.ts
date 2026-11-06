import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB } from "./db";
import {
  deleteMeasurement,
  listMeasurements,
  measurementId,
  saveMeasurement,
  validateMeasurement,
  type MeasurementInput,
} from "./measurements";
import type { NewOutboxEntry } from "./outbox";

const empty: MeasurementInput = {
  measuredOn: "2026-11-06",
  bodyWeightKg: null,
  bodyFatPercent: null,
  shouldersCm: null,
  chestCm: null,
  waistCm: null,
  hipsCm: null,
  armCm: null,
  thighCm: null,
  calfCm: null,
  notes: null,
};

const freshDb = () => new GymDB(`m-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });

describe("Körpermaße", () => {
  it("prüft wie die CHECK-Constraints der Tabelle", () => {
    expect(validateMeasurement(empty)).toMatch(/mindestens einen Wert/);
    expect(validateMeasurement({ ...empty, bodyWeightKg: 82.4 })).toBeNull();
    expect(validateMeasurement({ ...empty, bodyFatPercent: 1 })).toMatch(/Körperfett/);
    expect(validateMeasurement({ ...empty, bodyFatPercent: 71 })).toMatch(/Körperfett/);
    expect(validateMeasurement({ ...empty, waistCm: 0 })).toMatch(/Taille/);
    expect(validateMeasurement({ ...empty, measuredOn: "6.11.2026", armCm: 38 })).toMatch(/Datum/);
  });

  it("speichert einen Eintrag pro Tag und synchronisiert die vollständige Zeile", async () => {
    const db = freshDb();
    const entries: NewOutboxEntry[] = [];
    const options = { userId: "user-1", sink: (e: NewOutboxEntry) => entries.push(e), uuid: () => "m-1" };

    const first = await saveMeasurement(db, { ...empty, bodyWeightKg: 82.4, waistCm: 84 }, options);
    const second = await saveMeasurement(db, { ...empty, bodyWeightKg: 82.104, armCm: 38.46, notes: "  morgens  " }, {
      ...options,
      uuid: () => "m-2",
    });
    expect(second.id).toBe(first.id); // gleicher Tag → gleiche Zeile

    const rows = await listMeasurements(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bodyWeightKg: 82.1, waistCm: null, armCm: 38.5 });
    const id = measurementId("user-1", "2026-11-06");
    expect(first.id).toBe(id);
    expect(entries.at(-1)).toEqual({
      table: "body_measurements",
      op: "upsert",
      rowId: id,
      payload: {
        id,
        user_id: "user-1",
        measured_on: "2026-11-06",
        body_weight_kg: 82.1,
        waist_cm: null,
        arm_cm: 38.5,
        shoulders_cm: null,
        chest_cm: null,
        hips_cm: null,
        thigh_cm: null,
        calf_cm: null,
        body_fat_percent: null,
        notes: "morgens",
      },
    });

    await deleteMeasurement(db, id, options);
    expect(await listMeasurements(db)).toEqual([]);
    expect(entries.at(-1)).toEqual({ table: "body_measurements", op: "delete", rowId: id, payload: { id } });
  });

  it("vergibt je Konto und Tag dieselbe ID – zwei Geräte offline schreiben dieselbe Zeile", async () => {
    const sink = () => {};
    const a = await saveMeasurement(freshDb(), { ...empty, bodyWeightKg: 82 }, { userId: "user-1", sink });
    const b = await saveMeasurement(freshDb(), { ...empty, waistCm: 84 }, { userId: "user-1", sink });
    const other = await saveMeasurement(freshDb(), { ...empty, waistCm: 84 }, { userId: "user-2", sink });
    expect(a.id).toBe(b.id);
    expect(other.id).not.toBe(a.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sortiert nach Datum und synchronisiert im Demo-Modus nichts", async () => {
    const db = freshDb();
    const entries: NewOutboxEntry[] = [];
    let n = 0;
    const options = { userId: null, sink: (e: NewOutboxEntry) => entries.push(e), uuid: () => `m-${++n}` };
    await saveMeasurement(db, { ...empty, measuredOn: "2026-11-06", bodyWeightKg: 82 }, options);
    await saveMeasurement(db, { ...empty, measuredOn: "2026-10-30", bodyWeightKg: 82.6 }, options);
    expect((await listMeasurements(db)).map((m) => m.measuredOn)).toEqual(["2026-10-30", "2026-11-06"]);
    expect(entries).toEqual([]);
  });
});
