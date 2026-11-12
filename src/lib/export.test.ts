import { describe, expect, it } from "vitest";
import type { CompletedSession } from "@/lib/offline/db";
import { exercises } from "@/lib/catalog";
import { buildExport, setsCsv } from "./export";

const bench = exercises.find((e) => e.slug === "barbell-bench-press")!;
const session: CompletedSession = {
  id: "s1",
  planId: null,
  planDayId: "d1",
  startedAt: "2026-11-12T17:00:00.000Z",
  endedAt: "2026-11-12T18:00:00.000Z",
  sessionRpe: 8,
  exerciseIds: [bench.id],
  exercises: [
    {
      logId: "l1",
      exerciseId: bench.id,
      planExerciseId: null,
      pumpRating: null,
      jointDiscomfort: null,
      sets: [
        { id: "a", setIndex: 0, setType: "warmup", weightKg: 40, reps: 10, durationSeconds: null, rir: null },
        { id: "b", setIndex: 1, setType: "working", weightKg: 62.5, reps: 8, durationSeconds: null, rir: 2 },
      ],
    },
  ],
};

describe("Datenexport", () => {
  it("CSV im deutschen Format mit Kopfzeile, BOM und Dezimalkomma", () => {
    const csv = setsCsv([session], () => 'Oberkörper "A"');
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("Datum;Uhrzeit;Training;Übung;Satz;Art;Gewicht (kg);Wiederholungen;RIR;Sekunden");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^12\.11\.2026;\d\d:00;"Oberkörper ""A""";Bankdrücken/);
    expect(lines[2]).toMatch(/;2;Arbeitssatz;62,5;8;2;$/);
  });

  it("JSON enthält alle Bereiche, Fotos nur als Metadaten", () => {
    const data = buildExport(
      {
        plan: null,
        adaptations: [],
        sessions: [session],
        measurements: [],
        notes: [{ exerciseId: bench.id, note: "Griff eng", updatedAt: "" }],
        nutrition: [],
        photos: [{ id: "p", takenOn: "2026-11-12", pose: "front", storagePath: "u/p.jpg", width: 10, height: 10, createdAt: "", blob: new Blob(["x"]) }],
        calibrations: [],
        settings: { unitSystem: "metric" },
        email: "a@b.de",
      },
      new Date("2026-11-12T20:00:00Z"),
    );
    expect(data).toMatchObject({ format: "gym-export", version: 1, exportedAt: "2026-11-12T20:00:00.000Z", account: { email: "a@b.de" } });
    expect(data.sessions[0].exercises[0].exerciseName).toBe(bench.nameDe);
    expect(data.exerciseNotes[0].exerciseName).toBe(bench.nameDe);
    expect(data.progressPhotos[0]).toEqual({ id: "p", takenOn: "2026-11-12", pose: "front", width: 10, height: 10 });
    expect(JSON.stringify(data)).not.toContain("storagePath");
  });
});
