import type { Exercise } from "@/lib/catalog";
import { getExerciseById } from "@/lib/catalog";
import type { ExperienceLevel } from "@/lib/db/enums";
import type { CompletedSession } from "@/lib/offline/db";
import { suggestLoad, type LoadSuggestion, type LoadTarget } from "./load-suggestion";
import { estimateOneRepMax, type LoggedSetLike } from "./progression";
import { correctRir } from "./rir-calibration";

// Gewichtsempfehlung für jede Übung – auch beim ersten Mal und bei Körpergewichtsübungen mit Zusatzgewicht.
//
// 1) Eigener Verlauf der Übung (heute bzw. letztes Mal) → wie bisher (load-suggestion.ts).
// 2) Kein Verlauf: aus einer verwandten Übung, die du schon gemacht hast (gleiches Bewegungsmuster), umgerechnet über
//    typische Kraftverhältnisse – z. B. Kurzhantel-Bankdrücken je Hantel ≈ 38 % des Langhantel-Bankdrückens.
// 3) Sonst aus Körpergewicht, Erfahrung und Geschlecht (Kraftnormen, bewusst vorsichtig).
// Schätzungen werden absichtlich etwas zu leicht angesetzt (Sicherheitsabschlag); nach dem ersten Satz rechnet die App
// mit der echten Leistung weiter. Kurzhanteln: Gewicht je Hantel.

export type Sex = "male" | "female";

/**
 * Geschätztes 1RM im Verhältnis zum Körpergewicht – Männer, fortgeschritten (Erfahrungswerte gängiger Kraftnormen,
 * eher am unteren Ende). Kurzhanteln je Hantel, Maschinen/Kabel als angezeigtes Gewicht (je nach Gerät sehr
 * unterschiedlich – daher vorsichtig).
 */
export const STRENGTH_RATIO: Readonly<Record<string, number>> = {
  "barbell-bench-press": 1.0,
  "dumbbell-bench-press": 0.38,
  "incline-dumbbell-press": 0.32,
  "machine-chest-press": 0.85,
  "cable-fly": 0.2,
  "pec-deck": 0.6,
  "dumbbell-fly": 0.15,
  "overhead-press": 0.65,
  "seated-dumbbell-shoulder-press": 0.26,
  "dumbbell-lateral-raise": 0.13,
  "cable-lateral-raise": 0.09,
  "reverse-pec-deck": 0.45,
  "face-pull": 0.35,
  "bent-over-reverse-fly": 0.09,
  "lat-pulldown": 0.85,
  "barbell-row": 0.85,
  "one-arm-dumbbell-row": 0.38,
  "seated-cable-row": 0.85,
  "chest-supported-dumbbell-row": 0.3,
  "straight-arm-pulldown": 0.35,
  "dumbbell-pullover": 0.3,
  "ez-bar-curl": 0.45,
  "dumbbell-curl": 0.2,
  "incline-dumbbell-curl": 0.16,
  "hammer-curl": 0.22,
  "cable-curl": 0.4,
  "overhead-cable-triceps-extension": 0.35,
  "cable-triceps-pushdown": 0.45,
  "ez-skull-crusher": 0.4,
  "overhead-dumbbell-triceps-extension": 0.25,
  "barbell-back-squat": 1.3,
  "goblet-squat": 0.45,
  "leg-press": 1.8,
  "bulgarian-split-squat": 0.25,
  "walking-lunge": 0.25,
  deadlift: 1.6,
  "romanian-deadlift": 1.1,
  "dumbbell-romanian-deadlift": 0.45,
  "single-leg-romanian-deadlift": 0.22,
  "back-extension": 0.3,
  "barbell-hip-thrust": 1.4,
  "seated-leg-curl": 0.6,
  "lying-leg-curl": 0.5,
  "leg-extension": 0.8,
  "hip-abduction-machine": 0.8,
  "hip-adduction-machine": 0.8,
  "standing-calf-raise": 1.2,
  "leg-press-calf-raise": 1.6,
  "single-leg-calf-raise": 0.1,
  "cable-crunch": 0.6,
  "pallof-press": 0.2,
};

