"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { getExerciseById, getMuscle, primaryMuscles } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { exerciseFeedback } from "@/lib/training/analytics";
import type { StoredPlan } from "@/stores/plan-store";
import { num, shortMuscleName } from "./format";

const SCALE_MAX = 3;
const PUMP_WORDS = ["kein", "leicht", "deutlich", "stark"];

/** Dünner Meter (8px, runde Enden): Anteil an der Skala 0–3. */
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-accent-soft"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={SCALE_MAX}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-chart-1" style={{ width: `${(value / SCALE_MAX) * 100}%` }} />
    </div>
  );
}

export function PumpTab({ sessions, plan }: { sessions: readonly CompletedSession[]; plan: StoredPlan | null }) {
  const [showAll, setShowAll] = useState(false);
  const inPlan = new Set(plan?.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)) ?? []);
  const rows = exerciseFeedback(sessions)
    .filter((f) => f.avgPump != null)
    .sort((a, b) => b.avgPump! - a.avgPump! || (a.avgJointDiscomfort ?? 0) - (b.avgJointDiscomfort ?? 0));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Deine Pump-Übungen</h2>
        <p className="mt-1 text-sm text-muted">
          Aus deinen Bewertungen nach jeder Übung (kein – leicht – deutlich – stark). Bei Übungswechseln bevorzugt die App
          Übungen mit gutem Pump und ohne Gelenkbeschwerden.
        </p>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Noch keine Bewertungen. Bewerte im Training nach der letzten Serie Pump und Gelenkgefühl – dauert zwei Sekunden.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-border">
            {(showAll ? rows : rows.slice(0, 10)).map((f) => {
              const exercise = getExerciseById(f.exerciseId);
              if (!exercise) return null;
              const pump = f.avgPump!;
              const joint = f.avgJointDiscomfort;
              return (
                <li key={f.exerciseId} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/exercises/${exercise.slug}`} className="min-w-0 truncate font-medium">
                      {exercise.nameDe}
                    </Link>
                    <span className="shrink-0 text-sm">
                      <span className="font-semibold">{num(pump)}</span>
                      <span className="text-muted"> / {SCALE_MAX}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Meter value={pump} label={`Pump ${exercise.nameDe}: Ø ${num(pump)} von ${SCALE_MAX}`} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {primaryMuscles(exercise).map((m) => shortMuscleName(getMuscle(m).nameDe)).join(", ")} · Ø „
                    {PUMP_WORDS[Math.round(pump)]}“ · {f.ratings} {f.ratings === 1 ? "Bewertung" : "Bewertungen"}
                    {inPlan.has(f.exerciseId) && " · im Plan"}
                  </p>
                  {joint != null && joint >= 1.5 && (
                    <p className="mt-1 text-xs font-medium text-danger">
                      ⚠ Gelenkbeschwerden im Schnitt „{PUMP_WORDS[Math.round(joint)]}“ – Ausführung prüfen oder Alternative wählen.
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {rows.length > 10 && (
          <button type="button" className="min-h-10 text-sm font-medium text-accent" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Weniger anzeigen" : `Alle ${rows.length} Übungen anzeigen`}
          </button>
        )}
      </Card>
      <p className="px-1 text-xs text-muted">
        Einordnung: Ob der Pump selbst Wachstum auslöst, ist nicht belegt. Er zeigt aber, dass du den Zielmuskel gut triffst –
        als Entscheidungshilfe zwischen ähnlich guten Übungen ist er sinnvoll. Entscheidend bleiben harte Sätze nahe am
        Muskelversagen und steigende Leistung.
      </p>
    </div>
  );
}
