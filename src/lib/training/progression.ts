import type { EquipmentSlug } from "@/data/catalog/equipment";
import type { MuscleSlug } from "@/data/catalog/muscles";
import { exercises as catalog, isExerciseAvailable, primaryMuscles, type Exercise } from "@/lib/catalog";
import type {
  AdaptationReason,
  AdaptationStatus,
  AdaptationType,
  ExperienceLevel,
  SetType,
  TrainingGoal,
} from "@/lib/db/enums";
import { getGuideline } from "@/lib/science";

// Progression & Plananpassung gemäß docs/adaptions-strategie.md.
// Reine Funktionen: Sie lesen Trainingsdaten und liefern Vorschläge im Format von plan_adaptations.
// Automatisch (auto_applied) nur, was gut belegt und leicht rückgängig zu machen ist.

export interface LoggedSetLike {
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
}

export interface Prescription {
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  targetLoadKg: number | null;
  loadIncrementKg: number;
}

export interface AdaptationProposal {
  type: AdaptationType;
  reason: AdaptationReason;
  status: AdaptationStatus;
  muscle?: MuscleSlug;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  guidelineKey: string;
  explanation: string;
}

/** Welche Anpassung automatisch passiert und welche nur vorgeschlagen wird. */
export const ADAPTATION_MODE: Record<AdaptationType, AdaptationStatus> = {
  increase_load: "auto_applied",
  decrease_load: "auto_applied",
  add_set: "auto_applied",
  remove_set: "auto_applied",
  change_rep_range: "suggested",
  swap_exercise: "suggested",
  deload: "suggested",
};

const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2 });
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const isWorking = (s: LoggedSetLike) => s.setType === "working" && s.reps != null;

// ─────────────────────────── e1RM ───────────────────────────

/** Gleiche Formel wie set_logs.e1rm_kg (Epley, RIR-korrigiert, nur 1–12 Wdh. und RIR ≤ 4). */
export function estimateOneRepMax(set: LoggedSetLike): number | null {
  const { weightKg, reps, rir, setType } = set;
  if (!["working", "backoff", "amrap"].includes(setType)) return null;
  if (weightKg == null || weightKg <= 0 || reps == null || reps < 1 || reps > 12) return null;
  if (rir != null && rir > 4) return null;
  return Math.round(weightKg * (1 + (reps + (rir ?? 0)) / 30) * 100) / 100;
}

// ─────────────────────────── 1) Vorschlag für den nächsten Satz ───────────────────────────

export interface NextSetSuggestion {
  weightKg: number | null;
  change: "increase" | "decrease" | "same";
  reason: string;
}

/**
 * Autoregulation über die Wiederholungsreserve (Richtwert autoregulation.rir):
 * RIR ≥ Ziel + 2 → ein Inkrement mehr; RIR unter Ziel oder untere Wdh.-Grenze verfehlt → eines weniger.
 */
export function suggestNextSet(p: Prescription, setsSoFar: readonly LoggedSetLike[]): NextSetSuggestion {
  const last = [...setsSoFar].reverse().find(isWorking);
  if (!last) {
    return p.targetLoadKg != null
      ? { weightKg: p.targetLoadKg, change: "same", reason: "Zielgewicht aus dem Plan" }
      : { weightKg: null, change: "same", reason: `Wähle ein Gewicht, mit dem du ${p.repsMin}–${p.repsMax} Wiederholungen schaffst` };
  }

  const weight = last.weightKg ?? 0;
  const reps = last.reps!;
  if (last.rir != null && last.rir >= p.rirMax + 2 && reps >= p.repsMin) {
    return {
      weightKg: roundTo(weight + p.loadIncrementKg, 0.25),
      change: "increase",
      reason: `${de(last.rir)} Wiederholungen im Tank – mehr als geplant (${p.rirMin}–${p.rirMax})`,
    };
  }
  if ((last.rir != null && last.rir < p.rirMin) || reps < p.repsMin) {
    return {
      weightKg: Math.max(0, roundTo(weight - p.loadIncrementKg, 0.25)),
      change: "decrease",
      reason: reps < p.repsMin ? `Unter ${p.repsMin} Wiederholungen` : `Näher am Versagen als geplant (RIR ${de(last.rir!)})`,
    };
  }
  return { weightKg: weight, change: "same", reason: "Im Zielbereich – Gewicht beibehalten" };
}

// ─────────────────────────── 2) Doppelte Progression nach dem Training ───────────────────────────

