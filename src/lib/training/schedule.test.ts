import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import type { CompletedSession } from "@/lib/offline/db";
import { createPlanStore, type AssessmentInput, type StoredPlan } from "@/stores/plan-store";
import { memory } from "@/test/device-history";
import { generatePlan } from "./plan-generator";
import {
  calendarMonth,
  currentWeek,
  dayFocus,
  defaultWeekdays,
  isoWeekday,
  localDay,
  missedThisWeek,
  nextScheduled,
  recoveryWarnings,
  relativeDayLabel,
  type Weekday,
} from "./schedule";

const base: AssessmentInput = {
  goal: "hypertrophy",
  experience: "intermediate",
  trainingAgeMonths: 24,
  daysPerWeek: 3,
  sessionDurationMin: 60,
  preferredSplit: null,
  priorityMuscles: [],
  equipment: [...EQUIPMENT_PRESETS.gym],
  limitations: "",
};

/** Plan ab Montag, 2. November 2026 (lokal). */
function plan(weekdays: Weekday[], daysPerWeek = weekdays.length): StoredPlan {
  let n = 0;
  const store = createPlanStore({ sink: () => {}, storage: memory, uuid: () => `id-${++n}`, now: () => new Date(2026, 10, 2, 7) });
  const assessment = { ...base, daysPerWeek };
  return store.getState().createPlan({ userId: null, assessment, generated: generatePlan(assessment), weekdays });
}

function session(p: StoredPlan, dayIndex: number, date: Date): CompletedSession {
  return {
    id: `s-${localDay(date)}`,
    planId: p.id,
    planDayId: p.days[dayIndex].id,
    startedAt: date.toISOString(),
    endedAt: new Date(date.getTime() + 3600_000).toISOString(),
    sessionRpe: 8,
    exerciseIds: [],
    exercises: [],
  };
}

describe("Wochentage", () => {
  it("rechnet ISO-Wochentage in lokaler Zeit", () => {
    expect(isoWeekday(new Date(2026, 10, 2))).toBe(1); // Montag
    expect(isoWeekday(new Date(2026, 10, 8, 23, 59))).toBe(7); // Sonntag
  });

  it("verteilt Trainingstage gleichmäßig", () => {
    expect(defaultWeekdays(2)).toEqual([1, 4]);
    expect(defaultWeekdays(3)).toEqual([1, 3, 5]);
    expect(defaultWeekdays(4)).toEqual([1, 2, 4, 5]);
    expect(defaultWeekdays(7)).toHaveLength(6); // mindestens ein Ruhetag
  });

  it("ordnet die Wochentage den Plantagen der Reihe nach zu", () => {
    const p = plan([5, 1, 3]);
    expect(p.days.map((d) => d.weekday)).toEqual([1, 3, 5]);
    // falsche Anzahl → ohne festen Tag statt falsch zugeordnet
    expect(plan([1, 3], 3).days.map((d) => d.weekday)).toEqual([null, null, null]);
  });

  it("warnt bei Ganzkörper an aufeinanderfolgenden Tagen, nicht bei Mo/Mi/Fr oder Ober-/Unterkörper", () => {
    expect(recoveryWarnings(plan([1, 2, 3]).days).length).toBeGreaterThan(0);
    expect(recoveryWarnings(plan([1, 3, 5]).days)).toEqual([]);
    expect(recoveryWarnings(plan([1, 2, 4, 5]).days)).toEqual([]);
  });

  it("bestimmt die Hauptmuskeln eines Tages nach Sätzen", () => {
    const upper = plan([1, 2, 4, 5]).days[0];
    const focus = dayFocus(upper);
    expect(focus.length).toBeGreaterThan(3);
    expect(focus).not.toContain("quads");
  });
});

describe("Kalender", () => {
  const p = plan([1, 3, 5]); // Mo/Mi/Fr ab 2.11.2026

  it("zeigt erledigte, verpasste, geplante Tage und Ruhetage", () => {
    const now = new Date(2026, 10, 5, 12); // Donnerstag
    const sessions = [session(p, 0, new Date(2026, 10, 2, 18))]; // Montag erledigt, Mittwoch nicht
    const week = currentWeek({ plan: p, sessions, now });
    expect(week.map((d) => d.status)).toEqual(["done", "rest", "missed", "rest", "planned", "rest", "rest"]);
    expect(week[3].today).toBe(true);
    expect(missedThisWeek({ plan: p, sessions, now })?.date).toBe("2026-11-04");
    expect(nextScheduled({ plan: p, sessions, now })).toMatchObject({ date: "2026-11-06", inDays: 1, isToday: false, day: { dayIndex: 2 } });
  });

  it("nachgeholtes Training zählt nicht mehr als verpasst", () => {
    const now = new Date(2026, 10, 5, 20);
    const sessions = [session(p, 0, new Date(2026, 10, 2, 18)), session(p, 1, new Date(2026, 10, 5, 18))];
    const week = currentWeek({ plan: p, sessions, now });
    expect(week[2].status).toBe("rest"); // Mittwoch am Donnerstag nachgeholt
    expect(week[3].status).toBe("done");
    expect(missedThisWeek({ plan: p, sessions, now })).toBeNull();
  });

  it("heute zählt als geplant, bis trainiert wurde", () => {
    const monday = new Date(2026, 10, 9, 8);
    expect(nextScheduled({ plan: p, sessions: [], now: monday })).toMatchObject({ isToday: true, inDays: 0 });
    const done = [session(p, 0, new Date(2026, 10, 9, 7))];
    expect(nextScheduled({ plan: p, sessions: done, now: monday })).toMatchObject({ date: "2026-11-11", inDays: 2 });
  });

  it("vor Planbeginn gibt es nichts zu verpassen", () => {
    const week = currentWeek({ plan: p, sessions: [], now: new Date(2026, 9, 28, 12) });
    expect(week.every((d) => d.status === "rest")).toBe(true);
  });

  it("baut den Monat aus vollen Wochen und markiert Deload und Mesozyklus-Ende", () => {
    const withDeload = { ...p, deloadWeekStart: new Date(2026, 10, 16, 9).toISOString() };
    const days = calendarMonth({ plan: withDeload, sessions: [], now: new Date(2026, 10, 5) }, 2026, 10);
    expect(days).toHaveLength(42);
    expect(days[0].date).toBe("2026-10-26");
    expect(days.at(-1)!.date).toBe("2026-12-06");
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
    expect(days.filter((d) => d.deload).map((d) => d.date)).toEqual([
      "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22",
    ]);
    expect(days.some((d) => d.mesocycleEnd)).toBe(false);
    // 5 Wochen nach Beginn (2.11.) → Auswertung am 7.12.
    const december = calendarMonth({ plan: p, sessions: [], now: new Date(2026, 10, 5) }, 2026, 11);
    expect(december.filter((d) => d.mesocycleEnd).map((d) => d.date)).toEqual(["2026-12-07"]);
  });

  it("beschriftet Tage relativ zu heute", () => {
    const now = new Date(2026, 10, 5, 12);
    expect(relativeDayLabel("2026-11-05", now)).toBe("Heute");
    expect(relativeDayLabel("2026-11-06", now)).toBe("Morgen");
    expect(relativeDayLabel("2026-11-09", now)).toBe("Montag");
  });
});
