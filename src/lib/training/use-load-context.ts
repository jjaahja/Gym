"use client";

import { useMemo } from "react";
import type { Exercise } from "@/lib/catalog";
import type { ExperienceLevel } from "@/lib/db/enums";
import { getDb, type CompletedSession } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { listMeasurements } from "@/lib/offline/measurements";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import type { UnitSystem } from "@/lib/db/enums";
import { formatWeight } from "@/lib/units";
import type { StoredPlanExercise } from "@/stores/plan-store";
import { useSettings } from "@/stores/settings";
import { rirBias } from "./rir-calibration";
import { recommendLoad, type Recommendation, type Sex } from "./start-weight";
import type { LoadTarget } from "./load-suggestion";

// Alles, was die Gewichtsempfehlung braucht – einmal geladen, im Training und in der Plan-Übersicht genutzt.

export interface LoadContext {
  /** null = lädt noch */
  history: CompletedSession[] | null;
  bodyWeightKg: number | null;
  sex: Sex | null;
  mode: LoadTarget;
  correction: number;
}

export function useLoadContext(): LoadContext {
  const history = useLiveQuery<CompletedSession[] | null>(() => allSessions(getDb()), [], null);
  const measurements = useLiveQuery(() => listMeasurements(getDb()), [], []);
  const calibrations = useLiveQuery(() => getDb().calibrations.toArray(), [], []);
  const sex = useSettings((s) => s.sex);
  const mode = useSettings((s) => s.loadTarget);
  const bodyWeightKg = [...measurements].reverse().find((m) => m.bodyWeightKg != null)?.bodyWeightKg ?? null;
  const correction = rirBias(calibrations)?.correction ?? 0;
  return useMemo(() => ({ history, bodyWeightKg, sex, mode, correction }), [history, bodyWeightKg, sex, mode, correction]);
}

/** Arbeitssätze der Übung im letzten Training, in dem sie vorkam. */
export function previousWorking(history: readonly CompletedSession[], exerciseId: string) {
  for (let i = history.length - 1; i >= 0; i--) {
    const sets = history[i].exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((s) => s.setType === "working"));
    if (sets.length) return sets;
  }
  return [];
}

/** Empfehlung für den ersten Satz der nächsten Einheit (Plan-Übersicht). */
export function firstSetRecommendation(
  exercise: Exercise,
  planned: Pick<StoredPlanExercise, "sets" | "repsMin" | "repsMax" | "rirMin" | "rirMax" | "targetLoadKg">,
  ctx: LoadContext,
  experience: ExperienceLevel,
): Recommendation | null {
  if (!ctx.history) return null;
  return recommendLoad({
    exercise,
    sets: planned.sets,
    repsMin: planned.repsMin,
    repsMax: planned.repsMax,
    rirMin: planned.rirMin,
    rirMax: planned.rirMax,
    targetLoadKg: planned.targetLoadKg,
    mode: ctx.mode,
    previous: previousWorking(ctx.history, exercise.id),
    today: [],
    history: ctx.history,
    bodyWeightKg: ctx.bodyWeightKg,
    sex: ctx.sex,
    experience,
    correction: ctx.correction,
  });
}

/** Kurzform für Listen: „62,5 kg“, „≈ 26 kg“ (geschätzt), „+5 kg“ bzw. „ohne Zusatz“ (Körpergewicht). */
export function recommendationText(r: Recommendation | null, unit: UnitSystem): string | null {
  if (!r || r.weightKg == null) return null;
  if (r.bodyweight) return r.weightKg > 0 ? `+${formatWeight(r.weightKg, unit)}` : "ohne Zusatz";
  return `${r.estimated ? "≈ " : ""}${formatWeight(r.weightKg, unit)}`;
}
