"use client";

import { useMemo, useState } from "react";
import { SwapIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles } from "@/components/ui";
import type { EquipmentSlug } from "@/data/catalog/equipment";
import { getEquipment, getExerciseById, getMuscle, primaryMuscles, type Exercise } from "@/lib/catalog";
import type { ExperienceLevel, TrainingGoal } from "@/lib/db/enums";
import { getDb } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { exerciseFeedback } from "@/lib/training/analytics";
import { rankAlternatives, type ExerciseFeedback } from "@/lib/training/progression";
import { planStore } from "@/stores/plan";
import { workoutStore } from "@/stores/workout";

const muscleName = (m: Parameters<typeof getMuscle>[0]) => getMuscle(m).nameDe.replace(/ \(.*\)$/, "");

/** Übung im Training tauschen: Vorschläge mit denselben Zielmuskeln, nur heute oder dauerhaft im Plan. */
export function SwapSheet({
  open,
  onClose,
  planExerciseId,
  original,
  current,
  inSession,
  goal,
  experience,
  equipment,
  canSwap,
}: {
  open: boolean;
  onClose: () => void;
  planExerciseId: string;
  /** Übung laut Plan */
  original: Exercise;
  /** gerade angezeigte Übung (Original oder heutiger Ersatz) */
  current: Exercise;
  /** Slugs der übrigen Übungen im heutigen Training */
  inSession: ReadonlySet<string>;
  goal: TrainingGoal;
  experience: ExperienceLevel;
  equipment: readonly EquipmentSlug[];
  /** false, wenn schon Sätze eingetragen sind */
  canSwap: boolean;
}) {
  const sessions = useLiveQuery(() => allSessions(getDb()), [], []);
  const feedback = useMemo(
    () =>
      new Map<string, ExerciseFeedback>(
        exerciseFeedback(sessions).map((f) => [getExerciseById(f.exerciseId)?.slug ?? f.exerciseId, f]),
      ),
    [sessions],
  );
  const alternatives = useMemo(
    () =>
      rankAlternatives(original, {
        goal,
        experience,
        equipment,
        exclude: new Set([...inSession, current.slug]),
        feedback,
        limit: 6,
        muscleName,
      }),
    [original, goal, experience, equipment, inSession, current.slug, feedback],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [permanent, setPermanent] = useState(false);
  const substituted = current.slug !== original.slug;

  function confirm(slug: string) {
    const target = alternatives.find((a) => a.exercise.slug === slug)?.exercise ?? (slug === original.slug ? original : null);
    if (!target) return;
    if (permanent && slug !== original.slug) {
      planStore.getState().swapExercise(planExerciseId, slug);
      workoutStore.getState().substitute(planExerciseId, null);
    } else {
      workoutStore.getState().substitute(planExerciseId, slug === original.slug ? null : target.id);
    }
    setSelected(null);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Übung tauschen">
      <div className="space-y-4">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-xs text-muted">{substituted ? "Heute statt" : "Statt"}</p>
          <p className="font-semibold">{original.nameDe}</p>
          <p className="text-xs text-muted">Zielmuskeln: {primaryMuscles(original).map(muscleName).join(", ")}</p>
        </div>

        {!canSwap && (
          <p className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="status">
            Für diese Übung sind schon Sätze eingetragen. Lösche sie zuerst, wenn du tauschen möchtest – sonst würden zwei
            Übungen vermischt.
          </p>
        )}

        <fieldset disabled={!canSwap}>
          <legend className="mb-2 text-sm font-medium">Passende Alternativen</legend>
          {alternatives.length === 0 ? (
            <p className="text-sm text-muted">Mit deiner Ausstattung gibt es keine passende Alternative.</p>
          ) : (
            <ul className="space-y-2">
              {alternatives.map((a, i) => {
                const isSelected = selected === a.exercise.slug;
                return (
                  <li key={a.exercise.slug}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelected(a.exercise.slug)}
                      className={`w-full rounded-2xl p-3 text-left transition-colors ${isSelected ? "bg-accent-soft ring-2 ring-accent" : "bg-surface-2"}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{a.exercise.nameDe}</span>
                        {i === 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Beste Wahl</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{a.reason}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {primaryMuscles(a.exercise).map((m) => (
                          <span
                            key={m}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.shared.includes(m) ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}
                          >
                            {muscleName(m)}
                          </span>
                        ))}
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                          {a.exercise.equipment.length ? a.exercise.equipment.map((e) => getEquipment(e).nameDe).join(", ") : "Körpergewicht"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        {selected && canSwap && (
          <div className="space-y-3 rounded-[1.125rem] bg-surface p-3 shadow-card">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Wie lange?</legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
                {[
                  [false, "Nur heute"],
                  [true, "Dauerhaft im Plan"],
                ].map(([value, label]) => (
                  <button
                    key={String(value)}
                    type="button"
                    aria-pressed={permanent === value}
                    onClick={() => setPermanent(value as boolean)}
                    className={`min-h-11 rounded-lg text-sm font-semibold ${permanent === value ? "bg-accent text-accent-fg" : "text-muted"}`}
                  >
                    {label as string}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-muted">
              {permanent
                ? "Ersetzt die Übung in deinem Plan. Lässt sich im Plan unter „Anpassungen“ rückgängig machen. Gewicht wird beim ersten Training neu ermittelt."
                : "Nur dieses Training. Das Gewicht der Planübung wird heute nicht angepasst."}
            </p>
            <button type="button" className={`${buttonStyles.primary} w-full gap-2`} onClick={() => confirm(selected)}>
              <SwapIcon className="size-5" /> Tauschen
            </button>
          </div>
        )}

        {substituted && canSwap && (
          <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => confirm(original.slug)}>
            Zurück zu {original.nameDe}
          </button>
        )}
      </div>
    </Sheet>
  );
}
