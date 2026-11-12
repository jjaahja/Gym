import { describe, expect, it } from "vitest";
import type { CompletedSession } from "@/lib/offline/db";
import { monthlyReview, previousMonth, reminderSlots, reviewDue, weeklyStreak } from "./motivation";

const at = (iso: string) => ({ startedAt: new Date(iso).toISOString() });

describe("Wochenziel und Serie", () => {
  const now = new Date("2026-11-12T18:00:00"); // Donnerstag
  it("zählt die laufende Woche erst, wenn das Ziel erreicht ist – bricht die Serie bis Sonntag aber nicht", () => {
    const sessions = [
      // drei volle Wochen davor (je 2)
      at("2026-10-20T18:00:00"), at("2026-10-23T18:00:00"),
      at("2026-10-27T18:00:00"), at("2026-10-30T18:00:00"),
      at("2026-11-03T18:00:00"), at("2026-11-06T18:00:00"),
      // diese Woche erst 1
      at("2026-11-10T18:00:00"),
    ];
    expect(weeklyStreak(sessions, 2, now)).toEqual({ thisWeek: 1, goal: 2, reachedThisWeek: false, streak: 3, best: 3 });
    const more = [...sessions, at("2026-11-12T08:00:00")];
    expect(weeklyStreak(more, 2, now)).toMatchObject({ thisWeek: 2, reachedThisWeek: true, streak: 4, best: 4 });
  });

  it("eine verpasste Woche beendet die Serie; die beste bleibt", () => {
    const sessions = [
      at("2026-10-06T18:00:00"), at("2026-10-13T18:00:00"), at("2026-10-20T18:00:00"),
      // Woche ab 27.10. ohne Training
      at("2026-11-03T18:00:00"),
    ];
    expect(weeklyStreak(sessions, 1, now)).toMatchObject({ streak: 1, best: 3 });
    expect(weeklyStreak([], 3, now)).toEqual({ thisWeek: 0, goal: 3, reachedThisWeek: false, streak: 0, best: 0 });
  });
});

const session = (id: string, start: string, sets: { w: number; r: number; rir?: number }[], exerciseId = "bench"): CompletedSession => ({
  id,
  planId: null,
  planDayId: null,
  startedAt: new Date(start).toISOString(),
  endedAt: new Date(new Date(start).getTime() + 60 * 60000).toISOString(),
  sessionRpe: 8,
  exerciseIds: [exerciseId],
  exercises: [
    {
      logId: `${id}-l`,
      exerciseId,
      planExerciseId: null,
      pumpRating: null,
      jointDiscomfort: null,
      sets: sets.map((s, i) => ({ id: `${id}-${i}`, setIndex: i, setType: "working" as const, weightKg: s.w, reps: s.r, durationSeconds: null, rir: s.rir ?? 1 })),
    },
  ],
});

describe("Monatsrückblick", () => {
  const sessions = [
    session("a", "2026-09-20T18:00:00", [{ w: 60, r: 10 }]),
    session("b", "2026-10-05T18:00:00", [{ w: 60, r: 10 }, { w: 60, r: 9 }]),
    session("c", "2026-10-25T18:00:00", [{ w: 65, r: 10 }, { w: 65, r: 8 }]),
  ];

  it("Trainings, Zeit, harte Sätze, Last, Rekorde und Vergleich zum Vormonat", () => {
    const r = monthlyReview(sessions, "2026-10", {
      measurements: [
        { id: "m1", measuredOn: "2026-10-01", bodyWeightKg: 80 } as never,
        { id: "m2", measuredOn: "2026-10-30", bodyWeightKg: 81.2 } as never,
      ],
      nutrition: [{ day: "2026-10-02", proteinG: 150, energyKcal: null, source: "manual", updatedAt: "" }, { day: "2026-10-03", proteinG: 131, energyKcal: null, source: "manual", updatedAt: "" }],
    });
    expect(r).toMatchObject({ month: "2026-10", label: "Oktober 2026", trainings: 2, minutes: 120, hardSets: 4, tonnageKg: 60 * 19 + 65 * 18 });
    expect(r.records).toHaveLength(1);
    expect(r.records[0].exerciseId).toBe("bench");
    expect(r.previous).toEqual({ trainings: 1, hardSets: 1, tonnageKg: 600 });
    expect(r.bodyWeight).toEqual({ from: 80, to: 81.2 });
    expect(r.proteinAverage).toBe(141);
  });

  it("Bestwert auch innerhalb des ersten Monats (erstes Training = Ausgangswert)", () => {
    const first = [
      session("x", "2026-11-02T18:00:00", [{ w: 50, r: 10 }]),
      session("y", "2026-11-09T18:00:00", [{ w: 55, r: 10 }]),
      session("z", "2026-11-11T18:00:00", [{ w: 52.5, r: 10 }]),
    ];
    const r = monthlyReview(first, "2026-11");
    expect(r.records).toHaveLength(1);
    expect(r.records[0].before).toBeCloseTo(50 * (1 + 11 / 30));
    expect(r.records[0].best).toBeCloseTo(55 * (1 + 11 / 30));
    expect(monthlyReview(first.slice(0, 1), "2026-11").records).toEqual([]);
  });

  it("ohne Vormonat und ohne Messungen", () => {
    const r = monthlyReview(sessions, "2026-09");
    expect(r).toMatchObject({ trainings: 1, previous: null, bodyWeight: null, proteinAverage: null, records: [] });
    expect(previousMonth("2026-01")).toBe("2025-12");
  });

  it("bietet den Rückblick in der ersten Woche des Folgemonats an", () => {
    expect(reviewDue(sessions, new Date("2026-11-03T10:00:00"))).toBe("2026-10");
    expect(reviewDue(sessions, new Date("2026-11-12T10:00:00"))).toBeNull();
    expect(reviewDue(sessions, new Date("2026-12-02T10:00:00"))).toBeNull();
  });
});

describe("Erinnerungen", () => {
  it("je fest geplantem Tag eine Erinnerung zur Uhrzeit", () => {
    const slots = reminderSlots(
      [
        { name: "Unterkörper A", weekday: 4, estimatedMinutes: 55 },
        { name: "Oberkörper A", weekday: 1, estimatedMinutes: 60 },
        { name: "Ohne Tag", weekday: null, estimatedMinutes: 50 },
      ],
      "17:30",
    );
    expect(slots).toEqual([
      { weekday: 1, hour: 17, minute: 30, title: "Heute: Oberkörper A", body: "ca. 60 min – dein Training wartet." },
      { weekday: 4, hour: 17, minute: 30, title: "Heute: Unterkörper A", body: "ca. 55 min – dein Training wartet." },
    ]);
  });
});
