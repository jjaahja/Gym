"use client";

import { useMemo } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles } from "@/components/ui";
import { getMuscle, type Exercise } from "@/lib/catalog";
import { removalWarnings } from "@/lib/training/removal";
import { planStore } from "@/stores/plan";
import type { StoredPlan } from "@/stores/plan-store";
import { workoutStore } from "@/stores/workout";

const muscleName = (m: Parameters<typeof getMuscle>[0]) => getMuscle(m).nameDe.replace(/ \(.*\)$/, "");
const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/**
 * Übung aus dem laufenden Training entfernen – samt eingetragenen Sätzen. Bei Planübungen zusätzlich die Wahl:
 * nur heute oder auch dauerhaft aus dem Plan (mit Warnung, falls ein Muskel danach zu wenig Volumen bekommt).
 */
export function RemoveSheet({
  onClose,
  exercise,
  original,
  planExerciseId,
  exerciseLogId,
  loggedSets,
  plan,
}: {
  onClose: () => void;
  /** heute angezeigte Übung */
  exercise: Exercise;
  /** Übung laut Plan (bei Ersatz für heute abweichend) */
  original: Exercise | null;
  planExerciseId: string | null;
  exerciseLogId: string | null;
  loggedSets: number;
  plan: StoredPlan | null;
}) {
  const inPlan = Boolean(planExerciseId && plan?.days.some((d) => d.exercises.some((e) => e.id === planExerciseId)));
  const warnings = useMemo(() => (inPlan && plan && planExerciseId ? removalWarnings(plan, planExerciseId) : []), [inPlan, plan, planExerciseId]);
  const planName = original?.nameDe ?? exercise.nameDe;

  const removeToday = () => {
    workoutStore.getState().removeExercise({ planExerciseId, exerciseLogId });
    onClose();
  };
  const removeFromPlan = () => {
    workoutStore.getState().removeExercise({ planExerciseId, exerciseLogId });
    if (planExerciseId) planStore.getState().removeExercise(planExerciseId);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Übung entfernen?">
      <div className="space-y-4">
        <p className="text-sm">
          <span className="font-semibold">{exercise.nameDe}</span> wird aus dem heutigen Training entfernt.
          {loggedSets > 0 && (
            <>
              {" "}
              {loggedSets === 1 ? "Der eingetragene Satz wird" : `Die ${loggedSets} eingetragenen Sätze werden`} gelöscht.
            </>
          )}
        </p>

        {inPlan ? (
          <>
            <p className="text-sm text-muted">
              Nur heute: Der Plan bleibt, beim nächsten Mal ist {planName} wieder dabei. Auch aus dem Plan: {planName} fällt
              dauerhaft weg – rückgängig machbar im Anpassungsprotokoll.
            </p>
            {warnings.length > 0 && (
              <div role="note" className="rounded-xl bg-warning-bg p-3 text-sm text-warning-fg">
                <p className="font-semibold">Danach zu wenig Volumen</p>
                <ul className="mt-1 space-y-0.5">
                  {warnings.map((w) => (
                    <li key={w.muscle}>
                      {muscleName(w.muscle)}: {de(w.after)} statt {de(w.before)} Sätze pro Woche (empfohlen mind. {de(w.min)})
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Tipp: Statt zu entfernen lieber tauschen – so bleibt das Volumen erhalten.</p>
              </div>
            )}
            <div className="grid gap-2">
              <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={removeToday}>
                Nur heute
              </button>
              <button type="button" className={`${buttonStyles.danger} w-full`} onClick={removeFromPlan}>
                Auch aus dem Plan
              </button>
            </div>
          </>
        ) : (
          <button type="button" className={`${buttonStyles.danger} w-full`} onClick={removeToday}>
            Entfernen
          </button>
        )}
        <button type="button" className="min-h-11 w-full text-sm font-medium text-muted" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </Sheet>
  );
}
