import type { MuscleSlug } from "@/data/catalog/muscles";
import { getExercise, getExerciseById, primaryMuscles } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import type { AdaptationRecord, StoredPlan, StoredPlanDay } from "@/stores/plan-store";
import { exerciseFeedback, exerciseSeries, jointHistory } from "./analytics";
import {
  buildSwapProposal,
  checkDeload,
  detectStagnation,
  findReplacement,
  isRegressing,
  mesocycleTrend,
  reviewVolume,
  swapTrigger,
  type AdaptationProposal,
  type ExerciseFeedback,
  type Trend,
} from "./progression";

// Mesozyklus-Auswertung und Prüfungen nach dem Training – verbindet die Regeln aus
// progression.ts (docs/adaptions-strategie.md) mit dem gespeicherten Plan und der Historie.

export const WEEK_MS = 7 * 24 * 3600 * 1000;
const MIN_SETS = 2;
const MAX_SETS = 5;
const MAX_STAGNATION_SWAPS = 2;

/** Geplante harte Sätze pro Muskel (Technik-Finisher zählen 0,5, Mitbeanspruchung anteilig). */
export function planVolume(days: readonly StoredPlanDay[]): Map<MuscleSlug, number> {
  const volume = new Map<MuscleSlug, number>();
  for (const day of days)
    for (const e of day.exercises) {
      const exercise = getExerciseById(e.exerciseId);
      if (!exercise) continue;
      const credit = e.sets + (e.lastSetTechnique ? 0.5 : 0);
      for (const m of exercise.muscles) volume.set(m.muscle, (volume.get(m.muscle) ?? 0) + credit * m.contribution);
    }
  return volume;
}

export interface SetChange {
  planExerciseId: string;
  from: number;
  to: number;
}

/** Verteilt eine Volumenänderung auf Planübungen, die den Muskel direkt trainieren (2–5 Sätze je Übung). */
export function distributeVolumeChange(plan: StoredPlan, muscle: MuscleSlug, targetSets: number): SetChange[] {
  const current = planVolume(plan.days).get(muscle) ?? 0;
  const delta = targetSets - current;
  const candidates = plan.days.flatMap((d) => d.exercises).filter((e) => {
    const exercise = getExerciseById(e.exerciseId);
    return exercise && primaryMuscles(exercise).includes(muscle);
  });
  const sets = new Map(candidates.map((e) => [e.id, e.sets]));
  const otherPrimaries = (id: string) => primaryMuscles(getExerciseById(candidates.find((c) => c.id === id)!.exerciseId)!).length - 1;
  const isIsolation = (id: string) => getExerciseById(candidates.find((c) => c.id === id)!.exerciseId)!.mechanic === "isolation";

  let changed = 0;
  while (Math.abs(delta) - changed > 0.25) {
    const ids = [...sets.keys()].filter((id) => (delta > 0 ? sets.get(id)! < MAX_SETS : sets.get(id)! > MIN_SETS));
    if (ids.length === 0) break;
    ids.sort((a, b) =>
      delta > 0
        ? sets.get(a)! - sets.get(b)! || Number(isIsolation(b)) - Number(isIsolation(a)) || otherPrimaries(a) - otherPrimaries(b)
        : sets.get(b)! - sets.get(a)! || otherPrimaries(b) - otherPrimaries(a),
    );
    sets.set(ids[0], sets.get(ids[0])! + (delta > 0 ? 1 : -1));
    changed += 1;
  }
  return candidates
    .filter((e) => sets.get(e.id) !== e.sets)
    .map((e) => ({ planExerciseId: e.id, from: e.sets, to: sets.get(e.id)! }));
}

export function weeksBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(fromIso)) / WEEK_MS));
}

/** Deload läuft 7 Tage ab Annahme. (Kein Prüfen auf „Start in der Zukunft“: Die Anzeige rechnet mit
 *  einem minütlich aktualisierten Zeitpunkt, der kurz vor der Annahme liegen kann.) */
export function isDeloadActive(plan: Pick<StoredPlan, "deloadWeekStart">, now: Date): boolean {
  if (plan.deloadWeekStart == null) return false;
  return now.getTime() - Date.parse(plan.deloadWeekStart) < WEEK_MS;
}

export interface SwapSuggestion {
  planExerciseId: string;
  proposal: AdaptationProposal;
}

export interface MesocycleReview {
  volume: AdaptationProposal[];
  deload: AdaptationProposal | null;
  swaps: SwapSuggestion[];
  trends: Partial<Record<MuscleSlug, Trend>>;
}