/**
 * Körpergewichtsübungen, bei denen Zusatzgewicht üblich ist: Anteil des Körpergewichts, der bewegt wird.
 * Liegestütz ≈ 64 % (Ebben et al. 2011), Dips und Klimmzug nahezu das ganze Körpergewicht.
 */
export const BODY_FRACTION: Readonly<Record<string, number>> = {
  "pull-up": 0.95,
  dips: 0.9,
  "push-up": 0.64,
  "close-grip-push-up": 0.64,
};

/** Eine Kurzhantel, mit beiden Händen gehalten – Gewicht ist die Hantel, nicht „je Hand“. */
const ONE_DUMBBELL = new Set(["goblet-squat", "dumbbell-pullover", "overhead-dumbbell-triceps-extension"]);

/** Beschriftung des Gewichtsfelds: Kurzhanteln je Hantel. */
export function weightFieldLabel(exercise: Pick<Exercise, "slug" | "equipment" | "trackingType">): string {
  if (exercise.trackingType === "bodyweight_reps") return "Zusatz";
  if (exercise.equipment.includes("dumbbell") && !ONE_DUMBBELL.has(exercise.slug)) return "Gewicht je Hantel";
  return "Gewicht";
}

const LOWER = new Set(["squat", "hinge", "lunge", "hip_extension", "knee_extension", "knee_flexion", "hip_abduction", "hip_adduction", "ankle_plantarflexion"]);
const EXPERIENCE_FACTOR: Record<ExperienceLevel, number> = { beginner: 0.6, intermediate: 1, advanced: 1.2 };
/** Frauen relativ zum Körpergewicht: Oberkörper deutlich, Unterkörper weniger schwächer. Ohne Angabe: wie Frauen (vorsichtig). */
const SEX_FACTOR = { upper: { male: 1, female: 0.55 }, lower: { male: 1, female: 0.75 } } as const;

/** Sicherheitsabschlag auf das geschätzte 1RM: verwandte Übung bzw. Kraftnorm */
export const SAFETY = { related: 0.9, standards: 0.8 } as const;

export function standardOneRepMax(
  exercise: Pick<Exercise, "slug" | "movementPattern">,
  who: { bodyWeightKg: number | null; sex: Sex | null; experience: ExperienceLevel },
): number | null {
  const ratio = STRENGTH_RATIO[exercise.slug];
  if (ratio == null || !who.bodyWeightKg || who.bodyWeightKg <= 0) return null;
  const region = LOWER.has(exercise.movementPattern) ? "lower" : "upper";
  const sex = SEX_FACTOR[region][who.sex ?? "female"];
  return who.bodyWeightKg * ratio * sex * EXPERIENCE_FACTOR[who.experience];
}

const isWorking = (s: LoggedSetLike) => ["working", "backoff", "amrap"].includes(s.setType) && s.reps != null && s.reps > 0;

/** Bestes geschätztes 1RM der Übung im letzten Training, in dem sie vorkam. */
function latestStrength(history: readonly CompletedSession[], exerciseId: string): { e1rm: number; date: string } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const session = history[i];
    const sets = session.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter(isWorking));
    if (sets.length === 0) continue;
    const best = Math.max(...sets.map((s) => estimateOneRepMax(s) ?? 0));
    if (best > 0) return { e1rm: best, date: session.endedAt };
  }
  return null;
}

/**
 * Aus verwandten Übungen umrechnen: gleiches Bewegungsmuster, möglichst viele gemeinsame Hauptmuskeln, dann das
 * jüngste Training. History ist nach Datum aufsteigend sortiert.
 */
