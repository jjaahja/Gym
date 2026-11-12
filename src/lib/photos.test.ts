import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB } from "@/lib/offline/db";
import { flushOutbox, nextBatch, type NewOutboxEntry, type SyncBackend } from "@/lib/offline/outbox";
import { enqueueMany } from "@/lib/offline/outbox";
import { addPhoto, centerCrop, comparisonPair, deletePhoto, latestOfPose, measurementNear, scaledSize, spanLabel } from "./photos";

const USER = "11111111-2222-4333-8444-555555555555";
const newDb = () => new GymDB(`photos-${Math.random()}`, { indexedDB: new IDBFactory(), IDBKeyRange });

describe("Fortschrittsfotos", () => {
  it("verkleinert auf höchstens 1600 px an der längsten Kante, nie vergrößern", () => {
    expect(scaledSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("lädt erst die Datei hoch, dann die Zeile – beim Löschen umgekehrt", async () => {
    const db = newDb();
    const entries: NewOutboxEntry[] = [];
    const sink = (e: NewOutboxEntry) => entries.push(e);
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const photo = await addPhoto(db, { blob, width: 1200, height: 1600, pose: "front", takenOn: "2026-11-12" }, { userId: USER, sink, uuid: () => "p1" });
    expect(photo.storagePath).toBe(`${USER}/p1.jpg`);
    expect(entries.map((e) => `${e.op}:${e.table}`)).toEqual(["upsert:photo_files", "upsert:progress_photos"]);
    expect(entries[1].payload).toMatchObject({ user_id: USER, pose: "front", storage_path: `${USER}/p1.jpg`, taken_on: "2026-11-12" });
    expect((await db.photos.get("p1"))?.blob).toBeDefined();

    entries.length = 0;
    await deletePhoto(db, photo, { userId: USER, sink });
    expect(entries.map((e) => `${e.op}:${e.table}`)).toEqual(["delete:progress_photos", "delete:photo_files"]);
    expect(entries[1].payload).toEqual({ id: "p1", path: `${USER}/p1.jpg` });
    expect(await db.photos.get("p1")).toBeUndefined();
  });

  it("ohne Konto (Demo) bleibt alles lokal", async () => {
    const db = newDb();
    const entries: NewOutboxEntry[] = [];
    const photo = await addPhoto(db, { blob: new Blob(["x"]), width: 10, height: 10, pose: "side", takenOn: "2026-11-12" }, { userId: null, sink: (e) => entries.push(e) });
    expect(photo.storagePath).toBeNull();
    expect(entries).toEqual([]);
  });

  it("überträgt Dateien einzeln und vor den Zeilen; schon gelöschte Dateien werden übersprungen", async () => {
    const db = newDb();
    const calls: string[] = [];
    const backend: SyncBackend = {
      upsert: async (table, row) => void calls.push(`upsert:${table}:${String(row.id)}`),
      upsertMany: async (table, rows) => void calls.push(`many:${table}:${rows.length}`),
      remove: async (table) => void calls.push(`remove:${table}`),
    };
    const entries: NewOutboxEntry[] = [];
    const sink = (e: NewOutboxEntry) => entries.push(e);
    for (const id of ["a", "b"]) await addPhoto(db, { blob: new Blob(["x"]), width: 1, height: 1, pose: "front", takenOn: "2026-11-12" }, { userId: USER, sink, uuid: () => id });
    await enqueueMany(db, entries);
    const all = await db.outbox.orderBy("seq").toArray();
    expect(nextBatch(all)).toHaveLength(1);
    await flushOutbox(db, backend);
    expect(calls).toEqual(["upsert:photo_files:a", "upsert:progress_photos:a", "upsert:photo_files:b", "upsert:progress_photos:b"]);
  });

  it("wählt das älteste und neueste Foto einer Pose und das letzte als Vorlage", () => {
    const p = (id: string, takenOn: string, pose: "front" | "side" = "front") => ({ id, takenOn, pose, storagePath: null, width: 1, height: 1, createdAt: `${takenOn}T10:00:00Z` });
    const photos = [p("2", "2026-10-01"), p("1", "2026-09-01"), p("3", "2026-11-01"), p("s", "2026-12-01", "side")];
    expect(comparisonPair(photos, "front")).toMatchObject({ before: { id: "1" }, after: { id: "3" } });
    expect(comparisonPair(photos, "side")).toBeNull();
    expect(latestOfPose(photos, "front")?.id).toBe("3");
    expect(spanLabel("2026-09-01", "2026-11-01")).toBe("nach 9 Wochen");
    expect(spanLabel("2026-09-01", "2026-09-04")).toBe("nach 3 Tagen");
    expect(spanLabel("2026-01-01", "2026-07-01")).toBe("nach 6 Monaten");
  });

  it("schneidet mittig auf 3:4 zu und findet die Messung am Fototag", () => {
    expect(centerCrop(1920, 1080)).toEqual({ sx: 555, sy: 0, sw: 810, sh: 1080 });
    expect(centerCrop(1080, 1920)).toEqual({ sx: 0, sy: 240, sw: 1080, sh: 1440 });
    const m = (measuredOn: string, bodyWeightKg: number | null) => ({ measuredOn, bodyWeightKg });
    const list = [m("2026-11-01", 82), m("2026-11-10", null), m("2026-11-11", 81)];
    expect(measurementNear(list, "2026-11-12")?.bodyWeightKg).toBe(81);
    expect(measurementNear(list, "2026-11-20")).toBeNull();
  });
});