interface ReviewInput {
  plan: StoredPlan;
  sessions: readonly CompletedSession[];
  now: Date;
  /** Bisherige Anpassungen – offene Vorschläge werden nicht doppelt erzeugt, abgelehnte erst bei neuen Daten wieder */
  adaptations: readonly AdaptationRecord[];
}

const isOpen = (input: ReviewInput, type: AdaptationRecord["type"], planExerciseId: string | null = null) =>
  input.adaptations.some(
    (a) => a.planId === input.plan.id && a.status === "suggested" && a.type === type && a.planExerciseId === planExerciseId,
  );

/** Zeitpunkt der letzten Ablehnung – danach zählen nur neue Einheiten als Begründung. */
const rejectedAt = (input: ReviewInput, type: AdaptationRecord["type"], planExerciseId: string | null = null) =>
  input.adaptations
    .filter((a) => a.planId === input.plan.id && a.status === "rejected" && a.type === type && a.planExerciseId === planExerciseId)
    .reduce((latest, a) => (a.resolvedAt && a.resolvedAt > latest ? a.resolvedAt : latest), "");

function cycleSessions(plan: StoredPlan, sessions: readonly CompletedSession[]) {
  const anchor = plan.cycleStartedAt;
  return sessions
    .filter((s) => s.planId === plan.id && !s.deload && s.startedAt >= anchor)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

function recentRpe(sessions: readonly CompletedSession[]): number[] {
  return sessions.map((s) => s.sessionRpe).filter((v): v is number => v != null);
}

function feedbackMap(sessions: readonly CompletedSession[]): Map<string, ExerciseFeedback> {
  return new Map(
    exerciseFeedback(sessions).map((f) => [getExerciseById(f.exerciseId)!.slug, { avgPump: f.avgPump, avgJointDiscomfort: f.avgJointDiscomfort }]),
  );
}

function swapSuggestions(input: ReviewInput, atMesocycleEnd: boolean, inCycle: readonly CompletedSession[]): SwapSuggestion[] {
  const { plan, sessions } = input;
  const inPlan = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseSlug)));
  const feedback = feedbackMap(sessions);
  const suggestions: SwapSuggestion[] = [];
  const stagnating: StoredPlanDay["exercises"] = [];
  for (const pe of plan.days.flatMap((d) => d.exercises)) {
    if (isOpen(input, "swap_exercise", pe.id)) continue;
    const since = rejectedAt(input, "swap_exercise", pe.id);
    const reason = swapTrigger({
      jointDiscomfort: jointHistory(sessions.filter((s) => s.endedAt > since), pe.exerciseId),
      stagnating: detectStagnation(exerciseSeries(inCycle.filter((s) => s.endedAt > since), pe.exerciseId)),
      atMesocycleEnd,
    });
    if (!reason) continue;
    if (reason === "stagnation") {
      stagnating.push(pe);
      continue;
    }
    const current = getExercise(pe.exerciseSlug)!;
    const replacement = findReplacement(current, {
      goal: plan.goal,
      experience: plan.experience,
      equipment: plan.assessment.equipment,
      inPlan,
      feedback,
    });
    if (!replacement) continue;
    inPlan.add(replacement.slug); // nicht zweimal dieselbe Ersatzübung vorschlagen
    suggestions.push({ planExerciseId: pe.id, proposal: buildSwapProposal(current, replacement, reason) });
  }

  // Stagnation: gezielt variieren, nicht alles auf einmal – höchstens zwei Wechsel je Mesozyklus,
  // zuerst Übungen mit schwachem Pump (Ankerübungen behalten, Fortschritt bleibt messbar)
  const pumpOf = (slug: string) => feedback.get(slug)?.avgPump ?? 1.5;
  stagnating.sort((a, b) => pumpOf(a.exerciseSlug) - pumpOf(b.exerciseSlug) || a.orderIndex - b.orderIndex);
  let stagnationSwaps = 0;
  for (const pe of stagnating) {
    if (stagnationSwaps >= MAX_STAGNATION_SWAPS) break;
    const current = getExercise(pe.exerciseSlug)!;
    const replacement = findReplacement(current, {
      goal: plan.goal,
      experience: plan.experience,
      equipment: plan.assessment.equipment,
      inPlan,
      feedback,
    });
    if (!replacement) continue;
    inPlan.add(replacement.slug);
    suggestions.push({ planExerciseId: pe.id, proposal: buildSwapProposal(current, replacement, "stagnation") });
    stagnationSwaps++;
  }
  return suggestions;
}

