import { getExerciseById } from "@/lib/catalog";
import { addDays, isoWeekday, type Weekday } from "@/lib/training/schedule";
import type { StoredPlan } from "@/stores/plan-store";

// Export der Trainingstage als iCalendar-Datei (RFC 5545): je Trainingstag ein wöchentlich wiederkehrender Termin.
// Funktioniert mit Apple Kalender, Google Kalender und Outlook – ohne Konto-Verknüpfung.
// Uhrzeit als „floating time“ (ohne Zeitzone): Der Termin liegt immer zur gewählten Ortszeit.

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

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
const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Nächstes Datum (ab heute) mit diesem Wochentag zur gewählten Uhrzeit. */
export function nextOccurrence(weekday: Weekday, time: string, from: Date): Date {
  const [h, m] = time.split(":").map(Number);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m);
  const offset = (weekday - isoWeekday(start) + 7) % 7;
  return addDays(start, offset);
}

export interface ExportOptions {
  /** HH:MM Ortszeit */
  time: string;
  /** Erinnerung in Minuten vorher (0 = keine) */
  reminderMinutes: number;
  now: Date;
  appUrl?: string;
}

export function buildIcs(plan: StoredPlan, options: ExportOptions): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gym//Trainingsplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`Training · ${plan.name}`)}`,
  ];
  for (const day of [...plan.days].sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9))) {
    if (day.weekday == null) continue;
    const start = nextOccurrence(day.weekday, options.time, options.now);
    const end = new Date(start.getTime() + Math.max(30, day.estimatedMinutes) * 60_000);
    const exercises = day.exercises
      .map((e) => `• ${getExerciseById(e.exerciseId)?.nameDe ?? "Übung"} – ${e.sets} × ${e.repsMin}–${e.repsMax}`)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${day.id}@gym-plan`,
      `DTSTAMP:${utcStamp(options.now)}`,
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
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
