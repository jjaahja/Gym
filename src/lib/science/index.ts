import type { MuscleSlug } from "@/data/catalog/muscles";
import { GUIDELINES, type GuidelineDefinition, type GuidelineScope } from "@/data/science/guidelines";
import { SOURCES, type SourceKey } from "@/data/science/sources";
import type { Exercise } from "@/lib/catalog";
import type {
  EvidenceGrade,
  ExperienceLevel,
  GuidelineCategory,
  GuidelineContext,
  GuidelineSeverity,
  GuidelineUnit,
  SourceType,
  TrainingGoal,
} from "@/lib/db/enums";
import { catalogId } from "@/lib/db/stable-id";

// Richtwerte und Auflösung – identische Logik wie public.resolve_*_guidelines() in der Datenbank.
// Die Gleichheit wird beim Seeden gegen PostgreSQL geprüft (siehe docs/03-katalog-und-logik.md).

export interface Source {
  id: string;
  key: SourceKey;
  citation: string;
  title: string;
  journal: string;
  year: number;
  doi: string | null;
  sourceType: SourceType;
}

export interface Guideline {
  id: string;
  key: string;
  category: GuidelineCategory;
  scope: GuidelineScope;
  min: number | null;
  max: number | null;
  unit: GuidelineUnit;
  title: string;
  message: string;
  rationale: string;
  severity: GuidelineSeverity;
  contexts: GuidelineContext[];
  evidenceGrade: EvidenceGrade;
  priority: number;
  specificity: number;
  sources: Source[];
}

/** Kategorien, die pro Übung aufgelöst werden (wie in resolve_exercise_guidelines). */
export const EXERCISE_CATEGORIES = [
  "rep_range",
  "rest_interval",
  "proximity_to_failure",
  "tempo",
  "progression",
  "autoregulation",
  "range_of_motion",
  "intensity_technique",
  "attentional_focus",
] as const satisfies readonly GuidelineCategory[];

/** Kategorien, die pro Muskelgruppe aufgelöst werden (wie in resolve_muscle_guidelines). */
export const MUSCLE_CATEGORIES = [
  "weekly_volume",
  "session_volume",
  "frequency",
] as const satisfies readonly GuidelineCategory[];

export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
export type MuscleCategory = (typeof MUSCLE_CATEGORIES)[number];

/** Gleiche Gewichtung wie die generierte Spalte scientific_guidelines.specificity. */
export function specificityOf(scope: GuidelineScope): number {
  return (
    (scope.exercise ? 32 : 0) +
    (scope.pattern ? 16 : 0) +
    (scope.muscle ? 8 : 0) +
    (scope.mechanic ? 4 : 0) +
    (scope.experience ? 2 : 0) +
    (scope.goal ? 1 : 0)
  );
}

export const sources: Source[] = SOURCES.map((s) => ({
  id: catalogId("source", s.key),
  key: s.key,
  citation: s.citation,
  title: s.title,
  journal: s.journal,
  year: s.year,
  doi: s.doi,
  sourceType: s.type,
}));

const sourceByKey = new Map(sources.map((s) => [s.key, s]));

function buildGuideline(def: GuidelineDefinition): Guideline {
  const scope = def.scope ?? {};
  return {
    id: catalogId("guideline", def.key),
    key: def.key,
    category: def.category,
    scope,
    min: def.min ?? null,
    max: def.max ?? null,
    unit: def.unit,
    title: def.title,
    message: def.message,
    rationale: def.rationale,
    severity: def.severity ?? "info",
    contexts: def.contexts,
    evidenceGrade: def.evidence,
    priority: def.priority ?? 0,
    specificity: specificityOf(scope),
    sources: def.sources.map((key) => sourceByKey.get(key)!),
  };
}

export const guidelines: Guideline[] = GUIDELINES.map(buildGuideline);

const guidelineByKey = new Map(guidelines.map((g) => [g.key, g]));

