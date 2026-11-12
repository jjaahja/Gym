"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarIcon, CheckIcon, ChevronRightIcon, ClockIcon, MoonIcon, PencilIcon, PlayIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Card } from "@/components/ui";
import { WeekdayPicker } from "@/components/weekday-picker";
import { getExerciseById, getMuscle } from "@/lib/catalog";
import { SET_TYPE_LABELS } from "@/lib/labels";
import type { CompletedSession } from "@/lib/offline/db";
import { getCurrentUserId } from "@/lib/supabase/client";
import {
  addDays,
  dayFocus,
  parseDay,
  recoveryWarnings,
  relativeDayLabel,
  weekdayShort,
  type CalendarDay,
  type NextWorkout,
  type Weekday,
} from "@/lib/training/schedule";
import { formatWeight } from "@/lib/units";
import { startOptions } from "@/lib/workout/start";
import { deloadPrescription, type StoredPlan, type StoredPlanDay } from "@/stores/plan-store";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { useWorkout, workoutStore } from "@/stores/workout";

// Bausteine der Plan-Übersicht: Wochenleiste, Tageskarte, Trainingstage, Wochentage ändern.

export const shortMuscle = (slug: Parameters<typeof getMuscle>[0]) => getMuscle(slug).nameDe.replace(/ \(.*\)$/, "");

export function useStartDay() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  async function start(plan: StoredPlan, day: StoredPlanDay) {
    if (workoutStore.getState().session) {
      router.push("/workout");
      return;
    }
    setStarting(true);
    try {
      workoutStore.getState().start({ userId: await getCurrentUserId(), ...startOptions(plan, day.id) });
      router.push("/workout");
    } finally {
      setStarting(false);
    }
  }
  return { start, starting };
}

export function MuscleChips({ muscles, max = 4, tone = "neutral" }: { muscles: readonly Parameters<typeof getMuscle>[0][]; max?: number; tone?: "neutral" | "onAccent" }) {
  const cls = tone === "onAccent" ? "bg-white/20 text-current" : "bg-surface-2 text-fg";
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Hauptmuskeln">
      {muscles.slice(0, max).map((m) => (
        <li key={m} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
          {shortMuscle(m)}
        </li>
      ))}
      {muscles.length > max && <li className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>+{muscles.length - max}</li>}
    </ul>
  );
}

// ─────────────────────────── Wochenleiste ───────────────────────────

const STATUS_LABEL: Record<CalendarDay["status"], string> = {
  done: "erledigt",
  planned: "geplant",
  missed: "verpasst",
  rest: "Ruhetag",
};