function deloadExercises(plan: StoredPlan) {
  return plan.days.flatMap((d) => d.exercises.map((e) => ({ planExerciseId: e.id, sets: e.sets, rirMin: e.rirMin, rirMax: e.rirMax })));
}

/** Volle Auswertung am Ende eines Mesozyklus. */
export function buildMesocycleReview(input: ReviewInput): MesocycleReview {
  const { plan, now } = input;
  const inCycle = cycleSessions(plan, input.sessions);
  const rpe = recentRpe(inCycle);
  const lastTwo = rpe.slice(-2);
  const fatigue = lastTwo.length === 2 && (lastTwo[0] + lastTwo[1]) / 2 >= 9;
  const current = planVolume(plan.days);
  const exercisesByMuscle = (muscle: MuscleSlug) =>
    [...new Set(plan.days.flatMap((d) => d.exercises).map((e) => e.exerciseId))].filter((id) =>
      primaryMuscles(getExerciseById(id)!).includes(muscle),
    );

  // Gelenkbeschwerden zuerst über die Übung lösen (Wechsel); Volumen nur senken, wenn es keine Alternative gibt
  const swaps = swapSuggestions(input, true, inCycle);
  const swapped = new Set(
    swaps.map((sw) => plan.days.flatMap((d) => d.exercises).find((e) => e.id === sw.planExerciseId)?.exerciseId),
  );
  const openSwap = new Set(
    input.adaptations
      .filter((a) => a.planId === plan.id && a.status === "suggested" && a.type === "swap_exercise")
      .map((a) => String(a.before.exercise_id)),
  );

  const trends: Partial<Record<MuscleSlug, Trend>> = {};
  const volume: AdaptationProposal[] = [];
  for (const v of plan.volume) {
    const ids = exercisesByMuscle(v.muscle);
    const exerciseTrends = ids.map((id) => mesocycleTrend(exerciseSeries(inCycle, id)));
    const ups = exerciseTrends.filter((t) => t === "up").length;
    const trend: Trend =
      exerciseTrends.includes("down") && ups === 0 ? "down" : ups > exerciseTrends.length / 2 ? "up" : "flat";
    trends[v.muscle] = trend;
    const jointIssues = ids.some((id) => {
      if (swapped.has(id) || openSwap.has(id)) return false;
      const lastTwoJoint = jointHistory(inCycle, id).slice(-2);
      return lastTwoJoint.length === 2 && lastTwoJoint.every((j) => j != null && j >= 2);
    });
    const proposal = reviewVolume({
      muscle: v.muscle,
      currentSets: Math.round((current.get(v.muscle) ?? 0) * 10) / 10,
      min: v.min,
      max: v.max,
      trend,
      jointIssues,
      fatigue,
    });
    if (proposal) volume.push(proposal);
  }

  const regressing = [...new Set(plan.days.flatMap((d) => d.exercises).map((e) => e.exerciseId))].filter((id) =>
    isRegressing(exerciseSeries(inCycle, id)),
  ).length;
  const deload = isOpen(input, "deload")
    ? null
    : checkDeload(
        {
          weeksSinceLastDeload: weeksBetween(plan.lastDeloadAt ?? plan.startedAt, now),
          atMesocycleEnd: true,
          recentSessionRpe: rpe,
          regressingExercises: regressing,
        },
        deloadExercises(plan),
      );

  return { volume, deload, swaps, trends };
}

/** Nach jedem Training: Gelenkbeschwerden (sofort) und akute Ermüdung prüfen. */
export function buildPostWorkoutChecks(input: ReviewInput): { swaps: SwapSuggestion[]; deload: AdaptationProposal | null } {
  const { plan, now } = input;
  const inCycle = cycleSessions(plan, input.sessions);
  const swaps = swapSuggestions(input, false, inCycle);
  if (isDeloadActive(plan, now) || isOpen(input, "deload")) return { swaps, deload: null };
  const since = rejectedAt(input, "deload");
  const evidence = inCycle.filter((s) => s.endedAt > since);
  const regressing = [...new Set(plan.days.flatMap((d) => d.exercises).map((e) => e.exerciseId))].filter((id) =>
    isRegressing(exerciseSeries(evidence, id)),
  ).length;
  const deload = checkDeload(
    {
      weeksSinceLastDeload: weeksBetween(plan.lastDeloadAt ?? plan.startedAt, now),
      atMesocycleEnd: false,
      recentSessionRpe: recentRpe(evidence),
      regressingExercises: regressing,
    },
    deloadExercises(plan),
  );
  return { swaps, deload };
}
