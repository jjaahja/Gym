"use client";

import { useMemo, useState } from "react";
import { ColumnChart, StatTile } from "@/components/charts";
import { ScienceHint } from "@/components/science";
import { Card } from "@/components/ui";
import { VolumeBar } from "@/components/volume-bar";
import { TRACKED_MUSCLES, type TrackedMuscle } from "@/data/catalog/muscles";
import { getMuscle } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { resolveMuscleGuidelines } from "@/lib/science";
import { weeklyMuscleSeries, type WeekPoint } from "@/lib/training/analytics";
import type { StoredPlan } from "@/stores/plan-store";
import { formatDateMedium, formatDateShort, num, shortMuscleName } from "./format";

const WEEKS = 8;
/** Abgeschlossene Wochen für den Durchschnitt (die laufende Woche zählt nicht mit) */
const AVERAGE_WEEKS = 4;

const setsLabel = (n: number) => `${num(n)} ${n === 1 ? "Satz" : "Sätze"}`;

function average(points: readonly WeekPoint[]): number {
  const complete = points.slice(0, -1).slice(-AVERAGE_WEEKS);
  return complete.length ? Math.round((complete.reduce((n, p) => n + p.sets, 0) / complete.length) * 10) / 10 : 0;
}

export function VolumeTab({ sessions, plan }: { sessions: readonly CompletedSession[]; plan: StoredPlan | null }) {
  const [now] = useState(() => new Date());
  const [muscle, setMuscle] = useState<TrackedMuscle>(plan?.assessment.priorityMuscles[0] ?? "chest");
  const goal = plan?.goal ?? "hypertrophy";
  const experience = plan?.experience ?? "intermediate";

  const all = useMemo(
    () =>
      TRACKED_MUSCLES.map((m) => {
        const guideline = resolveMuscleGuidelines(m, goal, experience).weekly_volume!;
        const planned = plan?.volume.find((v) => v.muscle === m);
        const series = weeklyMuscleSeries(sessions, m, WEEKS, now);
        return {
          muscle: m,
          guideline,
          min: planned?.min ?? guideline.min ?? 0,
          max: planned?.max ?? guideline.max ?? 0,
          planned: planned?.plannedSets ?? null,
          priority: planned?.priority ?? false,
          series,
          average: average(series),
        };
      }),
    [sessions, plan, goal, experience, now],
  );
  const current = all.find((a) => a.muscle === muscle)!;
  const name = shortMuscleName(getMuscle(muscle).nameDe);
  const thisWeek = current.series.at(-1)?.sets ?? 0;
  const status = current.average > current.max ? "above" : current.average < current.min - 0.5 ? "below" : "ok";
  const hasData = sessions.length > 0;

  const columns = current.series.map((p, i) => {
    const isCurrent = i === current.series.length - 1;
    return {
      key: p.weekStart.toISOString(),
      label: isCurrent ? "jetzt" : formatDateShort(p.weekStart.getTime()),
      fullLabel: isCurrent ? `Diese Woche (läuft, ab ${formatDateMedium(p.weekStart.getTime())})` : `Woche ab ${formatDateMedium(p.weekStart.getTime())}`,
      value: p.sets,
    };
  });

  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label="Muskel wählen">
        <div className="flex w-max gap-2 pb-1">
          {all.map((a) => (
            <button
              key={a.muscle}
              type="button"
              aria-pressed={a.muscle === muscle}
              onClick={() => setMuscle(a.muscle)}
              className={`min-h-10 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${
                a.muscle === muscle ? "bg-accent text-accent-fg" : "bg-surface-2"
              }`}
            >
              {shortMuscleName(getMuscle(a.muscle).nameDe)}
              {a.priority && <span aria-label=" (Priorität)"> ★</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Diese Woche" value={setsLabel(thisWeek)} hint="läuft noch" />
        <StatTile
          label={`Ø ${AVERAGE_WEEKS} Wochen`}
          value={setsLabel(current.average)}
          delta={
            hasData
              ? status === "ok"
                ? { text: "im Ziel", direction: "flat", tone: "good" }
                : status === "above"
                  ? { text: "zu hoch", direction: "up", tone: "bad" }
                  : { text: "zu niedrig", direction: "down", tone: "bad" }
              : undefined
          }
        />
        <StatTile label="Richtwert" value={`${current.min}–${current.max}`} hint={current.planned != null ? `geplant ${num(current.planned)}` : undefined} />
      </div>

      <Card>
        <ColumnChart
          title={`Harte Sätze pro Woche – ${name}`}
          description="Sätze mit höchstens 4 Wiederholungen im Tank; Mitbeanspruchung zählt halb."
          columns={columns}
          formatValue={setsLabel}
          formatTick={(v) => num(v)}
          band={{ min: current.min, max: current.max, label: `Richtwert ${current.min}–${current.max} Sätze` }}
          reference={current.planned != null ? { value: current.planned, label: `Geplant: ${setsLabel(current.planned)}` } : undefined}
          valueLabel="Harte Sätze"
          categoryLabel="Woche"
        />
      </Card>

      {hasData && status === "above" && (
        <Card className="border-warning-fg/30 bg-warning-bg text-warning-fg">
          <p className="text-sm font-semibold">Mehr als {current.max} harte Sätze pro Woche</p>
          <p className="mt-0.5 text-sm">
            Darüber bringt zusätzliches Volumen kaum noch Wachstum, erhöht aber die Ermüdung („Junk Volume“). Die
            Mesozyklus-Auswertung schlägt dann eine Reduktion vor.
          </p>
        </Card>
      )}

      <ScienceHint guideline={current.guideline} />

      <Card>
        <h2 className="font-semibold">Alle Muskeln</h2>
        <p className="mt-0.5 text-sm text-muted">
          Ø der letzten {AVERAGE_WEEKS} abgeschlossenen Wochen. Strich = geplant, markierter Bereich = Richtwert.
        </p>
        <ul className="mt-3 space-y-1">
          {all.map((a) => (
            <li key={a.muscle}>
              <button
                type="button"
                onClick={() => setMuscle(a.muscle)}
                aria-pressed={a.muscle === muscle}
                className={`w-full rounded-xl px-2 py-2 text-left ${a.muscle === muscle ? "bg-surface-2" : ""}`}
              >
                <VolumeBar
                  label={shortMuscleName(getMuscle(a.muscle).nameDe)}
                  value={a.average}
                  target={a.planned ?? undefined}
                  min={a.min}
                  max={a.max}
                  highlight={a.priority}
                />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
