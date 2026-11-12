"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarIcon, ChevronRightIcon } from "@/components/icons";
import { buttonStyles, ButtonLink, Card, PageHeader } from "@/components/ui";
import { VolumeBar } from "@/components/volume-bar";
import { getMuscle } from "@/lib/catalog";
import { getDb } from "@/lib/offline/db";
import { sessionsSince } from "@/lib/offline/history";
import { useSyncStatus } from "@/lib/offline/sync";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { currentWeek, hasSchedule, localDay, missedThisWeek, mondayOf, nextScheduled } from "@/lib/training/schedule";
import { muscleVolume, startOfWeek } from "@/lib/training/volume";
import { useNow } from "@/lib/use-now";
import { mesocyclePosition, type StoredPlan } from "@/stores/plan-store";
import { usePlan, usePlanHydrated } from "@/stores/plan";
import { ActiveWorkoutCard } from "./active-workout-card";
import { AdaptationLog, MesocycleReviewCard, OpenSuggestions } from "./plan-review";
import { CalendarLink, CycleProgress, DayHero, PlanDays, WeekdaySheet, WeekStrip } from "./week";

const shortName = (name: string) => name.replace(/ \(.*\)$/, "");

export function DashboardContent() {
  const hydrated = usePlanHydrated();
  const plan = usePlan((s) => s.plan);

  if (!hydrated) return <Card className="h-48 animate-pulse">{null}</Card>;
  if (!plan) return <NoPlan />;
  return <PlanDashboard plan={plan} />;
}

function NoPlan() {
  const loading = useSyncStatus((s) => s.firstPull === "pending" || s.pulling);
  if (loading) {
    return (
      <>
        <PageHeader title="Dein Plan" subtitle="Muskelaufbau & Optik" />
        <Card className="animate-pulse">
          <p className="text-sm text-muted" role="status">Lade deine Daten …</p>
        </Card>
      </>
    );
  }
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

function PlanDashboard({ plan }: { plan: StoredPlan }) {
  const nowMs = useNow(60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const position = mesocyclePosition(plan, now);
  const monday = mondayOf(now).toISOString();
  const sessions = useLiveQuery(() => sessionsSince(getDb(), monday), [monday], []);
  const scheduled = hasSchedule(plan);
  const input = { plan, sessions, now };
  const week = currentWeek(input);
  const next = nextScheduled(input);
  const missed = missedThisWeek(input);
  const today = localDay(now);
  const [selected, setSelected] = useState<string | null>(null);
  const [editWeekdays, setEditWeekdays] = useState(false);
  // Standard: verpasstes Training dieser Woche (nachholen), sonst heute
  const selectedDay = week.find((d) => d.date === (selected ?? (missed && !week.find((w) => w.today)?.planned ? missed.date : today))) ?? week[0];
  const hour = now.getHours();
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend";

  return (
    <>
      <header className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-muted">
            {now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-[2.125rem] font-bold leading-[1.15]">{greeting}</h1>
          <p className="truncate text-[0.9375rem] text-muted">{plan.name.replace(/ · .*$/, "")}</p>
        </div>
        <Link
          href="/calendar"
          aria-label="Kalender öffnen"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-card"
        >
          <CalendarIcon className="size-5" />
        </Link>
      </header>
      <div className="space-y-4">
        <ActiveWorkoutCard />
        {position.due && <MesocycleReviewCard plan={plan} now={now} />}
        <OpenSuggestions plan={plan} />
        {scheduled ? (
          <>
            <WeekStrip week={week} selected={selectedDay.date} onSelect={setSelected} />
            <DayHero plan={plan} day={selectedDay} next={next} deload={position.deload} />
          </>
        ) : (
          <>
            <Card className="bg-accent-soft">
              <h2 className="font-semibold">Lege deine Trainingstage fest</h2>
              <p className="mt-1 text-sm text-muted">
                Mit festen Wochentagen siehst du deine Woche auf einen Blick, im Kalender und als Erinnerung im Handy-Kalender.
              </p>
              <button type="button" className={`${buttonStyles.primary} mt-3 w-full`} onClick={() => setEditWeekdays(true)}>
                Wochentage wählen
              </button>
            </Card>
            <DayHero
              plan={plan}
              day={{
                ...week.find((d) => d.today)!,
                status: "planned",
                planned: plan.days[plan.nextDayIndex] ?? plan.days[0],
              }}
              next={null}
              deload={position.deload}
            />
          </>
        )}
        <CycleProgress plan={plan} week={position.week} deload={position.deload} />
        <PlanDays plan={plan} onEditWeekdays={() => setEditWeekdays(true)} />
        <WeekVolume
          plan={plan}
          trainings={week.filter((d) => d.status === "done").length}
          planned={week.filter((d) => d.planned || d.status === "done").length}
        />
        <CalendarLink />
        <AdaptationLog plan={plan} />
        {plan.warnings.length > 0 && (
          <details className="rounded-[1.125rem] bg-surface p-4 shadow-card">
            <summary className="cursor-pointer font-semibold">Hinweise zum Plan ({plan.warnings.length})</summary>
            <ul className="mt-2 space-y-2 text-sm text-muted">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        <ButtonLink href="/onboarding" variant="secondary">
          Plan neu erstellen
        </ButtonLink>
      </div>
      {editWeekdays && <WeekdaySheet plan={plan} open={editWeekdays} onClose={() => setEditWeekdays(false)} />}
    </>
  );
}

function WeekVolume({ plan, trainings, planned }: { plan: StoredPlan; trainings: number; planned: number }) {
  const [weekStart] = useState(() => startOfWeek(new Date()).toISOString());
  const sessions = useLiveQuery(() => sessionsSince(getDb(), weekStart), [weekStart], []);
  const done = muscleVolume(sessions.flatMap((s) => s.exercises));
  const [open, setOpen] = useState(false);
  const target = Math.max(planned, plan.days.length, 1);
  return (
    <Card>
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          <span className="block text-lg font-semibold">Diese Woche</span>
          <span className="block text-sm text-muted">
            {trainings} von {target} Trainings · harte Sätze je Muskel
          </span>
        </span>
        <ChevronRightIcon className={`size-5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (trainings / target) * 100)}%` }} />
      </div>
      {open && (
        <>
      <p className="mt-3 text-sm text-muted">Harte Sätze pro Muskel. Strich = geplant, markierter Bereich = Richtwert.</p>
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
        </>
      )}
    </Card>
  );
}