export function transferOneRepMax(target: Exercise, history: readonly CompletedSession[]): { e1rm: number; from: Exercise } | null {
  const targetRatio = STRENGTH_RATIO[target.slug];
  if (targetRatio == null) return null;
  const primary = new Set(target.muscles.filter((m) => m.role === "primary").map((m) => m.muscle));
  const candidates = [...new Set(history.flatMap((s) => s.exercises.map((e) => e.exerciseId)))]
    .map((id) => getExerciseById(id))
    .filter((e): e is Exercise => Boolean(e && e.id !== target.id && e.movementPattern === target.movementPattern && STRENGTH_RATIO[e.slug] != null))
    .map((e) => ({ e, shared: e.muscles.filter((m) => m.role === "primary" && primary.has(m.muscle)).length, latest: latestStrength(history, e.id) }))
    .filter((c): c is { e: Exercise; shared: number; latest: { e1rm: number; date: string } } => c.latest != null)
    .sort((a, b) => b.shared - a.shared || b.latest.date.localeCompare(a.latest.date));
  const best = candidates[0];
  if (!best) return null;
  return { e1rm: (best.latest.e1rm * targetRatio) / STRENGTH_RATIO[best.e.slug], from: best.e };
}

export interface StartEstimate {
  /** geschätztes 1RM nach Sicherheitsabschlag */
  strength: number;
  source: "related" | "standards";
  reason: string;
}

const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });

export function startEstimate(input: {
  exercise: Exercise;
  history: readonly CompletedSession[];
  bodyWeightKg: number | null;
  sex: Sex | null;
  experience: ExperienceLevel;
}): StartEstimate | null {
  const related = transferOneRepMax(input.exercise, input.history);
  if (related) {
    return {
      strength: related.e1rm * SAFETY.related,
      source: "related",
      reason: `Geschätzt aus ${related.from.nameDe}`,
    };
  }
  const standard = standardOneRepMax(input.exercise, input);
  if (standard != null) {
    return {
      strength: standard * SAFETY.standards,
      source: "standards",
      reason: `Geschätzt aus Körpergewicht (${de(input.bodyWeightKg!)} kg)${input.sex ? "" : ", vorsichtig ohne Angabe des Geschlechts"}`,
    };
  }
  return null;
}

// ─────────────────────────── Empfehlung je Satz ───────────────────────────

export interface Recommendation extends LoadSuggestion {
  /** Körpergewichtsübung: weightKg ist das Zusatzgewicht (0 = ohne) */
  bodyweight: boolean;
  /** Startgewicht geschätzt (kein eigener Verlauf) – nach dem ersten Satz wird nachjustiert */
  estimated: boolean;
}

export interface RecommendInput {
  exercise: Exercise;
  sets: number;
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  targetLoadKg: number | null;
  mode: LoadTarget;
  /** Arbeitssätze des letzten Trainings dieser Übung */
  previous: readonly LoggedSetLike[];
  /** Sätze von heute */
  today: readonly LoggedSetLike[];
  /** alle abgeschlossenen Trainings (aufsteigend) – für die Umrechnung aus verwandten Übungen */
  history: readonly CompletedSession[];
  bodyWeightKg: number | null;
  sex: Sex | null;
  experience: ExperienceLevel;
  /** persönliche RIR-Abweichung (RIR-Check) */
  correction: number;
}

/** null = keine Gewichtsempfehlung möglich (Zeitübung, Band, Körpergewicht ohne bekanntes Körpergewicht). */
export function recommendLoad(input: RecommendInput): Recommendation | null {
  const { exercise } = input;
  if (exercise.trackingType === "duration" || exercise.equipment.includes("resistance_band")) return null;
  const heavyCompound = exercise.mechanic === "compound" && (exercise.systemicFatigue >= 4 || exercise.equipment.includes("barbell"));
  const common = {
    mode: input.mode,
    repsMin: input.repsMin,
    repsMax: input.repsMax,
    rirMin: input.rirMin,
    rirMax: input.rirMax,
    sets: input.sets,
    heavyCompound,
  };

  if (exercise.trackingType === "bodyweight_reps") {
    const fraction = BODY_FRACTION[exercise.slug];
    if (fraction == null || !input.bodyWeightKg) return null;
    return bodyweightLoad(input, input.bodyWeightKg * fraction, common);
  }

  const previous = correctRir(input.previous, input.correction);
  const today = correctRir(input.today, input.correction);
  const hasOwn = previous.some(isWorking) || today.some(isWorking) || input.targetLoadKg != null;
  const estimate = hasOwn ? null : startEstimate(input);
  const suggestion = suggestLoad({
    ...common,
    loadIncrementKg: exercise.loadIncrementKg,
    targetLoadKg: input.targetLoadKg,
    previous,
    today,
    estimate: estimate ? { strength: estimate.strength, label: estimate.reason } : undefined,
  });
  if (suggestion.weightKg == null) return null;
  return { ...suggestion, bodyweight: false, estimated: estimate != null };
}