export function getGuideline(key: string): Guideline {
  const guideline = guidelineByKey.get(key);
  if (!guideline) throw new Error(`Unbekannter Richtwert: ${key}`);
  return guideline;
}

function byPrecedence(a: Guideline, b: Guideline): number {
  return b.specificity - a.specificity || b.priority - a.priority || a.key.localeCompare(b.key);
}

/** Alle passenden Regeln je Kategorie, bestpassende zuerst (für Tests und Erklärungen). */
export function matchingExerciseGuidelines(
  exercise: Exercise,
  goal: TrainingGoal,
  experience: ExperienceLevel,
): Map<ExerciseCategory, Guideline[]> {
  const primary = new Set(exercise.muscles.filter((m) => m.role === "primary").map((m) => m.muscle));
  const result = new Map<ExerciseCategory, Guideline[]>();

  for (const g of guidelines) {
    if (!(EXERCISE_CATEGORIES as readonly string[]).includes(g.category)) continue;
    const s = g.scope;
    const matches =
      (!s.exercise || s.exercise === exercise.slug) &&
      (!s.pattern || s.pattern === exercise.movementPattern) &&
      (!s.mechanic || s.mechanic === exercise.mechanic) &&
      (!s.goal || s.goal === goal) &&
      (!s.experience || s.experience === experience) &&
      (!s.muscle || primary.has(s.muscle));
    if (!matches) continue;
    const category = g.category as ExerciseCategory;
    result.set(category, [...(result.get(category) ?? []), g]);
  }
  for (const list of result.values()) list.sort(byPrecedence);
  return result;
}

export function resolveExerciseGuidelines(
  exercise: Exercise,
  goal: TrainingGoal,
  experience: ExperienceLevel,
): Partial<Record<ExerciseCategory, Guideline>> {
  const resolved: Partial<Record<ExerciseCategory, Guideline>> = {};
  for (const [category, list] of matchingExerciseGuidelines(exercise, goal, experience)) {
    resolved[category] = list[0];
  }
  return resolved;
}

export function matchingMuscleGuidelines(
  muscle: MuscleSlug,
  goal: TrainingGoal,
  experience: ExperienceLevel,
): Map<MuscleCategory, Guideline[]> {
  const result = new Map<MuscleCategory, Guideline[]>();
  for (const g of guidelines) {
    if (!(MUSCLE_CATEGORIES as readonly string[]).includes(g.category)) continue;
    const s = g.scope;
    const matches =
      !s.exercise &&
      !s.pattern &&
      !s.mechanic &&
      (!s.muscle || s.muscle === muscle) &&
      (!s.goal || s.goal === goal) &&
      (!s.experience || s.experience === experience);
    if (!matches) continue;
    const category = g.category as MuscleCategory;
    result.set(category, [...(result.get(category) ?? []), g]);
  }
  for (const list of result.values()) list.sort(byPrecedence);
  return result;
}

export function resolveMuscleGuidelines(
  muscle: MuscleSlug,
  goal: TrainingGoal,
  experience: ExperienceLevel,
): Partial<Record<MuscleCategory, Guideline>> {
  const resolved: Partial<Record<MuscleCategory, Guideline>> = {};
  for (const [category, list] of matchingMuscleGuidelines(muscle, goal, experience)) {
    resolved[category] = list[0];
  }
  return resolved;
}

const formatNumber = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Ersetzt {min}/{max} in der Nachricht. */
export function formatGuidelineMessage(g: Pick<Guideline, "message" | "min" | "max">): string {
  return g.message
    .replaceAll("{min}", g.min == null ? "" : formatNumber(g.min))
    .replaceAll("{max}", g.max == null ? "" : formatNumber(g.max));
}

export const EVIDENCE_LABELS: Record<EvidenceGrade, string> = {
  strong: "Starke Evidenz",
  moderate: "Moderate Evidenz",
  limited: "Begrenzte Evidenz",
  expert_opinion: "Expertenmeinung",
};
