import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { generatePlan } from "@/lib/training/plan-generator";
import { createPlanStore, type AssessmentInput } from "@/stores/plan-store";
import { memory } from "@/test/device-history";
import { buildIcs, foldLine, icsEscape, nextOccurrence } from "./calendar-export";

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
    const ics = buildIcs(plan(), { time: "18:00", reminderMinutes: 30, now: new Date(2026, 10, 5, 12), appUrl: "https://gym.example" });
    const unfolded = ics.replaceAll("\r\n ", "");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(3);
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
    const ics = buildIcs(partial, { time: "18:00", reminderMinutes: 0, now: new Date(2026, 10, 5) });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).not.toContain("VALARM");
  });
});
