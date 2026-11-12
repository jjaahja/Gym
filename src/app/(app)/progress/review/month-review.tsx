"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { StatTile } from "@/components/charts";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Card, List, ListRow, SectionLabel } from "@/components/ui";
import { getExerciseById, getMuscle } from "@/lib/catalog";
import { monthlyReview, previousMonth, reviewDue } from "@/lib/motivation";
import { getDb, type CompletedSession } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { listMeasurements } from "@/lib/offline/measurements";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { localDay } from "@/lib/training/schedule";
import { formatWeight } from "@/lib/units";
import { useSettings } from "@/stores/settings";

const de = (n: number, digits = 0) => n.toLocaleString("de-DE", { maximumFractionDigits: digits });
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const delta = (now: number, before: number | undefined, unit = "") => {
  if (before == null) return undefined;
  const diff = now - before;
  return {
    text: diff === 0 ? "wie im Vormonat" : `${diff > 0 ? "+" : "−"}${de(Math.abs(diff))}${unit} zum Vormonat`,
    direction: diff > 0 ? ("up" as const) : diff < 0 ? ("down" as const) : ("flat" as const),
    tone: diff > 0 ? ("good" as const) : diff < 0 ? ("bad" as const) : ("neutral" as const),
  };
};

/** Monatsrückblick: Trainings, Zeit, harte Sätze, bewegte Last, neue Bestwerte, Körpergewicht, Eiweiß. */
export function MonthReviewContent() {
  const sessions = useLiveQuery<CompletedSession[] | null>(() => allSessions(getDb()), [], null);
  // Daten liegen nur im Browser – erst dann das Datum lesen (kein Vorrendern mit Uhrzeit)
  if (!sessions)
    return (
      <div className="space-y-5">
        <div className="h-24" />
        <Card className="h-64 animate-pulse">{null}</Card>
      </div>
    );
  return <Review sessions={sessions} />;
}

function Review({ sessions }: { sessions: CompletedSession[] }) {
  const unit = useSettings((s) => s.unitSystem);
  const measurements = useLiveQuery(() => listMeasurements(getDb()), [], []);
  const nutrition = useLiveQuery(() => getDb().nutrition.toArray(), [], []);
  const [now] = useState(() => new Date());
  const current = localDay(now).slice(0, 7);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? reviewDue(sessions, now) ?? current;
  const review = useMemo(() => monthlyReview(sessions, month, { measurements, nutrition }), [sessions, month, measurements, nutrition]);
  const first = sessions[0] ? localDay(new Date(sessions[0].startedAt)).slice(0, 7) : current;

  return (
    <div className="space-y-5">
      <header>
        <Link href="/progress" className="text-[1.0625rem] text-accent">
          ‹ Fortschritt
        </Link>
        <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15]">Rückblick</h1>
      </header>

      <div className="flex items-center justify-between rounded-[1.125rem] bg-surface px-2 py-1 shadow-card">
        <button
          type="button"
          aria-label="Vorheriger Monat"
          disabled={month <= first}
          onClick={() => setPicked(previousMonth(month))}
          className="grid size-11 place-items-center text-accent disabled:opacity-30"
        >
          <ChevronLeftIcon className="size-5" />
        </button>
        <h2 className="text-[1.0625rem] font-semibold" aria-live="polite">
          {review.label}
        </h2>
        <button
          type="button"
          aria-label="Nächster Monat"
          disabled={month >= current}
          onClick={() => setPicked(nextMonth(month))}
          className="grid size-11 place-items-center text-accent disabled:opacity-30"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </div>

      {review.trainings === 0 ? (
        <Card>
          <p className="font-semibold">Keine Trainings im {review.label.split(" ")[0]}</p>
          <p className="mt-1 text-sm text-muted">Sobald du trainierst, siehst du hier deinen Monat auf einen Blick.</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Trainings" value={de(review.trainings)} delta={delta(review.trainings, review.previous?.trainings)} />
            <StatTile label="Trainingszeit" value={`${Math.floor(review.minutes / 60)} h ${String(review.minutes % 60).padStart(2, "0")} min`} />
            <StatTile label="Harte Sätze" value={de(review.hardSets)} delta={delta(review.hardSets, review.previous?.hardSets)} />
            <StatTile
              label="Bewegte Last"
              value={unit === "metric" ? `${de(review.tonnageKg / 1000, 1)} t` : formatWeight(review.tonnageKg, unit)}
              hint="Gewicht × Wiederholungen"
            />
          </div>

          <section>
            <SectionLabel>{review.records.length ? `Neue Bestwerte (${review.records.length})` : "Neue Bestwerte"}</SectionLabel>
            {review.records.length ? (
              <List>
                {review.records.slice(0, 6).map((r) => (
                  <ListRow
                    key={r.exerciseId}
                    href={`/exercises/${getExerciseById(r.exerciseId)?.slug ?? ""}`}
                    title={getExerciseById(r.exerciseId)?.nameDe ?? "Übung"}
                    subtitle={`Geschätztes 1RM ${formatWeight(r.before, unit)} → ${formatWeight(r.best, unit)}`}
                    detail={<span className="text-good">+{de(((r.best - r.before) / r.before) * 100)} %</span>}
                  />
                ))}
              </List>
            ) : (
              <Card>
                <p className="text-sm text-muted">Diesmal kein neuer Bestwert – Kraft wächst in Wellen. Konstanz zählt mehr als jeder einzelne Monat.</p>
              </Card>
            )}
          </section>

          {review.topMuscles.length > 0 && (
            <section>
              <SectionLabel>Am meisten trainiert</SectionLabel>
              <List>
                {review.topMuscles.map((m) => (
                  <ListRow key={m.muscle} title={getMuscle(m.muscle).nameDe.replace(/ \(.*\)$/, "")} detail={`${de(m.sets)} ${m.sets === 1 ? "Satz" : "Sätze"}`} />
                ))}
              </List>
            </section>
          )}

          {(review.bodyWeight || review.proteinAverage != null) && (
            <section>
              <SectionLabel>Körper & Ernährung</SectionLabel>
              <List>
                {review.bodyWeight && (
                  <ListRow
                    title="Körpergewicht"
                    detail={`${formatWeight(review.bodyWeight.from, unit)} → ${formatWeight(review.bodyWeight.to, unit)}`}
                  />
                )}
                {review.proteinAverage != null && <ListRow title="Eiweiß im Schnitt" detail={`${de(review.proteinAverage)} g/Tag`} />}
              </List>
            </section>
          )}
        </>
      )}
    </div>
  );
}
