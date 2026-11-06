"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonStyles, ButtonLink, Card, PageHeader } from "@/components/ui";
import { VolumeBar } from "@/components/volume-bar";
import { getExerciseById, getMuscle } from "@/lib/catalog";
import { SET_TYPE_LABELS } from "@/lib/labels";
import { getDb } from "@/lib/offline/db";
import { sessionsSince } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { getCurrentUserId } from "@/lib/supabase/client";
import { muscleVolume, startOfWeek } from "@/lib/training/volume";
import { formatWeight } from "@/lib/units";
import { mesocyclePosition, type AdaptationRecord, type StoredPlan, type StoredPlanDay } from "@/stores/plan-store";
import { planStore, usePlan, usePlanHydrated } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { useWorkout, workoutStore } from "@/stores/workout";
import { ActiveWorkoutCard } from "./active-workout-card";

const shortName = (name: string) => name.replace(/ \(.*\)$/, "");

export function DashboardContent() {
  const hydrated = usePlanHydrated();
  const plan = usePlan((s) => s.plan);

  if (!hydrated) return <Card className="h-48 animate-pulse">{null}</Card>;
  if (!plan) return <NoPlan />;
  return <PlanDashboard plan={plan} />;
}

function NoPlan() {
  return (
    <>
      <PageHeader title="Dein Plan" subtitle="Muskelaufbau & Optik" />
      <div className="space-y-4">
        <ActiveWorkoutCard />
        <Card>
          <h2 className="text-lg font-semibold">Noch kein Trainingsplan</h2>
          <p className="mt-1 text-sm text-muted">
            Beantworte ein paar Fragen zu Ziel, Erfahrung, Equipment und Zeit. Daraus entsteht ein Plan nach aktuellen
            sportwissenschaftlichen Richtwerten.
          </p>
          <div className="mt-4">
            <ButtonLink href="/onboarding">Plan erstellen</ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}

function useStartDay() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  async function start(plan: StoredPlan, day: StoredPlanDay) {
    if (workoutStore.getState().session) {
      router.push("/workout");
      return;
    }
    setStarting(true);
    try {
      workoutStore.getState().start({ userId: await getCurrentUserId(), planId: plan.id, planDayId: day.id });
      router.push("/workout");
    } finally {
      setStarting(false);
    }
  }
  return { start, starting };
}

function PlanDashboard({ plan }: { plan: StoredPlan }) {
  const [now] = useState(() => new Date());
  const position = mesocyclePosition(plan, now);
  const next = plan.days[plan.nextDayIndex] ?? plan.days[0];

  return (
    <>
      <PageHeader title="Dein Plan" subtitle={`${plan.name} · Woche ${position.week} von ${plan.mesocycleWeeks}`} />
      <div className="space-y-4">
        <ActiveWorkoutCard />
        <NextWorkout plan={plan} day={next} />
        <WeekVolume plan={plan} />
        <Adaptations plan={plan} />
        <AllDays plan={plan} />
        {plan.warnings.length > 0 && (
          <Card>
            <h2 className="font-semibold">Hinweise zum Plan</h2>
            <ul className="mt-2 space-y-2 text-sm text-muted">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Card>
        )}
        <ButtonLink href="/onboarding" variant="secondary">
          Plan neu erstellen
        </ButtonLink>
      </div>
    </>
  );
}