/** Körpergewicht + Zusatz als Gesamtlast rechnen; empfohlen wird das Zusatzgewicht (oder ohne). */
function bodyweightLoad(input: RecommendInput, bodyLoad: number, common: Omit<Parameters<typeof suggestLoad>[0], "loadIncrementKg" | "targetLoadKg" | "previous" | "today">): Recommendation {
  const total = (sets: readonly LoggedSetLike[]) =>
    correctRir(sets, input.correction).map((s) => ({ ...s, weightKg: (s.weightKg ?? 0) + bodyLoad }));
  const previous = total(input.previous);
  const today = total(input.today);
  const step = input.exercise.loadIncrementKg > 0 ? input.exercise.loadIncrementKg : 2.5;
  if (!previous.some(isWorking) && !today.some(isWorking)) {
    // Ziel-RIR und Beschriftung wie bei jeder anderen Übung
    const { targetRir, effortLabel, lastSet } = suggestLoad({ ...common, loadIncrementKg: step, targetLoadKg: null, previous: [], today });
    return {
      weightKg: 0,
      expectedReps: null,
      targetRir,
      effortLabel,
      lastSet,
      change: "same",
      reason: "Erster Satz ohne Zusatzgewicht – danach empfiehlt die App, ob Zusatz passt",
      bodyweight: true,
      estimated: true,
    };
  }
  const s = suggestLoad({ ...common, loadIncrementKg: step, targetLoadKg: null, previous, today });
  const added = s.weightKg == null ? 0 : Math.max(0, Math.round((s.weightKg - bodyLoad) / step) * step);
  // Stärke wie in suggestLoad: heute der letzte Satz, sonst der beste vom letzten Mal (Epley, RIR-korrigiert)
  const strengthOf = (x: LoggedSetLike) => (x.weightKg ?? 0) * (1 + Math.min(30, (x.reps ?? 0) + (x.rir ?? 0)) / 30);
  const latest = [...today].reverse().find(isWorking);
  const strength = latest ? strengthOf(latest) : Math.max(0, ...previous.filter(isWorking).map(strengthOf));
  const repsAt = (load: number) => (strength > 0 ? Math.max(1, Math.round(30 * (strength / load - 1) - s.targetRir)) : null);
  const atBody = repsAt(bodyLoad);
  // erwartete Wiederholungen mit dem tatsächlich empfohlenen (gerundeten) Zusatz
  const expectedReps = added > 0 ? repsAt(bodyLoad + added) : atBody;
  // Grundlage in Zusatzgewicht beschreiben (nicht in Gesamtlast – die verwirrt)
  const own = [...input.today].reverse().find(isWorking) ?? input.previous.filter(isWorking).sort((x, y) => (y.reps ?? 0) - (x.reps ?? 0))[0];
  const basis = own
    ? `${input.today.some(isWorking) ? "Letzter Satz" : "Letztes Mal"}: ${own.weightKg ? `+${de(own.weightKg)} kg` : "ohne Zusatz"} × ${own.reps}${own.rir != null ? ` (${de(own.rir)} im Tank)` : ""}`
    : "";
  const reason =
    added > 0
      ? `${basis} → +${de(added)} kg Zusatz, ca. ${expectedReps} Wdh.`
      : atBody != null && atBody < common.repsMin
        ? `Ohne Zusatz ca. ${atBody} Wdh. – unter dem Ziel; so viele saubere Wiederholungen wie möglich`
        : `Ohne Zusatzgewicht, ca. ${atBody ?? "?"} Wdh.`;
  return { ...s, weightKg: added, expectedReps, reason, bodyweight: true, estimated: false };
}