export interface ProgressionResult {
  /** Neues Zielgewicht für plan_exercises.target_load_kg */
  targetLoadKg: number | null;
  proposal: AdaptationProposal | null;
}

/**
 * sessions: Arbeitssätze je Einheit, chronologisch (letzte = jüngste).
 * - Alle Arbeitssätze am oberen Ende → +1 Inkrement (automatisch).
 * - Erster Arbeitssatz in zwei Einheiten hintereinander unter der unteren Grenze → −1 Inkrement (automatisch).
 */
export function evaluateDoubleProgression(p: Prescription, sessions: readonly (readonly LoggedSetLike[])[]): ProgressionResult {
  const latest = (sessions.at(-1) ?? []).filter(isWorking);
  if (latest.length === 0) return { targetLoadKg: p.targetLoadKg, proposal: null };

  const load = Math.max(...latest.map((s) => s.weightKg ?? 0));
  const guidelineKey = getGuideline("progression.double").key;

  if (latest.every((s) => s.reps! >= p.repsMax)) {
    const next = roundTo(load + p.loadIncrementKg, 0.25);
    return {
      targetLoadKg: next,
      proposal: {
        type: "increase_load",
        reason: "progression_achieved",
        status: ADAPTATION_MODE.increase_load,
        before: { target_load_kg: load },
        after: { target_load_kg: next },
        guidelineKey,
        explanation: `Alle Sätze mit ${p.repsMax}+ Wiederholungen geschafft – nächstes Mal ${de(next)} kg (+${de(p.loadIncrementKg)} kg).`,
      },
    };
  }

  const previous = (sessions.at(-2) ?? []).filter(isWorking);
  const firstBelow = (sets: LoggedSetLike[]) => sets.length > 0 && sets[0].reps! < p.repsMin;
  if (firstBelow(latest) && firstBelow(previous)) {
    const next = Math.max(0, roundTo(load - p.loadIncrementKg, 0.25));
    return {
      targetLoadKg: next,
      proposal: {
        type: "decrease_load",
        reason: "regression",
        status: ADAPTATION_MODE.decrease_load,
        before: { target_load_kg: load },
        after: { target_load_kg: next },
        guidelineKey,
        explanation: `Zweimal in Folge schon im ersten Satz unter ${p.repsMin} Wiederholungen – Gewicht auf ${de(next)} kg reduziert.`,
      },
    };
  }

  return { targetLoadKg: load, proposal: null };
}

// ─────────────────────────── 3) Leistung, Stagnation, Rückgang ───────────────────────────

export interface SessionPerformance {
  bestE1rmKg: number | null;
  topWeightKg: number | null;
  totalReps: number | null;
  workingSets: number;
}

/** Leistungskennzahl je Einheit: e1RM, sonst (hohe Wdh.) Epley aus Topgewicht und Ø-Wiederholungen. */
export function performanceScore(s: SessionPerformance): number | null {
  if (s.bestE1rmKg != null) return s.bestE1rmKg;
  if (s.topWeightKg == null || s.topWeightKg <= 0 || !s.totalReps || s.workingSets <= 0) return null;
  return s.topWeightKg * (1 + s.totalReps / s.workingSets / 30);
}

const scores = (history: readonly SessionPerformance[]) =>
  history.map(performanceScore).filter((v): v is number => v != null);

/** Kein neuer Bestwert (> +0,5 %) in den letzten `window` Einheiten. */
export function detectStagnation(history: readonly SessionPerformance[], window = 3): boolean {
  const values = scores(history);
  if (values.length < window + 1) return false;
  const bestBefore = Math.max(...values.slice(0, -window));
  const bestRecent = Math.max(...values.slice(-window));
  return bestRecent <= bestBefore * 1.005;
}

/** Jüngste Einheit ≥ 5 % unter dem Schnitt der drei davor (Heuristik). */
export function isRegressing(history: readonly SessionPerformance[]): boolean {
  const values = scores(history);
  if (values.length < 4) return false;
  const previous = values.slice(-4, -1);
  const mean = previous.reduce((a, b) => a + b, 0) / previous.length;
  return values.at(-1)! < mean * 0.95;
}

export type Trend = "up" | "flat" | "down";

/** Trend über einen Mesozyklus: Schnitt der letzten zwei vs. der ersten zwei Einheiten. */
export function mesocycleTrend(history: readonly SessionPerformance[]): Trend {
  const values = scores(history);
  if (values.length < 4) return "flat";
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ratio = mean(values.slice(-2)) / mean(values.slice(0, 2));
  return ratio > 1.01 ? "up" : ratio < 0.97 ? "down" : "flat";
}

