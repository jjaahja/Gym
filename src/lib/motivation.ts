import type { MuscleSlug } from "@/data/catalog/muscles";
import type { CompletedSession, Measurement, NutritionDay } from "@/lib/offline/db";
import { bestsFrom } from "@/lib/training/records";
import { localDay, mondayOf } from "@/lib/training/schedule";
import { isHardSet, muscleVolume } from "@/lib/training/volume";

// Motivation: Wochenziel mit Serie und Monatsrückblick – nur aus vorhandenen Daten, ohne Punkte oder Abzeichen.

/** Montag der Woche (lokal) als YYYY-MM-DD */
export const weekKey = (date: Date) => localDay(mondayOf(date));

export interface WeekStreak {
  thisWeek: number;
  goal: number;
  reachedThisWeek: boolean;
  /** Wochen in Folge mit erreichtem Ziel (die laufende zählt, sobald erreicht; bis Sonntag bricht sie die Serie nicht) */
  streak: number;
  best: number;
}

export function weeklyStreak(sessions: readonly Pick<CompletedSession, "startedAt">[], goal: number, now: Date): WeekStreak {
  const target = Math.max(1, Math.round(goal));
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const key = weekKey(new Date(s.startedAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const current = weekKey(now);
  const thisWeek = counts.get(current) ?? 0;
  const reached = (key: string) => (counts.get(key) ?? 0) >= target;
  const previous = (key: string) => {
    const d = new Date(`${key}T12:00:00`);
    d.setDate(d.getDate() - 7);
    return localDay(d);
  };

  let streak = 0;
  for (let key = reached(current) ? current : previous(current); reached(key); key = previous(key)) streak++;

  // beste Serie über alle Wochen seit dem ersten Training
  let best = 0;
  let run = 0;
  const first = [...counts.keys()].sort()[0];
  if (first) {
    for (let key = current; key >= first; key = previous(key)) {
      if (reached(key)) best = Math.max(best, ++run);
      else if (key !== current) run = 0;
    }
  }
  return { thisWeek, goal: target, reachedThisWeek: reached(current), streak, best: Math.max(best, streak) };
}

// ─────────────────────────── Monatsrückblick ───────────────────────────

export interface MonthReview {
  /** YYYY-MM */
  month: string;
  label: string;
  trainings: number;
  minutes: number;
  hardSets: number;
  /** bewegte Last (Gewicht × Wdh. der Arbeitssätze) in kg */
  tonnageKg: number;
  /** Übungen mit neuem Bestwert (geschätztes 1RM) gegenüber allem davor */
  records: { exerciseId: string; before: number; best: number }[];
  topMuscles: { muscle: MuscleSlug; sets: number }[];
  previous: { trainings: number; hardSets: number; tonnageKg: number } | null;
  bodyWeight: { from: number; to: number } | null;
  proteinAverage: number | null;
}

const monthOf = (iso: string) => localDay(new Date(iso)).slice(0, 7);

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

function totals(sessions: readonly CompletedSession[]) {
  let hardSets = 0;
  let tonnageKg = 0;
  let minutes = 0;
  for (const s of sessions) {
    minutes += Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000);
    for (const e of s.exercises)
      for (const set of e.sets) {
        if (isHardSet(set)) hardSets++;
        if (set.setType !== "warmup" && set.weightKg && set.reps) tonnageKg += set.weightKg * set.reps;
      }
  }
  return { hardSets, tonnageKg: Math.round(tonnageKg), minutes: Math.round(minutes) };
}

export function monthlyReview(
  all: readonly CompletedSession[],
  month: string,
  extra: { measurements?: readonly Measurement[]; nutrition?: readonly NutritionDay[] } = {},
): MonthReview {
  const inMonth = all.filter((s) => monthOf(s.startedAt) === month);
  const before = all.filter((s) => monthOf(s.startedAt) < month);
  const prevMonth = previousMonth(month);
  const prevSessions = all.filter((s) => monthOf(s.startedAt) === prevMonth);
  const t = totals(inMonth);

  const exerciseIds = [...new Set(inMonth.flatMap((s) => s.exercises.map((e) => e.exerciseId)))];
  // Bestwert: besser als alles davor – auch innerhalb des Monats (das allererste Training ist nur der Ausgangswert)
  const ordered = [...inMonth].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const records = exerciseIds.flatMap((id) => {
    const start = bestsFrom(before, id).e1rm?.value ?? null;
    let reference = start;
    let best: number | null = null;
    for (const session of ordered) {
      const value = bestsFrom([session], id).e1rm?.value;
      if (value == null) continue;
      if (reference == null) {
        reference = value;
        continue;
      }
      if (value > Math.max(reference, best ?? 0)) best = value;
    }
    return best != null && reference != null ? [{ exerciseId: id, before: start ?? reference, best }] : [];
  });
  records.sort((a, b) => b.best / b.before - a.best / a.before);

  const volume = muscleVolume(inMonth.flatMap((s) => s.exercises));
  const topMuscles = [...volume.entries()]
    .map(([muscle, v]) => ({ muscle, sets: Math.round(v.total) }))
    .sort((a, b) => b.sets - a.sets)
    .slice(0, 3);

  const weights = (extra.measurements ?? []).filter((m) => m.measuredOn.slice(0, 7) === month && m.bodyWeightKg != null).sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  const protein = (extra.nutrition ?? []).filter((n) => n.day.slice(0, 7) === month && n.proteinG != null);

  return {
    month,
    label: monthLabel(month),
    trainings: inMonth.length,
    minutes: t.minutes,
    hardSets: t.hardSets,
    tonnageKg: t.tonnageKg,
    records,
    topMuscles,
    previous: prevSessions.length ? { trainings: prevSessions.length, ...(({ hardSets, tonnageKg }) => ({ hardSets, tonnageKg }))(totals(prevSessions)) } : null,
    bodyWeight: weights.length >= 2 ? { from: weights[0].bodyWeightKg!, to: weights.at(-1)!.bodyWeightKg! } : null,
    proteinAverage: protein.length ? Math.round(protein.reduce((sum, n) => sum + n.proteinG!, 0) / protein.length) : null,
  };
}

/** Rückblick anbieten: in den ersten 7 Tagen eines Monats für den Vormonat, wenn dort trainiert wurde. */
export function reviewDue(sessions: readonly Pick<CompletedSession, "startedAt">[], now: Date): string | null {
  if (now.getDate() > 7) return null;
  const last = previousMonth(localDay(now).slice(0, 7));
  return sessions.some((s) => monthOf(s.startedAt) === last) ? last : null;
}

// ─────────────────────────── Erinnerungen ───────────────────────────

export interface ReminderPlanDay {
  name: string;
  weekday: number | null;
  estimatedMinutes: number;
}

/** Eine Erinnerung je fest geplantem Trainingstag zur gewählten Uhrzeit. */
export function reminderSlots(days: readonly ReminderPlanDay[], time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return days
    .filter((d): d is ReminderPlanDay & { weekday: number } => d.weekday != null)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, hour, minute, title: `Heute: ${d.name}`, body: `ca. ${d.estimatedMinutes} min – dein Training wartet.` }));
}
