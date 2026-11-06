import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { generatePlan } from "@/lib/training/plan-generator";
import { getExercise } from "@/lib/catalog";
import { createPlanStore, type AssessmentInput } from "@/stores/plan-store";
import { memory } from "@/test/device-history";
import { buildIcs, foldLine, icsEscape, nextOccurrence, scheduleFromFeed, scheduleFromPlan, type CalendarFeedRow } from "./calendar-export";

const assessment: AssessmentInput = {
  goal: "hypertrophy", experience: "intermediate", trainingAgeMonths: 24, daysPerWeek: 3, sessionDurationMin: 60,
  preferredSplit: null, priorityMuscles: [], equipment: [...EQUIPMENT_PRESETS.gym], limitations: "",
};

function plan() {
  let n = 0;
  const store = createPlanStore({ sink: () => {}, storage: memory, uuid: () => `day-${++n}`, now: () => new Date(2026, 10, 2) });
  return store.getState().createPlan({ userId: null, assessment, generated: generatePlan(assessment), weekdays: [1, 3, 5] });
}

describe("Kalender-Export (.ics)", () => {
  it("maskiert Sonderzeichen und faltet lange Zeilen nach 75 Byte", () => {
    expect(icsEscape("A, B; C\\D\nE")).toBe("A\\, B\\; C\\\\D\\nE");
    const folded = foldLine(`DESCRIPTION:${"Ü".repeat(60)}`);
    expect(folded.split("\r\n ").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(folded.replaceAll("\r\n ", "")).toBe(`DESCRIPTION:${"Ü".repeat(60)}`);
  });

  it("findet den nächsten passenden Wochentag", () => {
    const thursday = new Date(2026, 10, 5, 12);
    expect(nextOccurrence(1, "18:30", thursday)).toEqual(new Date(2026, 10, 9, 18, 30));
    expect(nextOccurrence(4, "07:00", thursday)).toEqual(new Date(2026, 10, 5, 7, 0)); // heute
  });

  it("erzeugt je Trainingstag einen wöchentlichen Termin mit Übungen und Erinnerung", () => {
    const ics = buildIcs(scheduleFromPlan(plan()), { time: "18:00", reminderMinutes: 30, now: new Date(2026, 10, 5, 12), appUrl: "https://gym.example" });
    const unfolded = ics.replaceAll("\r\n ", "");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfolded.match(/RRULE:FREQ=WEEKLY/g)).toHaveLength(3);
    expect(unfolded).toContain("SUMMARY:Mesozyklus-Auswertung");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261207"); // 5 Wochen nach Planbeginn
    expect(unfolded).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(unfolded).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE");
    expect(unfolded).toContain("RRULE:FREQ=WEEKLY;BYDAY=FR");
    expect(unfolded).toContain("DTSTART:20261106T180000"); // nächster Freitag
    expect(unfolded).toContain("UID:day-");
    expect(unfolded).toContain("TRIGGER:-PT30M");
    expect(unfolded).toMatch(/SUMMARY:Training: Ganzkörper A/);
    expect(unfolded).toContain("URL:https://gym.example/dashboard");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("lässt Tage ohne Wochentag weg und Erinnerung optional", () => {
    const p = plan();
    const partial = { ...p, days: p.days.map((d, i) => (i === 0 ? { ...d, weekday: null } : d)) };
    const ics = buildIcs({ ...scheduleFromPlan(partial), cycleStartedAt: null }, { time: "18:00", reminderMinutes: 0, now: new Date(2026, 10, 5) });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).not.toContain("VALARM");
  });
});

describe("Kalender-Abo (Feed)", () => {
  const feed = (overrides: Partial<NonNullable<CalendarFeedRow["plan"]>> = {}): CalendarFeedRow => ({
    event_time: "07:30",
    reminder_minutes: 15,
    plan: {
      id: "plan-1",
      name: "Ganzkörper · Muskelaufbau & Optik",
      started_at: "2026-11-02T08:00:00+00:00",
      cycle_started_at: "2026-11-02T08:00:00+00:00",
      mesocycle_weeks: 5,
      deload_week_start: null,
      days: [
        {
          id: "day-a",
          name: "Ganzkörper A",
          weekday: 1,
          exercises: [
            { exercise_id: getExercise("barbell-back-squat")!.id, sets: 3, reps_min: 6, reps_max: 12, rest_seconds: 120, last_set_technique: null },
            { exercise_id: getExercise("cable-fly")!.id, sets: 2, reps_min: 10, reps_max: 20, rest_seconds: 60, last_set_technique: "dropset" },
          ],
        },
        { id: "day-b", name: "Ganzkörper B", weekday: null, exercises: [] },
      ],
      ...overrides,
    },
  });

  it("baut aus der Datenbank-Antwort den Plan mit deutschen Namen und Dauer wie in der App", () => {
    const schedule = scheduleFromFeed(feed())!;
    expect(schedule.days[0]).toMatchObject({ weekday: 1, exercises: [{ name: "Kniebeuge (Langhantel)", sets: 3 }, { name: "Kabel-Flys" }] });
    expect(schedule.days[0].minutes).toBeGreaterThan(10);
    expect(scheduleFromFeed({ ...feed(), plan: null })).toBeNull();
  });

  it("enthält die Deload-Woche als ganztägigen Termin, solange sie nicht vorbei ist", () => {
    const schedule = scheduleFromFeed(feed({ deload_week_start: "2026-11-09T10:00:00+00:00" }))!;
    const ics = buildIcs(schedule, { time: "07:30", reminderMinutes: 15, now: new Date(2026, 10, 10) }).replaceAll("\r\n ", "");
    expect(ics).toContain("SUMMARY:Deload-Woche");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261109");
    expect(ics).toContain("DTEND;VALUE=DATE:20261116");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    const later = buildIcs(schedule, { time: "07:30", reminderMinutes: 15, now: new Date(2026, 10, 20) });
    expect(later).not.toContain("Deload-Woche");
  });
});
