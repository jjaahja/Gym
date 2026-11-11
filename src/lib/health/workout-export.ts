import { getExerciseById } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";

// Ein Training als Health-Connect-Einheit: Krafttraining mit einem Segment je Satz (Übung + Wiederholungen) und
// geschätzten aktiven Kalorien. Gewichte kennt Health Connect für Sätze nicht.

/** ExerciseSegment-Konstanten aus androidx.health.connect (connect-client 1.1.0) */
export const SEGMENT = {
  ARM_CURL: 1,
  BACK_EXTENSION: 2,
  BARBELL_SHOULDER_PRESS: 4,
  BENCH_PRESS: 5,
  CRUNCH: 10,
  DEADLIFT: 11,
  DOUBLE_ARM_TRICEPS_EXTENSION: 12,
  DUMBBELL_LATERAL_RAISE: 16,
  DUMBBELL_ROW: 17,
  DUMBBELL_TRICEPS_EXTENSION_TWO_ARM: 20,
  HIP_THRUST: 25,
  LATERAL_RAISE: 30,
  LAT_PULL_DOWN: 31,
  LEG_CURL: 32,
  LEG_EXTENSION: 33,
  LEG_PRESS: 34,
  LEG_RAISE: 35,
  LUNGE: 36,
  PLANK: 41,
  PULL_UP: 42,
  SHOULDER_PRESS: 48,
  SQUAT: 51,
  WEIGHTLIFTING: 65,
} as const;

/** Übung → Segmenttyp; alles ohne eigenen Typ zählt als allgemeines Krafttraining. */
const SEGMENT_BY_SLUG: Record<string, number> = {
  "barbell-bench-press": SEGMENT.BENCH_PRESS,
  "dumbbell-bench-press": SEGMENT.BENCH_PRESS,
  "incline-dumbbell-press": SEGMENT.BENCH_PRESS,
  "machine-chest-press": SEGMENT.BENCH_PRESS,
  "overhead-press": SEGMENT.BARBELL_SHOULDER_PRESS,
  "seated-dumbbell-shoulder-press": SEGMENT.SHOULDER_PRESS,
  "dumbbell-lateral-raise": SEGMENT.DUMBBELL_LATERAL_RAISE,
  "cable-lateral-raise": SEGMENT.LATERAL_RAISE,
  "band-lateral-raise": SEGMENT.LATERAL_RAISE,
  "pull-up": SEGMENT.PULL_UP,
  "lat-pulldown": SEGMENT.LAT_PULL_DOWN,
  "band-lat-pulldown": SEGMENT.LAT_PULL_DOWN,
  "straight-arm-pulldown": SEGMENT.LAT_PULL_DOWN,
  "one-arm-dumbbell-row": SEGMENT.DUMBBELL_ROW,
  "chest-supported-dumbbell-row": SEGMENT.DUMBBELL_ROW,
  "ez-bar-curl": SEGMENT.ARM_CURL,
  "dumbbell-curl": SEGMENT.ARM_CURL,
  "incline-dumbbell-curl": SEGMENT.ARM_CURL,
  "hammer-curl": SEGMENT.ARM_CURL,
  "cable-curl": SEGMENT.ARM_CURL,
  "band-curl": SEGMENT.ARM_CURL,
  "overhead-cable-triceps-extension": SEGMENT.DOUBLE_ARM_TRICEPS_EXTENSION,
  "cable-triceps-pushdown": SEGMENT.DOUBLE_ARM_TRICEPS_EXTENSION,
  "ez-skull-crusher": SEGMENT.DOUBLE_ARM_TRICEPS_EXTENSION,
  "overhead-dumbbell-triceps-extension": SEGMENT.DUMBBELL_TRICEPS_EXTENSION_TWO_ARM,
  "barbell-back-squat": SEGMENT.SQUAT,
  "goblet-squat": SEGMENT.SQUAT,
  "leg-press": SEGMENT.LEG_PRESS,
  "bulgarian-split-squat": SEGMENT.LUNGE,
  "walking-lunge": SEGMENT.LUNGE,
  deadlift: SEGMENT.DEADLIFT,
  "romanian-deadlift": SEGMENT.DEADLIFT,
  "dumbbell-romanian-deadlift": SEGMENT.DEADLIFT,
  "single-leg-romanian-deadlift": SEGMENT.DEADLIFT,
  "back-extension": SEGMENT.BACK_EXTENSION,
  "barbell-hip-thrust": SEGMENT.HIP_THRUST,
  "glute-bridge": SEGMENT.HIP_THRUST,
  "seated-leg-curl": SEGMENT.LEG_CURL,
  "lying-leg-curl": SEGMENT.LEG_CURL,
  "nordic-hamstring-curl": SEGMENT.LEG_CURL,
  "leg-extension": SEGMENT.LEG_EXTENSION,
  "cable-crunch": SEGMENT.CRUNCH,
  crunch: SEGMENT.CRUNCH,
  "hanging-leg-raise": SEGMENT.LEG_RAISE,
  plank: SEGMENT.PLANK,
};

