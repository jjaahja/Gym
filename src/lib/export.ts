import { getExerciseById } from "@/lib/catalog";
import type { CompletedSession, Measurement, NutritionDay, ExerciseNote, ProgressPhoto } from "@/lib/offline/db";
import { SET_TYPE_LABELS } from "@/lib/labels";
import type { Calibration } from "@/lib/training/rir-calibration";
import type { AdaptationRecord, StoredPlan } from "@/stores/plan-store";

// Datenexport: alles, was die App über dich speichert – als JSON (vollständig, maschinenlesbar) und die Sätze als CSV
// (für Excel/Numbers, deutsches Format: Semikolon, Dezimalkomma). Fotos sind nicht im JSON (Größe); sie lassen sich
// einzeln auf der Fotoseite speichern.

export interface ExportInput {
  plan: StoredPlan | null;
  adaptations: readonly AdaptationRecord[];
  sessions: readonly CompletedSession[];
  measurements: readonly Measurement[];
  notes: readonly ExerciseNote[];
  nutrition: readonly NutritionDay[];
  photos: readonly ProgressPhoto[];
  calibrations: readonly Calibration[];
  settings: Record<string, unknown>;
  email: string | null;
}

export function buildExport(input: ExportInput, now = new Date()) {
  return {
    format: "gym-export",
    version: 1,
    exportedAt: now.toISOString(),
    account: { email: input.email },
    settings: input.settings,
    plan: input.plan,
    adaptations: input.adaptations,
    sessions: input.sessions.map((s) => ({
      ...s,
      exercises: s.exercises.map((e) => ({ ...e, exerciseName: getExerciseById(e.exerciseId)?.nameDe ?? null })),
    })),
    measurements: input.measurements,
    exerciseNotes: input.notes.map((n) => ({ ...n, exerciseName: getExerciseById(n.exerciseId)?.nameDe ?? null })),
    nutrition: input.nutrition,
    rirCalibrations: input.calibrations,
    // nur Metadaten – die Bilddateien selbst einzeln über die Fotoseite
    progressPhotos: input.photos.map((p) => ({ id: p.id, takenOn: p.takenOn, pose: p.pose, width: p.width, height: p.height })),
  };
}

const cell = (v: string | number | null | undefined) => {
  if (v == null) return "";
  const text = typeof v === "number" ? v.toLocaleString("de-DE", { maximumFractionDigits: 2, useGrouping: false }) : v;
  return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Alle Sätze als CSV (eine Zeile je Satz). */
export function setsCsv(sessions: readonly CompletedSession[], dayName: (s: CompletedSession) => string): string {
  const header = ["Datum", "Uhrzeit", "Training", "Übung", "Satz", "Art", "Gewicht (kg)", "Wiederholungen", "RIR", "Sekunden"];
  const rows = [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .flatMap((s) => {
      const start = new Date(s.startedAt);
      const date = start.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
      const time = start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return s.exercises.flatMap((e) =>
        e.sets.map((set) =>
          [date, time, dayName(s), getExerciseById(e.exerciseId)?.nameDe ?? e.exerciseId, set.setIndex + 1, SET_TYPE_LABELS[set.setType], set.weightKg, set.reps, set.rir, set.durationSeconds]
            .map(cell)
            .join(";"),
        ),
      );
    });
  // BOM: Excel erkennt sonst die Umlaute nicht
  return "﻿" + [header.join(";"), ...rows].join("\r\n") + "\r\n";
}
