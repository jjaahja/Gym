import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import type { CompletedSession } from "@/lib/offline/db";
import { generatePlan } from "@/lib/training/plan-generator";
import { createPlanStore } from "@/stores/plan-store";
import { widgetContent } from "./widget";

function plan(weekdays?: (1 | 2 | 3 | 4 | 5 | 6 | 7)[]) {
  const data = new Map<string, string>();
  const store = createPlanStore({
    sink: () => {},
    storage: () => ({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }),
  });
  const assessment = {
    goal: "hypertrophy" as const,
    experience: "intermediate" as const,
    trainingAgeMonths: 24,
    daysPerWeek: 4,
    sessionDurationMin: 75,
    preferredSplit: null,
    priorityMuscles: [],
    equipment: [...EQUIPMENT_PRESETS.gym],
    limitations: "",
  };
  return store.getState().createPlan({ userId: null, assessment, generated: generatePlan(assessment), weekdays });
}

const session = (startedAt: string, planDayId: string | null = null): CompletedSession => ({
  id: startedAt,
  planId: null,
  planDayId,
  startedAt,
  endedAt: startedAt,
  sessionRpe: null,
  exerciseIds: [],
  exercises: [],
});

describe("Widget", () => {
  const now = new Date("2026-11-12T08:00:00"); // Donnerstag
  const base = { running: false, weeklyGoal: null, accent: "blue" as const, now };

  it("ohne Plan: Aufforderung", () => {
    expect(widgetContent({ ...base, plan: null, sessions: [] })).toMatchObject({ title: "Noch kein Plan", max: 0, accentLight: "#0066cc", accentDark: "#0a84ff" });
  });

  it("heute geplant: „Heute“ mit Dauer und Wochenziel", () => {
    const p = plan([1, 2, 4, 5]);
    const w = widgetContent({ ...base, plan: p, sessions: [session("2026-11-10T18:00:00")] });
    const today = p.days.find((d) => d.weekday === 4)!;
    expect(w).toMatchObject({ label: "Heute", title: today.name, progress: 1, max: 4, footer: "1 von 4 diese Woche" });
    expect(w.subtitle).toBe(`ca. ${today.estimatedMinutes} min · ${today.exercises.length} Übungen`);
  });

  it("heute schon trainiert: nächstes Training mit Tag", () => {
    const p = plan([1, 2, 4, 5]);
    const thursday = p.days.find((d) => d.weekday === 4)!;
    const w = widgetContent({ ...base, plan: p, sessions: [session("2026-11-12T07:00:00", thursday.id)] });
    expect(w.label).toBe("Nächstes Training");
    expect(w.subtitle.startsWith("Morgen · ")).toBe(true);
  });

  it("laufendes Training hat Vorrang", () => {
    expect(widgetContent({ ...base, plan: plan([1, 2, 4, 5]), sessions: [], running: true })).toMatchObject({ label: "Läuft", title: "Training läuft" });
  });
});
