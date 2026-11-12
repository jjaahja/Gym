"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarIcon, ChevronRightIcon } from "@/components/icons";
import { buttonStyles, ButtonLink, Card, PageHeader, Stepper, Toggle } from "@/components/ui";
import { VolumeBar } from "@/components/volume-bar";
import { getMuscle } from "@/lib/catalog";
import { getDb } from "@/lib/offline/db";
import { allSessions, sessionsSince } from "@/lib/offline/history";
import { monthLabel, reviewDue, weeklyStreak } from "@/lib/motivation";
import { useSettings } from "@/stores/settings";
import { Sheet } from "@/components/sheet";
import { useSyncStatus } from "@/lib/offline/sync";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { currentWeek, hasSchedule, localDay, missedThisWeek, mondayOf, nextScheduled } from "@/lib/training/schedule";
import { muscleVolume, startOfWeek } from "@/lib/training/volume";
import { useNow } from "@/lib/use-now";
import { mesocyclePosition, type StoredPlan } from "@/stores/plan-store";
import { usePlan, usePlanHydrated } from "@/stores/plan";
import { ActiveWorkoutCard } from "./active-workout-card";
import { ProteinCard, RecoveryCard } from "./daily-cards";
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
        <MonthReviewTeaser now={now} />
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
        <RecoveryCard today={today} />
        <ProteinCard today={today} />
        <CycleProgress plan={plan} week={position.week} deload={position.deload} />
        <PlanDays plan={plan} onEditWeekdays={() => setEditWeekdays(true)} />
        <WeekVolume plan={plan} now={now} />
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

function WeekVolume({ plan, now }: { plan: StoredPlan; now: Date }) {
  const [weekStart] = useState(() => startOfWeek(new Date()).toISOString());
  const sessions = useLiveQuery(() => sessionsSince(getDb(), weekStart), [weekStart], []);
  const all = useLiveQuery(() => allSessions(getDb()), [], []);
  const done = muscleVolume(sessions.flatMap((s) => s.exercises));
  const [open, setOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const weeklyGoal = useSettings((s) => s.weeklyGoal);
  const streak = weeklyStreak(all, weeklyGoal ?? plan.days.length, now);
  return (
    <Card>
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => setGoalOpen(true)} aria-label={`Wochenziel: ${streak.thisWeek} von ${streak.goal} Trainings – ändern`}>
          <GoalRing value={streak.thisWeek} goal={streak.goal} />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="min-w-0">
            <span className="block text-lg font-semibold">Diese Woche</span>
            <span className="block text-sm text-muted">
              {streak.reachedThisWeek ? "Wochenziel erreicht" : `${streak.thisWeek} von ${streak.goal} Trainings`}
            </span>
            <span className="block text-sm">
              {streak.streak > 0 ? (
                <span className="font-semibold text-accent">
                  {streak.streak} {streak.streak === 1 ? "Woche" : "Wochen"} in Folge
                </span>
              ) : (
                <span className="text-muted">Serie startet mit dem ersten erreichten Wochenziel</span>
              )}
              {streak.best > streak.streak && <span className="text-muted"> · Rekord {streak.best}</span>}
            </span>
          </span>
          <ChevronRightIcon className={`size-5 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      {goalOpen && <GoalSheet planDays={plan.days.length} onClose={() => setGoalOpen(false)} />}
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


/** Ring wie die Aktivitätsringe: Trainings dieser Woche gegen das Wochenziel. */
function GoalRing({ value, goal }: { value: number; goal: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, value / goal);
  return (
    <svg viewBox="0 0 60 60" className="size-[3.75rem] shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="30" cy="30" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        className="transition-[stroke-dashoffset] duration-500"
      />
      <text x="30" y="30" transform="rotate(90 30 30)" textAnchor="middle" dominantBaseline="central" className="fill-fg text-[15px] font-bold tabular">
        {value}/{goal}
      </text>
    </svg>
  );
}

function GoalSheet({ planDays, onClose }: { planDays: number; onClose: () => void }) {
  const { weeklyGoal, setWeeklyGoal } = useSettings();
  const auto = weeklyGoal == null;
  return (
    <Sheet open onClose={onClose} title="Wochenziel">
      <div className="space-y-4">
        <div className="divide-y divide-border rounded-[1.125rem] bg-surface px-4 shadow-card">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-[1.0625rem]">Wie im Plan ({planDays})</span>
            <Toggle label="Wochenziel wie im Plan" checked={auto} onChange={(v) => setWeeklyGoal(v ? null : planDays)} />
          </div>
          {!auto && <Stepper label="Trainings pro Woche" value={weeklyGoal} min={1} max={7} onChange={setWeeklyGoal} />}
        </div>
        <p className="px-1 text-[0.8125rem] text-muted">
          Die Serie zählt Wochen in Folge, in denen du dein Ziel erreichst. Die laufende Woche beendet sie nicht – du hast bis
          Sonntag Zeit.
        </p>
      </div>
    </Sheet>
  );
}

/** In der ersten Woche eines Monats: Rückblick auf den Vormonat. */
function MonthReviewTeaser({ now }: { now: Date }) {
  const all = useLiveQuery(() => allSessions(getDb()), [], []);
  const month = reviewDue(all, now);
  if (!month) return null;
  return (
    <Link href="/progress/review" className="flex items-center gap-3 rounded-[1.125rem] bg-accent-soft p-4">
      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-semibold uppercase tracking-wide text-accent">Monatsrückblick</span>
        <span className="block text-lg font-semibold">Dein {monthLabel(month).split(" ")[0]} auf einen Blick</span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-accent" />
    </Link>
  );
}