// ─────────────────────────── 4) Volumen am Ende eines Mesozyklus ───────────────────────────

export interface MuscleReview {
  muscle: MuscleSlug;
  currentSets: number;
  min: number;
  max: number;
  trend: Trend;
  jointIssues: boolean;
  fatigue: boolean;
}

/**
 * ±20 % (mindestens 1, höchstens 2 Sätze), automatisch nur innerhalb [min, max].
 * Über dem Maximum: nur Vorschlag (Junk Volume).
 */
export function reviewVolume(r: MuscleReview): AdaptationProposal | null {
  const guidelineKey = getGuideline("volume_progression.mesocycle").key;
  const step = Math.min(2, Math.max(1, Math.round(r.currentSets * 0.2)));
  const proposal = (
    type: AdaptationType,
    reason: AdaptationReason,
    to: number,
    explanation: string,
    status: AdaptationStatus = ADAPTATION_MODE[type],
  ): AdaptationProposal => ({
    type,
    reason,
    status,
    muscle: r.muscle,
    before: { weekly_sets: r.currentSets },
    after: { weekly_sets: to },
    guidelineKey,
    explanation,
  });

  if (r.currentSets > r.max) {
    return proposal("remove_set", "volume_above_max", r.max,
      `${de(r.currentSets)} Sätze pro Woche liegen über dem Richtwert (${r.min}–${r.max}). Mehr bringt kaum Zusatznutzen – Reduktion auf ${r.max} empfohlen.`,
      "suggested");
  }
  if (r.currentSets < r.min - 0.5) {
    return proposal("add_set", "volume_below_min", r.min,
      `${de(r.currentSets)} Sätze pro Woche liegen unter dem Richtwert – angehoben auf ${r.min}.`);
  }
  if (r.fatigue || r.jointIssues || r.trend === "down") {
    const to = Math.max(r.min, r.currentSets - step);
    if (to >= r.currentSets) return null;
    const reason: AdaptationReason = r.jointIssues ? "stimulus_feedback" : r.fatigue ? "high_fatigue" : "regression";
    const why = r.jointIssues ? "Gelenkbeschwerden" : r.fatigue ? "hohe Ermüdung" : "sinkende Leistung";
    return proposal("remove_set", reason, to, `${why[0].toUpperCase()}${why.slice(1)} – Volumen von ${de(r.currentSets)} auf ${de(to)} Sätze pro Woche reduziert.`);
  }
  if (r.trend === "up") {
    const to = Math.min(r.max, r.currentSets + step);
    if (to <= r.currentSets) return null;
    return proposal("add_set", "mesocycle_end", to,
      `Leistung gestiegen und gut erholt – Volumen von ${de(r.currentSets)} auf ${de(to)} Sätze pro Woche erhöht.`);
  }
  return null;
}

// ─────────────────────────── 5) Deload ───────────────────────────

export interface DeloadInput {
  weeksSinceLastDeload: number;
  atMesocycleEnd: boolean;
  /** Session-RPE der letzten Einheiten (chronologisch) */
  recentSessionRpe: readonly number[];
  /** Anzahl Übungen mit Leistungsrückgang (isRegressing) */
  regressingExercises: number;
}

export interface DeloadExercise {
  planExerciseId: string;
  sets: number;
  rirMin: number;
  rirMax: number;
}

/** Leichtere Woche: etwa halbe Sätze, gleiche Übungen, RIR 3–4. */
export function buildDeloadWeek(exercises: readonly DeloadExercise[]): DeloadExercise[] {
  return exercises.map((e) => ({ ...e, sets: Math.max(1, Math.ceil(e.sets / 2)), rirMin: 3, rirMax: 4 }));
}