function NextWorkout({ plan, day }: { plan: StoredPlan; day: StoredPlanDay }) {
  const running = useWorkout((s) => s.session);
  const unit = useSettings((s) => s.unitSystem);
  const { start, starting } = useStartDay();
  if (running) return null;
  return (
    <Card className="border-accent">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Nächstes Training</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold">{day.name}</h2>
        <span className="text-sm text-muted">ca. {day.estimatedMinutes} min</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {day.exercises.map((e) => (
          <li key={e.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{getExerciseById(e.exerciseId)?.nameDe}</span>
            <span className="tabular shrink-0 text-muted">
              {e.sets} × {e.repsMin}–{e.repsMax}
              {e.targetLoadKg != null && ` · ${formatWeight(e.targetLoadKg, unit)}`}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className={`${buttonStyles.primary} mt-4 w-full`} disabled={starting} onClick={() => start(plan, day)}>
        Training starten
      </button>
    </Card>
  );
}

function WeekVolume({ plan }: { plan: StoredPlan }) {
  const [weekStart] = useState(() => startOfWeek(new Date()).toISOString());
  const sessions = useLiveQuery(() => sessionsSince(getDb(), weekStart), [weekStart], []);
  const done = muscleVolume(sessions.flatMap((s) => s.exercises));
  return (
    <Card>
      <h2 className="text-lg font-semibold">Diese Woche</h2>
      <p className="mt-1 text-sm text-muted">
        Harte Sätze pro Muskel ({sessions.length} {sessions.length === 1 ? "Training" : "Trainings"}). Strich = geplant,
        markierter Bereich = Richtwert.
      </p>
      <div className="mt-3 space-y-3">
        {plan.volume.map((v) => (
          <VolumeBar
            key={v.muscle}
            label={shortName(getMuscle(v.muscle).nameDe)}
            value={Math.round((done.get(v.muscle)?.total ?? 0) * 10) / 10}
            target={v.plannedSets}
            min={v.min}
            max={v.max}
            highlight={v.priority}
          />
        ))}
      </div>
    </Card>
  );
}

const STATUS_LABELS: Record<AdaptationRecord["status"], string> = {
  auto_applied: "Automatisch angepasst",
  suggested: "Vorschlag",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  reverted: "Rückgängig gemacht",
};

function Adaptations({ plan }: { plan: StoredPlan }) {
  const adaptations = usePlan((s) => s.adaptations);
  if (adaptations.length === 0) return null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">Anpassungen</h2>
      <ul className="mt-2 divide-y divide-border">
        {adaptations.slice(0, 6).map((a) => {
          const exercise = a.planExerciseId ? plan.days.flatMap((d) => d.exercises).find((e) => e.id === a.planExerciseId) : null;
          return (
            <li key={a.id} className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{STATUS_LABELS[a.status]}</p>
              {exercise && <p className="font-semibold">{getExerciseById(exercise.exerciseId)?.nameDe}</p>}
              <p className="text-sm text-muted">{a.explanation}</p>
              {a.status === "auto_applied" && (
                <button type="button" className="mt-1 min-h-10 text-sm font-medium text-accent" onClick={() => planStore.getState().revertAdaptation(a.id)}>
                  Rückgängig
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AllDays({ plan }: { plan: StoredPlan }) {
  const unit = useSettings((s) => s.unitSystem);
  const { start, starting } = useStartDay();
  return (
    <Card className="p-0">
      <h2 className="px-4 pt-4 text-lg font-semibold">Alle Trainingstage</h2>
      <div className="mt-2 divide-y divide-border">
        {plan.days.map((day) => (
          <details key={day.id} className="group px-4 py-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
              <span className="font-medium">
                {day.name}
                {day.dayIndex === plan.nextDayIndex && <span className="ml-2 text-xs text-accent">als Nächstes</span>}
              </span>
              <span className="text-sm text-muted">
                {day.exercises.length} Übungen <span className="inline-block transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <ul className="mt-2 space-y-2 text-sm">
              {day.exercises.map((e) => {
                const exercise = getExerciseById(e.exerciseId);
                return (
                  <li key={e.id}>
                    <Link href={`/exercises/${e.exerciseSlug}`} className="font-medium underline-offset-2 hover:underline">
                      {exercise?.nameDe}
                    </Link>
                    <p className="tabular text-muted">
                      {e.sets} × {e.repsMin}–{e.repsMax} Wdh. · RIR {e.rirMin}–{e.rirMax} · {e.restSeconds} s Pause
                      {e.targetLoadKg != null && ` · ${formatWeight(e.targetLoadKg, unit)}`}
                      {e.lastSetTechnique && ` · + ${SET_TYPE_LABELS[e.lastSetTechnique]}`}
                    </p>
                  </li>
                );
              })}
            </ul>
            <button type="button" className={`${buttonStyles.secondary} mt-3 w-full`} disabled={starting} onClick={() => start(plan, day)}>
              Diesen Tag starten
            </button>
          </details>
        ))}
      </div>
    </Card>
  );
}
