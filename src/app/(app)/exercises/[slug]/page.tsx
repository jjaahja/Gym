import type { Metadata } from "next";
import { ExerciseVideo } from "@/components/exercise-video";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { exercises, getEquipment, getExercise, getMuscle } from "@/lib/catalog";
import { DIFFICULTY_LABELS, GOAL_LABELS, MECHANIC_LABELS, PROFILE_LABELS, ROLE_LABELS } from "@/lib/labels";
import { EVIDENCE_LABELS, formatGuidelineMessage, resolveExerciseGuidelines, type ExerciseCategory, type Guideline } from "@/lib/science";
import { rirToRpe } from "@/lib/training/effort";

// Der Katalog ist statisch → alle Detailseiten werden beim Build vorgerendert.
export function generateStaticParams() {
  return exercises.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const exercise = getExercise((await params).slug);
  return exercise ? { title: exercise.nameDe, description: exercise.description } : {};
}

// Reihenfolge der Richtwerte auf der Seite
const CATEGORY_ORDER: ExerciseCategory[] = [
  "rep_range",
  "proximity_to_failure",
  "rest_interval",
  "range_of_motion",
  "tempo",
  "attentional_focus",
  "intensity_technique",
  "progression",
  "autoregulation",
];

// Bis das Onboarding steht: Richtwerte für das Hauptziel der App
const DEFAULT_GOAL = "hypertrophy" as const;
const DEFAULT_LEVEL = "intermediate" as const;

function GuidelineItem({ guideline }: { guideline: Guideline }) {
  const rpe =
    guideline.unit === "rir" && guideline.min != null && guideline.max != null
      ? ` (≈ RPE ${rirToRpe(guideline.max)}–${rirToRpe(guideline.min)})`
      : "";
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-muted">{guideline.title}</p>
        <span className="shrink-0 text-xs text-muted">{EVIDENCE_LABELS[guideline.evidenceGrade]}</span>
      </div>
      <p className="mt-0.5 font-semibold">
        {formatGuidelineMessage(guideline)}
        {rpe}
      </p>
      <details className="group mt-1">
        <summary className="cursor-pointer list-none text-sm text-accent">
          <span className="group-open:hidden">Warum?</span>
          <span className="hidden group-open:inline">Weniger</span>
        </summary>
        <p className="mt-2 text-sm text-muted">{guideline.rationale}</p>
        {guideline.sources.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {guideline.sources.map((s) => (
              <li key={s.key}>
                {s.doi ? (
                  <a href={`https://doi.org/${s.doi}`} className="underline" target="_blank" rel="noreferrer">
                    {s.citation}
                  </a>
                ) : (
                  s.citation
                )}{" "}
                – {s.journal}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export default async function ExerciseDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const exercise = getExercise((await params).slug);
  if (!exercise) notFound();

  const resolved = resolveExerciseGuidelines(exercise, DEFAULT_GOAL, DEFAULT_LEVEL);
  const guidelines = CATEGORY_ORDER.map((c) => resolved[c]).filter((g): g is Guideline => g !== undefined);
  const tags = [
    MECHANIC_LABELS[exercise.mechanic],
    DIFFICULTY_LABELS[exercise.difficulty],
    exercise.resistanceProfile ? PROFILE_LABELS[exercise.resistanceProfile] : null,
    exercise.laterality === "unilateral" ? "Einseitig" : null,
  ].filter(Boolean);

  return (
    <article className="space-y-4">
      <Link href="/exercises" className="inline-flex min-h-10 items-center text-sm text-accent">
        ‹ Alle Übungen
      </Link>

      <header>
        <h1 className="text-2xl font-bold tracking-tight">{exercise.nameDe}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((t) => (
            <span key={t} className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium">
              {t}
            </span>
          ))}
        </div>
        <p className="mt-3 text-muted">{exercise.description}</p>
      </header>

      <ExerciseVideo slug={exercise.slug} exerciseName={exercise.nameDe} />

      <Card>
        <h2 className="text-lg font-semibold">Ausführung</h2>
        <ol className="mt-3 space-y-3">
          {exercise.instructions.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {exercise.cues.map((cue) => (
            <span key={cue} className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium">
              „{cue}“
            </span>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Typische Fehler</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          {exercise.commonMistakes.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Muskeln</h2>
        <ul className="mt-2 space-y-2">
          {exercise.muscles.map((m) => (
            <li key={m.muscle} className="flex items-center justify-between gap-3">
              <span>{getMuscle(m.muscle).nameDe}</span>
              <span className={`text-sm ${m.role === "primary" ? "font-semibold text-accent" : "text-muted"}`}>
                {ROLE_LABELS[m.role]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          <span className="font-medium text-fg">Equipment:</span>{" "}
          {exercise.equipment.length ? exercise.equipment.map((e) => getEquipment(e).nameDe).join(", ") : "keins nötig"}
        </p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Richtwerte</h2>
        <p className="mt-1 text-sm text-muted">
          Für {GOAL_LABELS[DEFAULT_GOAL]}, Fortgeschrittene. Nach dem Onboarding passen sie sich an dein Ziel und deine
          Erfahrung an.
        </p>
        <ul className="mt-1 divide-y divide-border">
          {guidelines.map((g) => (
            <GuidelineItem key={g.key} guideline={g} />
          ))}
        </ul>
      </Card>
    </article>
  );
}