/** Nur Vorschlag – eine Pausenwoche bringt kein Zusatzwachstum (Coleman et al. 2024), hilft aber gegen Ermüdung. */
export function checkDeload(input: DeloadInput, exercises: readonly DeloadExercise[]): AdaptationProposal | null {
  const guideline = getGuideline("deload.as_needed");
  const lastTwo = input.recentSessionRpe.slice(-2);
  const highRpe = lastTwo.length === 2 && lastTwo.reduce((a, b) => a + b, 0) / 2 >= 9;
  const build = (reason: AdaptationReason, explanation: string): AdaptationProposal => ({
    type: "deload",
    reason,
    status: ADAPTATION_MODE.deload,
    before: { exercises },
    after: { exercises: buildDeloadWeek(exercises) },
    guidelineKey: guideline.key,
    explanation,
  });

  if (input.regressingExercises >= 2 && highRpe) {
    return build("high_fatigue",
      `Leistung sinkt bei ${input.regressingExercises} Übungen und die Einheiten fühlen sich sehr hart an – eine leichtere Woche baut Ermüdung ab.`);
  }
  if (input.atMesocycleEnd && input.weeksSinceLastDeload >= (guideline.min ?? 5)) {
    return build("mesocycle_end",
      `Seit ${input.weeksSinceLastDeload} Wochen keine leichtere Woche. Optional: eine Woche mit halben Sätzen – üblich ist das alle ${guideline.min}–${guideline.max} Wochen.`);
  }
  return null;
}

// ─────────────────────────── 6) Übungswechsel ───────────────────────────

export interface SwapTriggerInput {
  /** Gelenkbeschwerden (0–3) der letzten Einheiten, chronologisch */
  jointDiscomfort: readonly (number | null)[];
  stagnating: boolean;
  atMesocycleEnd: boolean;
}

/** Gelenkbeschwerden ≥ 2 in zwei Einheiten → sofort; Stagnation → zum Mesozyklus-Ende. */
export function swapTrigger(input: SwapTriggerInput): AdaptationReason | null {
  const lastTwo = input.jointDiscomfort.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((v) => v != null && v >= 2)) return "stimulus_feedback";
  if (input.stagnating && input.atMesocycleEnd) return "stagnation";
  return null;
}

export interface ExerciseFeedback {
  avgPump: number | null;
  avgJointDiscomfort: number | null;
}

export interface ReplacementContext {
  goal: TrainingGoal;
  experience: ExperienceLevel;
  equipment: readonly EquipmentSlug[];
  avoid?: ReadonlySet<string>;
  /** Übungen, die schon im Plan sind */
  inPlan?: ReadonlySet<string>;
  feedback?: ReadonlyMap<string, ExerciseFeedback>;
}

/**
 * Gleiches Bewegungsmuster und gemeinsamer Primärmuskel, machbar, nicht gemieden, nicht schon im Plan.
 * Bevorzugt: Dehnungsfokus, guter persönlicher Pump, keine Gelenkbeschwerden.
 */
export function findReplacement(current: Exercise, ctx: ReplacementContext): Exercise | null {
  const targets = new Set(primaryMuscles(current));
  const eligible = (e: Exercise) =>
    e.slug !== current.slug &&
    !ctx.avoid?.has(e.slug) &&
    !ctx.inPlan?.has(e.slug) &&
    isExerciseAvailable(e, ctx.equipment, ctx.experience) &&
    primaryMuscles(e).some((m) => targets.has(m));

  const score = (e: Exercise) => {
    const fb = ctx.feedback?.get(e.slug);
    let s = 0;
    if (ctx.goal === "hypertrophy" && e.resistanceProfile === "lengthened") s += 6;
    if (fb?.avgPump != null) s += fb.avgPump * 3;
    if (fb?.avgJointDiscomfort != null) s -= fb.avgJointDiscomfort * 5;
    if (e.trackingType === "weight_reps") s += 2;
    s -= e.systemicFatigue * 0.75;
    return s;
  };

  const pick = (candidates: Exercise[]) =>
    candidates.sort((a, b) => score(b) - score(a) || a.slug.localeCompare(b.slug))[0] ?? null;

  return (
    pick(catalog.filter((e) => eligible(e) && e.movementPattern === current.movementPattern)) ??
    pick(catalog.filter((e) => eligible(e) && e.mechanic === current.mechanic))
  );
}

export function buildSwapProposal(current: Exercise, replacement: Exercise, reason: AdaptationReason): AdaptationProposal {
  const why =
    reason === "stimulus_feedback"
      ? `${current.nameDe} hat zweimal in Folge Gelenkbeschwerden verursacht`
      : `Bei ${current.nameDe} gab es über mehrere Einheiten keinen neuen Bestwert`;
  return {
    type: "swap_exercise",
    reason,
    status: ADAPTATION_MODE.swap_exercise,
    before: { exercise_id: current.id, exercise_slug: current.slug },
    after: { exercise_id: replacement.id, exercise_slug: replacement.slug },
    guidelineKey: getGuideline("exercise_variation.planned").key,
    explanation: `${why}. Vorschlag: ${replacement.nameDe} – gleiche Muskeln, anderer Reiz.`,
  };
}