export function WeekStrip({
  week,
  selected,
  onSelect,
}: {
  week: readonly CalendarDay[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1" role="tablist" aria-label="Diese Woche">
      {week.map((d) => {
        const isSelected = d.date === selected;
        const circle =
          d.status === "done"
            ? "bg-accent text-accent-fg"
            : d.status === "planned"
              ? "border-2 border-accent text-fg"
              : d.status === "missed"
                ? "border-2 border-dashed border-muted/60 text-muted"
                : "text-muted";
        return (
          <button
            key={d.date}
            type="button"
            role="tab"
            aria-selected={isSelected}
            aria-label={`${parseDay(d.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}: ${STATUS_LABEL[d.status]}${d.planned ? `, ${d.planned.name}` : ""}`}
            onClick={() => onSelect(d.date)}
            className={`flex flex-col items-center gap-1 rounded-2xl py-2 transition-colors ${isSelected ? "bg-surface-2" : ""}`}
          >
            <span className={`text-[11px] font-medium ${d.today ? "text-accent" : "text-muted"}`}>{weekdayShort(d.weekday)}</span>
            <span className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular ${circle}`}>
              {d.status === "done" ? <CheckIcon className="size-4" /> : parseDay(d.date).getDate()}
            </span>
            <span aria-hidden="true" className={`h-1 w-4 rounded-full ${d.today ? "bg-accent" : "bg-transparent"}`} />
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Tageskarte ───────────────────────────

function sessionStats(sessions: readonly CompletedSession[]) {
  const minutes = sessions.reduce((n, s) => n + (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000, 0);
  const sets = sessions.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => x.setType !== "warmup").length, 0), 0);
  const exercises = sessions.reduce((n, s) => n + s.exercises.length, 0);
  return { minutes: Math.round(minutes), sets, exercises };
}

function ExercisePreview({ day, deload, limit = 5 }: { day: StoredPlanDay; deload: boolean; limit?: number }) {
  const unit = useSettings((s) => s.unitSystem);
  const exercises = day.exercises.map((e) => (deload ? deloadPrescription(e) : e));
  return (
    <ol className="space-y-2">
      {exercises.slice(0, limit).map((e, i) => (
        <li key={e.id} className="flex items-center gap-3 text-sm">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-bold dark:bg-white/15">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{getExerciseById(e.exerciseId)?.nameDe}</span>
          <span className="tabular shrink-0 opacity-80">
            {e.sets} × {e.repsMin}–{e.repsMax}
            {e.targetLoadKg != null && ` · ${formatWeight(e.targetLoadKg, unit)}`}
          </span>
        </li>
      ))}
      {exercises.length > limit && <li className="pl-9 text-sm opacity-80">+ {exercises.length - limit} weitere</li>}
    </ol>
  );
}

export function DayHero({
  plan,
  day,
  next,
  deload,
}: {
  plan: StoredPlan;
  day: CalendarDay;
  next: NextWorkout | null;
  deload: boolean;
}) {
  const running = useWorkout((s) => s.session);
  const { start, starting } = useStartDay();
  const now = new Date();
  const label = relativeDayLabel(day.date, now);
  const dateText = parseDay(day.date).toLocaleDateString("de-DE", { day: "numeric", month: "long" });

  if (day.status === "done") {
    const stats = sessionStats(day.sessions);
    const names = day.sessions.map((s) => plan.days.find((d) => d.id === s.planDayId)?.name ?? "Freies Training");
    return (
      <Card className="rounded-3xl">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-good">
          <CheckIcon className="size-4" /> {label} · erledigt
        </p>
        <h2 className="mt-1 text-2xl font-bold">{names.join(" + ")}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Minuten", stats.minutes],
            ["Sätze", stats.sets],
            ["Übungen", stats.exercises],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-surface-2 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {next && (
          <p className="mt-3 text-sm text-muted">
            Nächstes Training: <span className="font-medium text-fg">{relativeDayLabel(next.date, now)} · {next.day.name}</span>
          </p>
        )}
        <Link href="/progress" className="mt-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-accent">
          Verlauf ansehen <ChevronRightIcon className="size-4" />
        </Link>
      </Card>
    );
  }

  if (day.status === "rest" || !day.planned) {
    return (
      <Card className="rounded-3xl">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <MoonIcon className="size-4" /> {label} · Ruhetag
        </p>
        <h2 className="mt-1 text-2xl font-bold">Erholung</h2>
        <p className="mt-1 text-sm text-muted">Muskeln wachsen in der Pause – Schlaf und genug Eiweiß zählen heute mehr als Sätze.</p>
        {next && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-3">
            <p className="text-xs text-muted">Nächstes Training</p>
            <p className="font-semibold">
              {relativeDayLabel(next.date, now)} · {next.day.name}
            </p>
            <MuscleChips muscles={dayFocus(next.day)} max={3} />
            {!running && (
              <button
                type="button"
                className="mt-3 min-h-10 text-sm font-medium text-accent"
                disabled={starting}
                onClick={() => start(plan, next.day)}
              >
                Trotzdem heute trainieren
              </button>
            )}
          </div>
        )}
      </Card>
    );
  }

  // geplant oder verpasst
  const planned = day.planned;
  const isToday = day.today;
  const missed = day.status === "missed";
  const focus = dayFocus(planned);
  const hero = isToday || missed;
  return (
    <section
      className={`rounded-3xl p-5 ${
        hero ? "bg-gradient-to-br from-accent to-[color-mix(in_oklab,var(--accent),#000_22%)] text-accent-fg shadow-lg shadow-accent/20" : "bg-surface shadow-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`text-xs font-semibold uppercase tracking-wide ${hero ? "opacity-90" : "text-accent"}`}>
          {missed ? `Verpasst · ${label}` : isToday ? `Heute · ${dateText}` : `${label} · ${dateText}`}
        </p>
        {deload && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${hero ? "bg-white/20" : "bg-accent-soft text-accent"}`}>Deload</span>}
      </div>
      <h2 className="mt-1 text-3xl font-bold tracking-tight">{planned.name}</h2>
      <p className={`mt-1 flex items-center gap-1.5 text-sm ${hero ? "opacity-90" : "text-muted"}`}>
        <ClockIcon className="size-4" /> ca. {planned.estimatedMinutes} min · {planned.exercises.length} Übungen
      </p>
      <div className="mt-3">
        <MuscleChips muscles={focus} tone={hero ? "onAccent" : "neutral"} />
      </div>
      <div className={`mt-4 rounded-2xl p-3 ${hero ? "bg-black/10" : "bg-surface-2"}`}>
        <ExercisePreview day={planned} deload={deload} />
      </div>
      {running ? (
        <Link href="/workout" className={`${hero ? "bg-surface text-fg" : buttonStyles.primary} mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold`}>
          Laufendes Training öffnen
        </Link>
      ) : (
        <button
          type="button"
          disabled={starting}
          onClick={() => start(plan, planned)}
          className={`mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold transition-opacity active:opacity-80 disabled:opacity-50 ${
            hero ? "bg-surface text-fg shadow-sm" : "bg-accent text-accent-fg"
          }`}
        >
          <PlayIcon className="size-5" />
          {missed ? "Jetzt nachholen" : isToday ? "Training starten" : "Vorziehen und jetzt starten"}
        </button>
      )}
    </section>
  );
}

// ─────────────────────────── Mesozyklus ───────────────────────────

export function CycleProgress({ plan, week, deload }: { plan: StoredPlan; week: number; deload: boolean }) {
  const end = addDays(new Date(plan.cycleStartedAt), plan.mesocycleWeeks * 7);
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Mesozyklus {plan.completedMesocycles + 1}</h2>
        <span className="text-sm text-muted">{deload ? "Deload-Woche" : `Woche ${week} von ${plan.mesocycleWeeks}`}</span>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: plan.mesocycleWeeks }, (_, i) => (
          <span key={i} className={`h-2 flex-1 rounded-full ${i < week - 1 ? "bg-accent" : i === week - 1 ? "bg-accent/50" : "bg-surface-2"}`} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Gleiches Volumen über {plan.mesocycleWeeks} Wochen, damit Fortschritt messbar ist. Auswertung am{" "}
        {end.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" })}.
      </p>
    </Card>
  );
}

// ─────────────────────────── Trainingstage ───────────────────────────

export function PlanDays({ plan, onEditWeekdays }: { plan: StoredPlan; onEditWeekdays: () => void }) {
  const unit = useSettings((s) => s.unitSystem);
  const { start, starting } = useStartDay();
  const [open, setOpen] = useState<string | null>(null);
  const days = [...plan.days].sort((a, b) => (a.weekday ?? 8 + a.dayIndex) - (b.weekday ?? 8 + b.dayIndex));
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-lg font-semibold">Deine Trainingstage</h2>
        <button type="button" onClick={onEditWeekdays} className="min-h-10 text-sm font-medium text-accent">
          Wochentage ändern
        </button>
      </div>
      <ul className="space-y-2">
        {days.map((day) => {
          const expanded = open === day.id;
          return (
            <li key={day.id} className="overflow-hidden rounded-[1.125rem] bg-surface shadow-card">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : day.id)}
                className="flex w-full items-center gap-3 p-3 text-left"
              >
                <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <span className="text-sm font-bold">{day.weekday ? weekdayShort(day.weekday) : "–"}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{day.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {day.exercises.length} Übungen · ca. {day.estimatedMinutes} min · {dayFocus(day).slice(0, 3).map(shortMuscle).join(", ")}
                  </span>
                </span>
                <ChevronRightIcon className={`size-5 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
              {expanded && (
                <div className="border-t border-border px-3 pb-3">
                  <ul className="divide-y divide-border">
                    {day.exercises.map((e) => (
                      <li key={e.id} className="py-2.5">
                        <Link href={`/exercises/${e.exerciseSlug}`} className="font-medium underline-offset-2 hover:underline">
                          {getExerciseById(e.exerciseId)?.nameDe}
                        </Link>
                        <p className="tabular text-xs text-muted">
                          {e.sets} × {e.repsMin}–{e.repsMax} Wdh. · RIR {e.rirMin}–{e.rirMax} · {e.restSeconds} s Pause
                          {e.targetLoadKg != null && ` · ${formatWeight(e.targetLoadKg, unit)}`}
                          {e.lastSetTechnique && ` · + ${SET_TYPE_LABELS[e.lastSetTechnique]}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Link href={`/plan/${day.id}`} className={buttonStyles.secondary}>
                      <PencilIcon className="size-5" /> Bearbeiten
                    </Link>
                    <button type="button" className={buttonStyles.secondary} disabled={starting} onClick={() => start(plan, day)}>
                      <PlayIcon className="size-5" /> Starten
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CalendarLink() {
  return (
    <Link href="/calendar" className="flex items-center gap-3 rounded-[1.125rem] bg-surface p-3 shadow-card">
      <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-accent">
        <CalendarIcon className="size-5" />
      </span>
      <span className="flex-1">
        <span className="block font-semibold">Kalender</span>
        <span className="block text-xs text-muted">Monatsübersicht, Deload und Auswertung – auch für deinen Handy-Kalender</span>
      </span>
      <ChevronRightIcon className="size-5 text-muted" />
    </Link>
  );
}

// ─────────────────────────── Wochentage ändern ───────────────────────────

export function WeekdaySheet({ plan, open, onClose }: { plan: StoredPlan; open: boolean; onClose: () => void }) {
  const initial = plan.days.map((d) => d.weekday).filter((w): w is Weekday => w != null);
  const [value, setValue] = useState<Weekday[]>(initial.length === plan.days.length ? [...initial].sort((a, b) => a - b) : []);
  const ordered = [...plan.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const preview = ordered.map((d, i) => ({ ...d, weekday: value[i] ?? null }));
  const complete = value.length === plan.days.length;
  const warnings = complete ? recoveryWarnings(preview) : [];

  function save() {
    planStore.getState().setWeekdays(Object.fromEntries(ordered.map((d, i) => [d.id, value[i]])));
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Wochentage">
      <div className="space-y-4">
        <WeekdayPicker value={value} count={plan.days.length} onChange={setValue} label="An welchen Tagen trainierst du?" />
        {complete && (
          <ul className="space-y-1.5 text-sm">
            {preview.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="w-8 rounded-md bg-accent-soft py-0.5 text-center text-xs font-bold text-accent">{weekdayShort(d.weekday!)}</span>
                {d.name}
              </li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <div className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="status">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">Die Reihenfolge der Tage bleibt gleich, nur die Wochentage ändern sich.</p>
        <button type="button" className={`${buttonStyles.primary} w-full`} disabled={!complete} onClick={save}>
          Speichern
        </button>
      </div>
    </Sheet>
  );
}