export const segmentTypeFor = (slug: string) => SEGMENT_BY_SLUG[slug] ?? SEGMENT.WEIGHTLIFTING;

/**
 * MET-Werte aus dem 2024 Adult Compendium of Physical Activities (Herrmann et al. 2024):
 * 02054 „Resistance (weight) training, multiple exercises, 8–15 reps at varied resistance“ = 3,5;
 * 02050 „… power lifting or body building, vigorous effort“ = 6,0. Ab Session-RPE 8 gilt die Einheit als intensiv.
 */
export const MET_MODERATE = 3.5;
export const MET_VIGOROUS = 6.0;

/** Aktive Kalorien (über dem Ruheumsatz, daher MET − 1). Grob: ±30–50 %. */
export function activeCalories(durationMs: number, bodyWeightKg: number, sessionRpe: number | null): number {
  const met = sessionRpe != null && sessionRpe >= 8 ? MET_VIGOROUS : MET_MODERATE;
  return Math.round((met - 1) * bodyWeightKg * (durationMs / 3_600_000));
}

export interface WorkoutPayload {
  id: string;
  title: string;
  notes: string;
  startTime: string;
  endTime: string;
  version: number;
  segments: { startTime: string; endTime: string; type: number; repetitions: number }[];
  activeCaloriesKcal: number | null;
}

/** Dauer eines Satzes, geschätzt: ca. 3,5 s je Wiederholung + Ansetzen, 15–120 s. */
const setSeconds = (reps: number | null, duration: number | null) =>
  duration != null && duration > 0 ? duration : Math.min(120, Math.max(15, Math.round((reps ?? 8) * 3.5 + 5)));

export function buildWorkoutPayload(
  session: CompletedSession,
  options: {
    title: string;
    bodyWeightKg: number | null;
    /** Zeitpunkt je Satz (id → ISO), direkt nach dem Training bekannt; ältere Trainings: gleichmäßig verteilt */
    setTimes?: ReadonlyMap<string, string>;
  },
): WorkoutPayload {
  const start = Date.parse(session.startedAt);
  const end = Math.max(Date.parse(session.endedAt), start + 60_000);

  const sets = session.exercises.flatMap((e) => {
    const type = segmentTypeFor(getExerciseById(e.exerciseId)?.slug ?? "");
    return [...e.sets].sort((a, b) => a.setIndex - b.setIndex).map((s) => ({ s, type, at: options.setTimes?.get(s.id) }));
  });
  const timed = sets.length > 0 && sets.every((x) => x.at);
  const segments: WorkoutPayload["segments"] = [];

  if (timed) {
    // Segment endet beim Eintragen des Satzes, Beginn geschätzt, ohne Überlappung
    let previousEnd = start;
    for (const { s, type, at } of [...sets].sort((a, b) => a.at!.localeCompare(b.at!))) {
      const segmentEnd = Math.min(end, Date.parse(at!));
      const segmentStart = Math.max(previousEnd, start, segmentEnd - setSeconds(s.reps, s.durationSeconds) * 1000);
      if (segmentEnd - segmentStart < 1000) continue;
      segments.push({ startTime: new Date(segmentStart).toISOString(), endTime: new Date(segmentEnd).toISOString(), type, repetitions: s.reps ?? 0 });
      previousEnd = segmentEnd;
    }
  } else {
    // ohne Zeitpunkte: Sätze in Reihenfolge gleichmäßig über die Einheit verteilt, jeweils am Ende ihres Abschnitts
    const slot = (end - start) / Math.max(1, sets.length);
    sets.forEach(({ s, type }, i) => {
      const segmentEnd = Math.round(start + (i + 1) * slot);
      const segmentStart = Math.max(Math.round(start + i * slot), segmentEnd - setSeconds(s.reps, s.durationSeconds) * 1000);
      if (segmentEnd - segmentStart < 1000) return;
      segments.push({ startTime: new Date(segmentStart).toISOString(), endTime: new Date(segmentEnd).toISOString(), type, repetitions: s.reps ?? 0 });
    });
  }

  const working = session.exercises.flatMap((e) => e.sets).filter((s) => s.setType !== "warmup");
  const exercises = session.exercises.filter((e) => e.sets.length > 0).length;
  return {
    id: session.id,
    title: options.title,
    notes: `${exercises} ${exercises === 1 ? "Übung" : "Übungen"} · ${working.length} ${working.length === 1 ? "Satz" : "Sätze"} – Gym-App`,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    version: Math.floor(end / 1000),
    segments,
    activeCaloriesKcal: options.bodyWeightKg ? activeCalories(end - start, options.bodyWeightKg, session.sessionRpe) : null,
  };
}
