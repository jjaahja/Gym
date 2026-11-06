import type { MuscleSlug } from "@/data/catalog/muscles";
import { getExerciseById, primaryMuscles } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import type { StoredPlan, StoredPlanDay } from "@/stores/plan-store";

// Wochentage und Kalender: Jeder Trainingstag des Plans hat einen festen Wochentag (ISO: 1 = Montag … 7 = Sonntag).
// Vergangene Tage zeigen, was wirklich trainiert wurde; künftige Tage, was geplant ist. Alles in lokaler Zeit.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;

export const weekdayShort = (d: Weekday) => WEEKDAY_SHORT[d - 1];
export const weekdayLong = (d: Weekday) => WEEKDAY_LONG[d - 1];

/** ISO-Wochentag in lokaler Zeit. */
export function isoWeekday(date: Date): Weekday {
  return (((date.getDay() + 6) % 7) + 1) as Weekday;
}

/** YYYY-MM-DD in lokaler Zeit. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

/** Montag der Woche (lokal, 00:00). */
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, 1 - isoWeekday(d));
}

/**
 * Vorschlag: Trainingstage möglichst gleichmäßig verteilen, damit jeder Muskel ~48 h Pause bekommt
 * (Ganzkörper an 3 Tagen → Mo/Mi/Fr). Das Wochenende bleibt bei bis zu 4 Tagen frei.
 */
export function defaultWeekdays(daysPerWeek: number): Weekday[] {
  const patterns: Record<number, Weekday[]> = {
    1: [3],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
  };
  return patterns[Math.min(6, Math.max(1, Math.round(daysPerWeek)))];
}

/** Muskeln, die ein Trainingstag direkt (primär) trainiert, nach Sätzen absteigend. */
export function dayFocus(day: Pick<StoredPlanDay, "exercises">): MuscleSlug[] {
  const sets = new Map<MuscleSlug, number>();
  for (const e of day.exercises) {
    const exercise = getExerciseById(e.exerciseId);
    if (!exercise) continue;
    for (const m of primaryMuscles(exercise)) sets.set(m, (sets.get(m) ?? 0) + e.sets);
  }
  return [...sets.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

/**
 * Warnung, wenn zwei Tage mit überwiegend denselben Muskeln direkt aufeinanderfolgen (auch So → Mo):
 * Für dieselben Muskeln sind etwa 48 h zwischen harten Einheiten üblich.
 */
export function recoveryWarnings(days: readonly Pick<StoredPlanDay, "name" | "weekday" | "exercises">[]): string[] {
  const scheduled = days.filter((d) => d.weekday != null).sort((a, b) => a.weekday! - b.weekday!);
  const warnings: string[] = [];
  for (let i = 0; i < scheduled.length; i++) {
    const a = scheduled[i];
    const b = scheduled[(i + 1) % scheduled.length];
    if (a === b) continue;
    const consecutive = b.weekday! - a.weekday! === 1 || (a.weekday === 7 && b.weekday === 1);
    if (!consecutive) continue;
    const shared = dayFocus(a).filter((m) => dayFocus(b).includes(m));
    if (shared.length >= 3) {
      warnings.push(
        `${a.name} (${weekdayShort(a.weekday as Weekday)}) und ${b.name} (${weekdayShort(b.weekday as Weekday)}) liegen direkt hintereinander und trainieren dieselben Muskeln – ein Tag Pause dazwischen erholt besser.`,
      );
    }
  }
  return warnings;
}

export function hasSchedule(plan: Pick<StoredPlan, "days">): boolean {
  return plan.days.length > 0 && plan.days.every((d) => d.weekday != null);
}

export function dayForWeekday(plan: Pick<StoredPlan, "days">, weekday: Weekday): StoredPlanDay | null {
  return plan.days.find((d) => d.weekday === weekday) ?? null;
}

// ─────────────────────────── Kalender ───────────────────────────

export type DayStatus = "done" | "planned" | "missed" | "rest";

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  weekday: Weekday;
  /** gehört zum angezeigten Monat */
  inMonth: boolean;
  today: boolean;
  status: DayStatus;
  /** geplanter Trainingstag (laut Wochentag) */
  planned: StoredPlanDay | null;
  /** abgeschlossene Trainings an diesem Tag */
  sessions: CompletedSession[];
  deload: boolean;
  /** Mesozyklus endet → Auswertung fällig */
  mesocycleEnd: boolean;
}

interface ScheduleInput {
  plan: StoredPlan | null;
  sessions: readonly CompletedSession[];
  now: Date;
}

function sessionsByDay(sessions: readonly CompletedSession[]): Map<string, CompletedSession[]> {
  const map = new Map<string, CompletedSession[]>();
  for (const s of sessions) {
    const day = localDay(new Date(s.startedAt));
    map.set(day, [...(map.get(day) ?? []), s]);
  }
  return map;
}

/** Wurde dieser Trainingstag in derselben Kalenderwoche (Mo–So) erledigt – egal an welchem Tag? */
function doneThisWeek(dayId: string, date: Date, sessions: readonly CompletedSession[]): boolean {
  const from = mondayOf(date).getTime();
  const to = addDays(mondayOf(date), 7).getTime();
  return sessions.some((s) => {
    const t = new Date(s.startedAt).getTime();
    return s.planDayId === dayId && t >= from && t < to;
  });
}

/** Status eines einzelnen Tages. */
export function dayStatus(input: ScheduleInput, date: Date, byDay = sessionsByDay(input.sessions)): CalendarDay {
  const { plan, now } = input;
  const day = localDay(date);
  const today = localDay(now);
  const weekday = isoWeekday(date);
  const sessions = byDay.get(day) ?? [];
  const planned = plan && plan.days.some((d) => d.weekday != null) ? dayForWeekday(plan, weekday) : null;
  const planStart = plan ? localDay(new Date(plan.startedAt)) : null;
  const active = planned != null && planStart != null && day >= planStart;

  let status: DayStatus = "rest";
  if (sessions.length > 0) status = "done";
  else if (active && day >= today) status = "planned";
  else if (active && !doneThisWeek(planned!.id, date, input.sessions)) status = "missed";

  const deloadStart = plan?.deloadWeekStart ? localDay(new Date(plan.deloadWeekStart)) : null;
  const deloadEnd = plan?.deloadWeekStart ? localDay(addDays(new Date(plan.deloadWeekStart), 7)) : null;
  const cycleEnd = plan ? localDay(addDays(new Date(plan.cycleStartedAt), plan.mesocycleWeeks * 7)) : null;

  return {
    date: day,
    weekday,
    inMonth: true,
    today: day === today,
    status,
    planned: active ? planned : null,
    sessions,
    deload: deloadStart != null && day >= deloadStart && day < deloadEnd!,
    mesocycleEnd: cycleEnd === day,
  };
}

/** Monatsansicht: volle Wochen (Mo–So), die den Monat abdecken. `month` 0-basiert. */
export function calendarMonth(input: ScheduleInput, year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = mondayOf(first);
  const end = addDays(mondayOf(last), 6);
  const byDay = sessionsByDay(input.sessions);
  const days: CalendarDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push({ ...dayStatus(input, d, byDay), inMonth: d.getMonth() === month });
  }
  return days;
}

