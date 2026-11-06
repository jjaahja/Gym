import { getExerciseById } from "@/lib/catalog";
import type { SetType } from "@/lib/db/enums";
import { estimateDayMinutes, type PlannedExercise } from "@/lib/training/plan-generator";
import { addDays, isoWeekday, localDay, parseDay, type Weekday } from "@/lib/training/schedule";
import type { StoredPlan } from "@/stores/plan-store";

// Trainingstage als iCalendar (RFC 5545): je Trainingstag ein wöchentlich wiederkehrender Termin, dazu Deload-Woche
// und Mesozyklus-Auswertung als ganztägige Termine. Genutzt für den einmaligen Export und das Kalender-Abo.
// Uhrzeit als „floating time“ (ohne Zeitzone): Der Termin liegt immer zur gewählten Ortszeit.

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export interface IcsDay {
  id: string;
  name: string;
  weekday: Weekday | null;
  minutes: number;
  exercises: { name: string; sets: number; repsMin: number; repsMax: number }[];
}

/** Neutrale Sicht auf den Plan – aus dem lokalen Plan oder aus dem Abo-Feed der Datenbank. */
export interface IcsSchedule {
  planId: string;
  name: string;
  days: IcsDay[];
  /** Beginn der Deload-Woche (ISO) */
  deloadWeekStart?: string | null;
  /** Beginn des laufenden Mesozyklus (ISO) und Länge in Wochen → Termin für die Auswertung */
  cycleStartedAt?: string | null;
  mesocycleWeeks?: number;
}

/** Text nach RFC 5545 maskieren. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen über 75 Byte falten (Folgezeilen beginnen mit Leerzeichen). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes.encode(current + ch).length > limit) {
      parts.push(current);
      current = ch;
    } else current += ch;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");
const floating = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const dateValue = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Nächstes Datum (ab `from`) mit diesem Wochentag zur gewählten Uhrzeit. */
export function nextOccurrence(weekday: Weekday, time: string, from: Date): Date {
  const [h, m] = time.split(":").map(Number);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m);
  const offset = (weekday - isoWeekday(start) + 7) % 7;
  return addDays(start, offset);
}

export function scheduleFromPlan(plan: StoredPlan): IcsSchedule {
  return {
    planId: plan.id,
    name: plan.name,
    deloadWeekStart: plan.deloadWeekStart,
    cycleStartedAt: plan.cycleStartedAt,
    mesocycleWeeks: plan.mesocycleWeeks,
    days: plan.days.map((d) => ({
      id: d.id,
      name: d.name,
      weekday: d.weekday,
      minutes: d.estimatedMinutes,
      exercises: d.exercises.map((e) => ({
        name: getExerciseById(e.exerciseId)?.nameDe ?? "Übung",
        sets: e.sets,
        repsMin: e.repsMin,
        repsMax: e.repsMax,
      })),
    })),
  };
}

/** Antwort der Datenbankfunktion calendar_feed(token). */
export interface CalendarFeedRow {
  event_time: string;
  reminder_minutes: number;
  plan: {
    id: string;
    name: string;
    started_at: string | null;
    cycle_started_at: string | null;
    mesocycle_weeks: number;
    deload_week_start: string | null;
    days: {
      id: string;
      name: string;
      weekday: number | null;
      exercises: {
        exercise_id: string;
        sets: number;
        reps_min: number;
        reps_max: number;
        rest_seconds: number;
        last_set_technique: SetType | null;
      }[];
    }[];
  } | null;
}

export function scheduleFromFeed(feed: CalendarFeedRow): IcsSchedule | null {
  const plan = feed.plan;
  if (!plan) return null;
  return {
    planId: plan.id,
    name: plan.name,
    deloadWeekStart: plan.deload_week_start,
    cycleStartedAt: plan.cycle_started_at,
    mesocycleWeeks: plan.mesocycle_weeks,
    days: plan.days.map((d) => ({
      id: d.id,
      name: d.name,
      weekday: (d.weekday as Weekday | null) ?? null,
      // Dauer wie in der App aus Sätzen, Pausen und Übungsart
      minutes: estimateDayMinutes(
        d.exercises.map(
          (e) => ({ exerciseId: e.exercise_id, sets: e.sets, restSeconds: e.rest_seconds, lastSetTechnique: e.last_set_technique }) as PlannedExercise,
        ),
      ),
      exercises: d.exercises.map((e) => ({
        name: getExerciseById(e.exercise_id)?.nameDe ?? "Übung",
        sets: e.sets,
        repsMin: e.reps_min,
        repsMax: e.reps_max,
      })),
    })),
  };
}

export interface IcsOptions {
  /** HH:MM Ortszeit */
  time: string;
  /** Erinnerung in Minuten vorher (0 = keine) */
  reminderMinutes: number;
  now: Date;
  appUrl?: string;
  /** erster Termin frühestens ab diesem Tag (Standard: heute) */
  from?: Date;
  /** Kalendername */
  calendarName?: string;
}

export function buildIcs(schedule: IcsSchedule, options: IcsOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gym//Trainingsplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(options.calendarName ?? `Training · ${schedule.name}`)}`,
    // Hinweis für Abo-Clients: stündlich nachsehen (Apple respektiert das, Google entscheidet selbst)
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const stamp = utcStamp(options.now);
  const from = options.from ?? options.now;

  for (const day of [...schedule.days].sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9))) {
    if (day.weekday == null) continue;
    const start = nextOccurrence(day.weekday, options.time, from);
    const end = new Date(start.getTime() + Math.max(30, day.minutes) * 60_000);
    const exercises = day.exercises.map((e) => `• ${e.name} – ${e.sets} × ${e.repsMin}–${e.repsMax}`).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${day.id}@gym-plan`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${floating(start)}`,
      `DTEND:${floating(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[day.weekday - 1]}`,
      `SUMMARY:${icsEscape(`Training: ${day.name}`)}`,
      `DESCRIPTION:${icsEscape(`${exercises}${options.appUrl ? `\n\nIn der App starten: ${options.appUrl}/dashboard` : ""}`)}`,
      ...(options.appUrl ? [`URL:${options.appUrl}/dashboard`] : []),
      "CATEGORIES:Training",
    );
    if (options.reminderMinutes > 0) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape(`Gleich Training: ${day.name}`)}`,
        `TRIGGER:-PT${options.reminderMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }

  const allDay = (uid: string, date: Date, days: number, summary: string, description: string) =>
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@gym-plan`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(date)}`,
      `DTEND;VALUE=DATE:${dateValue(addDays(date, days))}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      "TRANSP:TRANSPARENT",
      "CATEGORIES:Training",
      "END:VEVENT",
    );

  if (schedule.deloadWeekStart) {
    const start = parseDay(localDay(new Date(schedule.deloadWeekStart)));
    if (addDays(start, 7) > options.now) {
      allDay(`deload-${schedule.planId}-${dateValue(start)}`, start, 7, "Deload-Woche",
        "Gleiche Übungen und Gewichte, etwa halbe Sätze, 3–4 Wiederholungen im Tank. Ermüdung abbauen, danach geht es weiter.");
    }
  }
  if (schedule.cycleStartedAt && schedule.mesocycleWeeks) {
    const review = parseDay(localDay(addDays(new Date(schedule.cycleStartedAt), schedule.mesocycleWeeks * 7)));
    allDay(`review-${schedule.planId}-${dateValue(review)}`, review, 1, "Mesozyklus-Auswertung",
      `Plan an deine Daten anpassen: Volumen, Deload und Übungswechsel – in der App unter „Plan“.${options.appUrl ? `\n${options.appUrl}/dashboard` : ""}`);
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
