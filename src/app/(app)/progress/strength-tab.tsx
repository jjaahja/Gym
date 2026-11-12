"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LineChart, StatTile } from "@/components/charts";
import { Card, Segmented } from "@/components/ui";
import { getExerciseById } from "@/lib/catalog";
import type { CompletedSession } from "@/lib/offline/db";
import { exerciseSeries, exercisesWithHistory, type ProgressPoint } from "@/lib/training/analytics";
import { detectStagnation, isRegressing } from "@/lib/training/progression";
import { toDisplayWeight, weightUnitLabel } from "@/lib/units";
import { getDb } from "@/lib/offline/db";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { actualRir, MIN_CALIBRATIONS, rirBias } from "@/lib/training/rir-calibration";
import { useSettings } from "@/stores/settings";
import { formatDate, formatDateMedium, formatDateShort, num, signed } from "./format";

type Metric = "e1rm" | "top";

export function StrengthTab({ sessions }: { sessions: readonly CompletedSession[] }) {
  const unit = useSettings((s) => s.unitSystem);
  const usage = useMemo(() => exercisesWithHistory(sessions.filter((s) => !s.deload)), [sessions]);
  const [selected, setSelected] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("e1rm");
  // Standard: die häufigste Grundübung – dort ist Kraftzuwachs am aussagekräftigsten
  const fallback = usage.find((u) => getExerciseById(u.exerciseId)?.mechanic === "compound") ?? usage[0];
  const exerciseId = selected && usage.some((u) => u.exerciseId === selected) ? selected : fallback?.exerciseId;

  if (!exerciseId) {
    return (
      <Card>
        <h2 className="font-semibold">Noch keine Trainingsdaten</h2>
        <p className="mt-1 text-sm text-muted">
          Nach deinem ersten Training siehst du hier für jede Übung, wie sich deine Kraft entwickelt.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Übung</span>
        <select
          value={exerciseId}
          onChange={(e) => setSelected(e.target.value)}
          className="field block min-h-12"
        >
          {usage.map((u) => (
            <option key={u.exerciseId} value={u.exerciseId}>
              {getExerciseById(u.exerciseId)?.nameDe} ({u.sessions}×)
            </option>
          ))}
        </select>
      </label>
      <ExerciseProgress
        key={exerciseId}
        exerciseId={exerciseId}
        sessions={sessions}
        metric={metric}
        onMetric={setMetric}
        unit={unit}
      />
      <CalibrationCard />
    </div>
  );
}

function ExerciseProgress({
  exerciseId,
  sessions,
  metric,
  onMetric,
  unit,
}: {
  exerciseId: string;
  sessions: readonly CompletedSession[];
  metric: Metric;
  onMetric: (m: Metric) => void;
  unit: ReturnType<typeof useSettings.getState>["unitSystem"];
}) {
  const exercise = getExerciseById(exerciseId)!;
  // Deload-Einheiten sind bewusst leichter – sie verfälschen den Kraftverlauf
  const series = useMemo(() => exerciseSeries(sessions.filter((s) => !s.deload), exerciseId), [sessions, exerciseId]);
  const hasLoad = series.some((p) => p.score != null);
  const label = weightUnitLabel(unit);

  const valueOf = (p: ProgressPoint): number | null => {
    if (!hasLoad) return p.workingSets ? p.totalReps! / p.workingSets : null;
    const kg = metric === "e1rm" ? p.score : p.topWeightKg;
    return kg == null || kg <= 0 ? null : toDisplayWeight(kg, unit);
  };
  const points = series.flatMap((p) => {
    const y = valueOf(p);
    if (y == null) return [];
    const avgReps = p.workingSets ? Math.round((p.totalReps! / p.workingSets) * 10) / 10 : null;
    const note = [
      p.topWeightKg ? `Top ${num(toDisplayWeight(p.topWeightKg, unit))} ${label}` : null,
      p.workingSets ? `${p.workingSets} ${p.workingSets === 1 ? "Satz" : "Sätze"}${avgReps != null ? `, Ø ${num(avgReps)} Wdh.` : ""}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return [{ x: Date.parse(p.date), y, note }];
  });

  const format = (v: number) => (hasLoad ? `${num(v)} ${label}` : `${num(v)} Wdh.`);
  const metricName = !hasLoad ? "Ø Wiederholungen pro Satz" : metric === "e1rm" ? "Geschätztes 1RM" : "Topgewicht";
  const first = points[0];
  const last = points.at(-1);
  const best = points.reduce((b, p) => (p.y > b.y ? p : b), points[0]);
  const change = first && last ? last.y - first.y : 0;
  const changePct = first && first.y > 0 ? (change / first.y) * 100 : 0;

  const stagnating = detectStagnation(series);
  const regressing = isRegressing(series);

  return (
    <>
      {hasLoad && (
        <Segmented
          value={metric}
          onChange={onMetric}
          options={[
            { value: "e1rm", label: "Geschätztes 1RM" },
            { value: "top", label: "Topgewicht" },
          ]}
        />
      )}

      {last && (
        <div className="grid grid-cols-3 gap-2">
          <StatTile
            label="Aktuell"
            value={format(last.y)}
            delta={
              points.length > 1
                ? {
                    text: `${signed(change)} (${signed(changePct, 0)} %)`,
                    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
                    tone: change > 0 ? "good" : change < 0 ? "bad" : "neutral",
                  }
                : undefined
            }
          />
          <StatTile label="Bestwert" value={format(best.y)} hint={formatDateMedium(best.x)} />
          <StatTile label="Einheiten" value={String(points.length)} hint={`seit ${formatDateMedium(first!.x)}`} />
        </div>
      )}

      <Card>
        {points.length > 0 ? (
          <LineChart
            title={metricName}
            description={exercise.nameDe}
            points={points}
            formatValue={format}
            formatTick={(v) => num(v)}
            formatDate={formatDate}
            formatDateShort={formatDateShort}
            valueLabel={metricName}
          />
        ) : (
          <p className="text-sm text-muted">Für diese Übung gibt es noch keine auswertbaren Sätze.</p>
        )}
        <p className="mt-3 text-xs text-muted">
          {hasLoad
            ? "Das geschätzte 1RM (Epley) rechnet Gewicht, Wiederholungen und Wiederholungen im Tank (RIR ≤ 4) in einen Wert um. So ist Fortschritt über verschiedene Wiederholungszahlen vergleichbar – ohne Maximalversuch. Aufwärm- und Deload-Sätze zählen nicht."
            : "Ohne Zusatzgewicht zeigt der Verlauf die durchschnittlichen Wiederholungen pro Arbeitssatz."}
        </p>
      </Card>

      <StatusNote stagnating={stagnating} regressing={regressing} sessions={series.length} />
      <Link href={`/exercises/${exercise.slug}`} className="block text-sm font-medium text-accent">
        Ausführung und Richtwerte zu {exercise.nameDe} →
      </Link>
    </>
  );
}

function StatusNote({ stagnating, regressing, sessions }: { stagnating: boolean; regressing: boolean; sessions: number }) {
  if (sessions < 4) {
    return (
      <p className="text-sm text-muted">
        Ab vier Einheiten erkennt die App Stillstand oder Rückgang und berücksichtigt das bei der Mesozyklus-Auswertung.
      </p>
    );
  }
  if (regressing) {
    return (
      <Card className="border-warning-fg/30 bg-warning-bg text-warning-fg">
        <p className="text-sm font-semibold">Letzte Einheit deutlich schwächer</p>
        <p className="mt-0.5 text-sm">
          Einzelne schwache Tage sind normal (Schlaf, Stress, Ernährung). Sinkt die Leistung bei mehreren Übungen und fühlen sich
          die Einheiten sehr hart an, schlägt die App eine leichtere Woche vor.
        </p>
      </Card>
    );
  }
  if (stagnating) {
    return (
      <Card>
        <p className="text-sm font-semibold">Seit drei Einheiten kein neuer Bestwert</p>
        <p className="mt-0.5 text-sm text-muted">
          Plateaus gehören dazu. Hält das bis zum Ende des Mesozyklus an, schlägt die App eine gleichwertige Alternative vor.
        </p>
      </Card>
    );
  }
  return <p className="text-sm text-muted">Läuft: Innerhalb der letzten drei Einheiten gab es einen neuen Bestwert.</p>;
}

/** RIR-Kalibrierung: Wie gut schätzt du die Wiederholungen im Tank? */
function CalibrationCard() {
  const calibrations = useLiveQuery(() => getDb().calibrations.orderBy("createdAt").reverse().toArray(), [], []);
  const bias = rirBias(calibrations);
  return (
    <Card>
      <h2 className="text-lg font-semibold">RIR-Kalibrierung</h2>
      {!bias ? (
        <p className="mt-1 text-sm text-muted">
          Im letzten Satz einer Maschinen-, Kabel- oder Isolationsübung erscheint „RIR-Check“: erst schätzen, dann bis zum
          Versagen. So lernst du, wie viele Wiederholungen du wirklich im Tank hast – und die Gewichtsvorschläge werden
          genauer.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[0.9375rem]">
            {Math.abs(bias.mean) < 0.5
              ? "Du schätzt sehr genau."
              : bias.mean > 0
                ? `Du hast im Schnitt ${num(bias.mean)} Wdh. mehr im Tank als geschätzt.`
                : `Du bist im Schnitt ${num(Math.abs(bias.mean))} Wdh. näher am Versagen als geschätzt.`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {bias.count} {bias.count === 1 ? "Test" : "Tests"}
            {bias.correction !== 0
              ? ` · Gewichtsvorschläge rechnen mit ${bias.correction > 0 ? "+" : ""}${num(bias.correction)} Wdh.`
              : bias.count < MIN_CALIBRATIONS
                ? ` · ab ${MIN_CALIBRATIONS} Tests fließt das in die Gewichtsvorschläge ein`
                : ""}
          </p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {calibrations.slice(0, 5).map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  {getExerciseById(c.exerciseId)?.nameDe} <span className="text-muted">· {formatDateShort(Date.parse(`${c.performedOn}T12:00:00`))}</span>
                </span>
                <span className="tabular shrink-0">
                  {num(c.predictedRir)} → <strong>{actualRir(c)}</strong>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-muted">
        Im Mittel unterschätzen Trainierende die Wiederholungen im Tank um etwa eine; nahe am Versagen wird die Schätzung
        genauer (Halperin et al. 2022, Meta-Analyse).
      </p>
    </Card>
  );
}
