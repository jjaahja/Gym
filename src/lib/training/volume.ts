import type { MuscleSlug } from "@/data/catalog/muscles";
import { getExerciseById } from "@/lib/catalog";
import type { SetType } from "@/lib/db/enums";

// Harte Sätze pro Muskel – identische Regeln wie die View public.weekly_muscle_volume:
// - zählt nur abgeschlossene Sätze, keine Aufwärmsätze
// - „hart“ = RIR ≤ 4 oder ohne RIR-Angabe
// - Mitbeanspruchte Muskeln anteilig (contribution), Technik-Segmente zählen 0,5

export const TECHNIQUE_SET_TYPES: readonly SetType[] = ["dropset", "myo_reps", "rest_pause", "lengthened_partials"];

export interface VolumeSet {
  setType: SetType;
  rir: number | null;
  isCompleted?: boolean;
}

export interface VolumeExercise {
  exerciseId: string;
  sets: readonly VolumeSet[];
}

export function isHardSet(set: VolumeSet): boolean {
  return set.isCompleted !== false && set.setType !== "warmup" && (set.rir == null || set.rir <= 4);
}

export function setCredit(set: VolumeSet): number {
  return TECHNIQUE_SET_TYPES.includes(set.setType) ? 0.5 : 1;
}

export interface MuscleSets {
  /** fraktionale harte Sätze (inkl. Mitbeanspruchung) */
  total: number;
  /** nur als Hauptmuskel */
  direct: number;
}

export function muscleVolume(exercises: readonly VolumeExercise[]): Map<MuscleSlug, MuscleSets> {
  const result = new Map<MuscleSlug, MuscleSets>();
  for (const entry of exercises) {
    const exercise = getExerciseById(entry.exerciseId);
    if (!exercise) continue;
    const credit = entry.sets.filter(isHardSet).reduce((sum, s) => sum + setCredit(s), 0);
    if (credit === 0) continue;
    for (const m of exercise.muscles) {
      const current = result.get(m.muscle) ?? { total: 0, direct: 0 };
      current.total += credit * m.contribution;
      if (m.role === "primary") current.direct += credit;
      result.set(m.muscle, current);
    }
  }
  return result;
}

/** Montag 00:00 der Woche (lokale Zeit) – wie date_trunc('week', … at time zone p.timezone). */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Montag = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}
