import type { MuscleSlug } from "@/data/catalog/muscles";
import type { CompletedSession, CompletedSet } from "@/lib/offline/db";
import { estimateOneRepMax, performanceScore, type SessionPerformance } from "./progression";
import { muscleVolume, startOfWeek } from "./volume";

// Verlaufsauswertungen aus der lokalen Historie – gleiche Regeln wie die SQL-Views
// exercise_progress und exercise_feedback_summary.

export interface ProgressPoint extends SessionPerformance {
  sessionId: string;
  date: string;
  /** e1RM, sonst geschätzte Leistung aus Topgewicht und Ø-Wiederholungen */
  score: number | null;
  volumeLoadKg: number;
}

const countsForProgress = (s: CompletedSet) => s.setType !== "warmup";

/** Leistung je Einheit für eine Übung, chronologisch. */
export function exerciseSeries(sessions: readonly CompletedSession[], exerciseId: string): ProgressPoint[] {
  return [...sessions]
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
    .flatMap((session) => {
      const sets = session.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter(countsForProgress);
      if (sets.length === 0) return [];
      const e1rms = sets.map(estimateOneRepMax).filter((v): v is number => v != null);
      const weights = sets.map((s) => s.weightKg ?? 0);
      const working = sets.filter((s) => s.setType === "working");
      const perf: SessionPerformance = {
        bestE1rmKg: e1rms.length ? Math.max(...e1rms) : null,
        topWeightKg: Math.max(...weights),
        totalReps: working.reduce((n, s) => n + (s.reps ?? 0), 0),
        workingSets: working.length,
      };
      return [
        {
          ...perf,
          sessionId: session.id,
          date: session.endedAt,
          score: performanceScore(perf),
          volumeLoadKg: sets.reduce((n, s) => n + (s.weightKg ?? 0) * (s.reps ?? 0), 0),
        },
      ];
    });
}

export interface ExerciseUsage {
  exerciseId: string;
  sessions: number;
  lastDate: string;
}

/** Übungen mit Historie, häufigste zuerst. */
export function exercisesWithHistory(sessions: readonly CompletedSession[]): ExerciseUsage[] {
  const usage = new Map<string, ExerciseUsage>();
  for (const s of sessions)
    for (const id of new Set(s.exercises.filter((e) => e.sets.length > 0).map((e) => e.exerciseId))) {
      const u = usage.get(id) ?? { exerciseId: id, sessions: 0, lastDate: s.endedAt };
      u.sessions += 1;
      if (s.endedAt > u.lastDate) u.lastDate = s.endedAt;
      usage.set(id, u);
    }
  return [...usage.values()].sort((a, b) => b.sessions - a.sessions || b.lastDate.localeCompare(a.lastDate));
}

export interface WeekPoint {
  weekStart: Date;
  sets: number;
}

/** Harte Sätze je Kalenderwoche für einen Muskel, die letzten `weeks` Wochen inkl. leerer Wochen. */
export function weeklyMuscleSeries(sessions: readonly CompletedSession[], muscle: MuscleSlug, weeks: number, now: Date): WeekPoint[] {
  const current = startOfWeek(now);
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const inWeek = sessions.filter((s) => {
      const t = new Date(s.startedAt);
      return t >= weekStart && t < weekEnd;
    });
    const total = muscleVolume(inWeek.flatMap((s) => s.exercises)).get(muscle)?.total ?? 0;
    points.push({ weekStart, sets: Math.round(total * 10) / 10 });
  }
  return points;
}

export interface ExerciseFeedbackSummary {
  exerciseId: string;
  avgPump: number | null;
  avgJointDiscomfort: number | null;
  ratings: number;
}

const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);

/** Ø Pump und Gelenkbeschwerden je Übung (wie die View exercise_feedback_summary). */
export function exerciseFeedback(sessions: readonly CompletedSession[]): ExerciseFeedbackSummary[] {
  const byExercise = new Map<string, { pump: number[]; joint: number[] }>();
  for (const s of sessions)
    for (const e of s.exercises) {
      if (e.pumpRating == null && e.jointDiscomfort == null) continue;
      const entry = byExercise.get(e.exerciseId) ?? { pump: [], joint: [] };
      if (e.pumpRating != null) entry.pump.push(e.pumpRating);
      if (e.jointDiscomfort != null) entry.joint.push(e.jointDiscomfort);
      byExercise.set(e.exerciseId, entry);
    }
  return [...byExercise.entries()].map(([exerciseId, v]) => ({
    exerciseId,
    avgPump: avg(v.pump),
    avgJointDiscomfort: avg(v.joint),
    ratings: v.pump.length,
  }));
}

/** Gelenkbeschwerden je Einheit für eine Übung, chronologisch (null = nicht bewertet). */
export function jointHistory(sessions: readonly CompletedSession[], exerciseId: string): (number | null)[] {
  return [...sessions]
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
    .flatMap((s) => s.exercises.filter((e) => e.exerciseId === exerciseId && e.sets.length > 0).map((e) => e.jointDiscomfort));
}
