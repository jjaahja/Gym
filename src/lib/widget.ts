import { weeklyStreak } from "@/lib/motivation";
import type { CompletedSession } from "@/lib/offline/db";
import { hasSchedule, nextScheduled, relativeDayLabel } from "@/lib/training/schedule";
import type { Accent } from "@/stores/settings";
import type { StoredPlan } from "@/stores/plan-store";

// Startbildschirm-Widget (Android-App ab 1.3): nächstes Training und Wochenziel. Die App berechnet den Inhalt und
// übergibt ihn dem Widget, sobald sich etwas ändert – das Widget selbst rechnet nichts.

export interface WidgetContent {
  label: string;
  title: string;
  subtitle: string;
  footer: string;
  progress: number;
  max: number;
  accentLight: string;
  accentDark: string;
}

/** Akzentfarben wie in globals.css: [hell, dunkel] */
export const ACCENT_HEX: Record<Accent, [string, string]> = {
  orange: ["#c93c00", "#ff9f0a"],
  blue: ["#0066cc", "#0a84ff"],
  green: ["#1e7a35", "#30d158"],
  pink: ["#c8124f", "#ff375f"],
  purple: ["#8e3fbe", "#bf5af2"],
  teal: ["#00728a", "#40c8e0"],
};

export function widgetContent(input: {
  plan: StoredPlan | null;
  sessions: readonly CompletedSession[];
  running: boolean;
  weeklyGoal: number | null;
  accent: Accent;
  now: Date;
}): WidgetContent {
  const [accentLight, accentDark] = ACCENT_HEX[input.accent];
  const base = { accentLight, accentDark };
  const { plan, now } = input;
  if (!plan) return { ...base, label: "Gym", title: "Noch kein Plan", subtitle: "Tippe, um deinen Plan zu erstellen", footer: "", progress: 0, max: 0 };

  const streak = weeklyStreak(input.sessions, input.weeklyGoal ?? plan.days.length, now);
  const footer = `${streak.thisWeek} von ${streak.goal} diese Woche${streak.streak > 0 ? ` · ${streak.streak} ${streak.streak === 1 ? "Woche" : "Wochen"} in Folge` : ""}`;
  const week = { footer, progress: Math.min(streak.thisWeek, streak.goal), max: streak.goal };

  if (input.running) return { ...base, ...week, label: "Läuft", title: "Training läuft", subtitle: "Tippe zum Fortsetzen" };

  const describe = (d: StoredPlan["days"][number]) => `ca. ${d.estimatedMinutes} min · ${d.exercises.length} Übungen`;
  if (hasSchedule(plan)) {
    const next = nextScheduled({ plan, sessions: input.sessions, now });
    if (next?.isToday) return { ...base, ...week, label: "Heute", title: next.day.name, subtitle: describe(next.day) };
    if (next) return { ...base, ...week, label: "Nächstes Training", title: next.day.name, subtitle: `${relativeDayLabel(next.date, now)} · ${describe(next.day)}` };
  }
  const day = plan.days.find((d) => d.dayIndex === plan.nextDayIndex) ?? plan.days[0];
  return { ...base, ...week, label: "Nächstes Training", title: day?.name ?? "Training", subtitle: day ? describe(day) : "" };
}