/** Die aktuelle Woche (Mo–So) für die Wochenleiste. */
export function currentWeek(input: ScheduleInput): CalendarDay[] {
  const byDay = sessionsByDay(input.sessions);
  const monday = mondayOf(input.now);
  return WEEKDAYS.map((_, i) => dayStatus(input, addDays(monday, i), byDay));
}

export interface NextWorkout {
  day: StoredPlanDay;
  date: string;
  isToday: boolean;
  /** Tage bis dahin (0 = heute) */
  inDays: number;
}

/** Nächstes geplantes Training ab heute (heute nur, wenn noch nicht trainiert). */
export function nextScheduled(input: ScheduleInput): NextWorkout | null {
  const { plan, now } = input;
  if (!plan || !hasSchedule(plan)) return null;
  const byDay = sessionsByDay(input.sessions);
  for (let i = 0; i < 8; i++) {
    const date = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), i);
    const status = dayStatus(input, date, byDay);
    if (status.status === "planned" && status.planned) {
      return { day: status.planned, date: status.date, isToday: i === 0, inDays: i };
    }
  }
  return null;
}

/** Verpasstes Training dieser Woche (noch nachholbar), das jüngste zuerst. */
export function missedThisWeek(input: ScheduleInput): CalendarDay | null {
  const week = currentWeek(input);
  const today = localDay(input.now);
  return [...week].reverse().find((d) => d.date < today && d.status === "missed") ?? null;
}

/** „Heute“, „Morgen“, „Mittwoch“ bzw. Datum. */
export function relativeDayLabel(date: string, now: Date): string {
  const diff = Math.round((parseDay(date).getTime() - parseDay(localDay(now)).getTime()) / 86_400_000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  if (diff > 1 && diff < 7) return weekdayLong(isoWeekday(parseDay(date)));
  return parseDay(date).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
}
