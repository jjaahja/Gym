"use client";

import Link from "next/link";
import { LineChart, type LinePoint } from "@/components/charts";
import { ExerciseNote } from "@/components/exercise-note";
import { Card, SectionLabel } from "@/components/ui";
import { getDb } from "@/lib/offline/db";
import { sessionsWithExercise } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { estimateOneRepMax } from "@/lib/training/progression";
import { bestsFrom } from "@/lib/training/records";
import { formatWeight } from "@/lib/units";
import { useSettings } from "@/stores/settings";

const day = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });
const dayShort = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

/** Dein Verlauf mit dieser Übung: Bestwerte, geschätztes 1RM über die Zeit, letzte Trainings. */
export function ExerciseHistory({ exerciseId, exerciseName }: { exerciseId: string; exerciseName: string }) {
  const unit = useSettings((s) => s.unitSystem);
  const sessions = useLiveQuery(() => sessionsWithExercise(getDb(), exerciseId), [exerciseId], null);
  if (!sessions) return null;

  const bests = bestsFrom(sessions, exerciseId);
  const rows = sessions
    .map((s) => {
      const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter((x) => x.setType !== "warmup");
      const scored = sets.map((x) => ({ x, e1rm: estimateOneRepMax(x) })).sort((a, b) => (b.e1rm ?? 0) - (a.e1rm ?? 0));
      return { session: s, sets, best: scored[0] };
    })
    .filter((r) => r.sets.length > 0);
  const points: LinePoint[] = rows
    .filter((r) => r.best?.e1rm != null)
    .map((r) => ({ x: Date.parse(r.session.endedAt), y: r.best.e1rm!, note: `${formatWeight(r.best.x.weightKg ?? 0, unit)} × ${r.best.x.reps}` }));

  return (
    <section className="space-y-3">
      <SectionLabel>Dein Verlauf</SectionLabel>
      <ExerciseNote exerciseId={exerciseId} exerciseName={exerciseName} />
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Noch kein Training mit dieser Übung. Nach dem ersten Satz siehst du hier Bestwerte und Verlauf.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-[0.8125rem] text-muted">Bestes geschätztes 1RM</p>
              <p className="tabular mt-0.5 text-2xl font-bold">{bests.e1rm ? formatWeight(bests.e1rm.value, unit) : "–"}</p>
              {bests.e1rm && <p className="text-xs text-muted">{day(bests.e1rm.date)}</p>}
            </Card>
            <Card>
              <p className="text-[0.8125rem] text-muted">Schwerster Satz</p>
              <p className="tabular mt-0.5 text-2xl font-bold">
                {bests.weight ? `${formatWeight(bests.weight.value, unit)} × ${bests.weight.reps}` : "–"}
              </p>
              {bests.weight && <p className="text-xs text-muted">{day(bests.weight.date)}</p>}
            </Card>
          </div>
          {points.length >= 2 && (
            <Card>
              <LineChart
                title="Geschätztes 1RM"
                description="Bester Satz je Training (RIR-korrigiert)"
                points={points}
                formatValue={(v) => formatWeight(v, unit)}
                formatTick={(v) => String(Math.round(v))}
                formatDate={(ms) => day(new Date(ms).toISOString())}
                formatDateShort={dayShort}
                valueLabel="1RM"
              />
            </Card>
          )}
          <ul className="overflow-hidden rounded-[1.125rem] bg-surface shadow-card">
            {[...rows].reverse().slice(0, 8).map((r, i) => (
              <li key={r.session.id} className={i > 0 ? "border-t border-border" : ""}>
                <Link href={`/training/${r.session.id}`} className="flex min-h-11 items-center gap-3 px-4 py-2.5 active:bg-surface-2">
                  <span className="w-24 shrink-0 text-[0.8125rem] text-muted">{day(r.session.endedAt)}</span>
                  <span className="tabular min-w-0 flex-1 truncate text-[0.9375rem]">
                    {r.sets.map((x) => (x.durationSeconds ? `${x.durationSeconds} s` : x.weightKg ? `${formatWeight(x.weightKg, unit)}×${x.reps}` : `${x.reps}`)).join(" · ")}
                  </span>
                  <span aria-hidden="true" className="text-xl text-muted/60">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
