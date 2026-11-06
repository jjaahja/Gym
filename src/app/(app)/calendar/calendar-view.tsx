"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles, ButtonLink, Card } from "@/components/ui";
import { buildIcs, scheduleFromPlan } from "@/lib/calendar-export";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { SubscriptionSheet } from "./subscription-sheet";
import { getExerciseById } from "@/lib/catalog";
import { getDb, type CompletedSession } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { calendarMonth, dayFocus, hasSchedule, localDay, parseDay, WEEKDAY_SHORT, type CalendarDay } from "@/lib/training/schedule";
import { useNow } from "@/lib/use-now";
import type { StoredPlan } from "@/stores/plan-store";
import { usePlan, usePlanHydrated } from "@/stores/plan";
import { MuscleChips, useStartDay } from "../dashboard/week";

const MONTH = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });

export function CalendarView() {
  const hydrated = usePlanHydrated();
  // Zeitabhängiges erst im Browser (beim Vorrendern gibt es kein „jetzt“)
  if (!hydrated) return <Card className="h-80 animate-pulse">{null}</Card>;
  return <Calendar />;
}

function Calendar() {
  const plan = usePlan((s) => s.plan);
  const nowMs = useNow(60_000);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const sessions = useLiveQuery<CompletedSession[] | null>(() => allSessions(getDb()), [], null);
  const [cursor, setCursor] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [selected, setSelected] = useState(() => localDay(now));
  const [exportOpen, setExportOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  if (sessions == null) return <Card className="h-80 animate-pulse">{null}</Card>;

  const days = calendarMonth({ plan, sessions, now }, cursor.year, cursor.month);
  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const selectedDay = days.find((d) => d.date === selected) ?? null;
  const trainedThisMonth = days.filter((d) => d.inMonth && d.status === "done").length;
  const plannedThisMonth = days.filter((d) => d.inMonth && (d.status === "planned" || d.status === "done" || d.status === "missed")).length;

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl p-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <button type="button" onClick={() => shift(-1)} aria-label="Vorheriger Monat" className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
            <ChevronLeftIcon className="size-5" />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-semibold" aria-live="polite">{MONTH.format(new Date(cursor.year, cursor.month, 1))}</h2>
            <p className="text-xs text-muted">
              {trainedThisMonth} {trainedThisMonth === 1 ? "Training" : "Trainings"}
              {plannedThisMonth > 0 && ` von ${plannedThisMonth} geplanten`}
            </p>
          </div>
          <button type="button" onClick={() => shift(1)} aria-label="Nächster Monat" className="flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
            <ChevronRightIcon className="size-5" />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-medium text-muted" aria-hidden="true">
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} className="py-1">{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1" role="grid" aria-label="Trainingskalender">
          {days.map((d) => (
            <CalendarCell key={d.date} day={d} selected={d.date === selected} onSelect={() => setSelected(d.date)} />
          ))}
        </div>
        <Legend />
        {localDay(now).slice(0, 7) !== `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}` && (
          <button
            type="button"
            className="mt-2 w-full min-h-10 text-sm font-medium text-accent"
            onClick={() => {
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setSelected(localDay(now));
            }}
          >
            Zu heute
          </button>
        )}
      </Card>

      {selectedDay && plan && <DayDetails plan={plan} day={selectedDay} />}

      {plan && hasSchedule(plan) ? (
        <Card>
          <h2 className="font-semibold">In deinen Handy-Kalender</h2>
          <p className="mt-1 text-sm text-muted">
            Trainingstage als Termine mit Erinnerung – für Apple Kalender, Google Kalender oder Outlook.
          </p>
          {isSupabaseConfigured && (
            <button type="button" className={`${buttonStyles.primary} mt-3 w-full`} onClick={() => setSubscribeOpen(true)}>
              Abonnieren – bleibt automatisch aktuell
            </button>
          )}
          <button type="button" className={`${buttonStyles.secondary} mt-2 w-full`} onClick={() => setExportOpen(true)}>
            Einmalig exportieren
          </button>
        </Card>
      ) : plan ? (
        <Card>
          <p className="text-sm text-muted">Lege in der Plan-Übersicht feste Wochentage fest, dann erscheinen geplante Trainings hier.</p>
          <div className="mt-3">
            <ButtonLink href="/dashboard" variant="secondary">Zur Plan-Übersicht</ButtonLink>
          </div>
        </Card>
      ) : null}

      {plan && exportOpen && <ExportSheet plan={plan} open={exportOpen} onClose={() => setExportOpen(false)} />}
      {subscribeOpen && <SubscriptionSheet open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />}
    </div>
  );
}

function CalendarCell({ day, selected, onSelect }: { day: CalendarDay; selected: boolean; onSelect: () => void }) {
  const ring =
    day.status === "done"
      ? "bg-accent text-accent-fg"
      : day.status === "planned"
        ? "border-2 border-accent"
        : day.status === "missed"
          ? "border-2 border-dashed border-muted/60 text-muted"
          : day.inMonth
            ? ""
            : "text-muted/50";
  const label = parseDay(day.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const status = { done: "Training erledigt", planned: "Training geplant", missed: "verpasst", rest: "Ruhetag" }[day.status];
  return (
    <div role="gridcell" className={`flex justify-center ${day.deload ? "bg-accent-soft" : ""} ${day.weekday === 1 && day.deload ? "rounded-l-full" : ""} ${day.weekday === 7 && day.deload ? "rounded-r-full" : ""}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${label}: ${status}${day.planned ? ` (${day.planned.name})` : ""}${day.deload ? ", Deload-Woche" : ""}${day.mesocycleEnd ? ", Mesozyklus-Auswertung" : ""}`}
        className={`relative flex size-10 items-center justify-center rounded-full text-sm tabular ${ring} ${selected ? "outline outline-2 outline-offset-2 outline-fg" : ""} ${day.today && day.status !== "done" ? "font-bold text-accent" : ""} ${!day.inMonth ? "opacity-60" : ""}`}
      >
        {day.status === "done" ? <CheckIcon className="size-4" /> : parseDay(day.date).getDate()}
        {day.mesocycleEnd && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-good" />}
      </button>
    </div>
  );
}

function Legend() {
  const items = [
    [<span key="d" className="flex size-4 items-center justify-center rounded-full bg-accent text-accent-fg"><CheckIcon className="size-2.5" /></span>, "erledigt"],
    [<span key="p" className="size-4 rounded-full border-2 border-accent" />, "geplant"],
    [<span key="m" className="size-4 rounded-full border-2 border-dashed border-muted/60" />, "verpasst"],
    [<span key="l" className="h-3 w-5 rounded-full bg-accent-soft" />, "Deload"],
    [<span key="e" className="size-2.5 rounded-full bg-good" />, "Auswertung"],
  ] as const;
  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted">
      {items.map(([icon, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          {icon}
          {text}
        </li>
      ))}
    </ul>
  );
}

function DayDetails({ plan, day }: { plan: StoredPlan; day: CalendarDay }) {
  const { start, starting } = useStartDay();
  const title = parseDay(day.date).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {day.deload && <p className="mt-1 text-sm font-medium text-accent">Deload-Woche: halbe Sätze, RIR 3–4</p>}
      {day.mesocycleEnd && <p className="mt-1 text-sm font-medium text-good">Mesozyklus endet – Auswertung im Plan</p>}

      {day.sessions.map((s) => {
        const name = plan.days.find((d) => d.id === s.planDayId)?.name ?? "Freies Training";
        const minutes = Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000);
        const sets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => x.setType !== "warmup").length, 0);
        return (
          <div key={s.id} className="mt-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <CheckIcon className="size-5 text-good" /> {name}
            </h2>
            <p className="text-sm text-muted">
              {minutes} min · {sets} Sätze · {s.exercises.length} Übungen{s.deload ? " · Deload" : ""}
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {s.exercises.map((e) => {
                const top = e.sets.filter((x) => x.setType !== "warmup");
                return (
                  <li key={e.logId} className="flex justify-between gap-3">
                    <span className="truncate">{getExerciseById(e.exerciseId)?.nameDe}</span>
                    <span className="tabular shrink-0 text-muted">{top.length} Sätze</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {day.sessions.length === 0 && day.planned && (
        <div className="mt-2">
          <h2 className="text-lg font-semibold">{day.planned.name}</h2>
          <p className="text-sm text-muted">
            {day.status === "missed" ? "Nicht trainiert" : "Geplant"} · {day.planned.exercises.length} Übungen · ca. {day.planned.estimatedMinutes} min
          </p>
          <div className="mt-2">
            <MuscleChips muscles={dayFocus(day.planned)} />
          </div>
          {(day.today || day.status === "missed") && (
            <button type="button" className={`${buttonStyles.primary} mt-3 w-full`} disabled={starting} onClick={() => start(plan, day.planned!)}>
              {day.status === "missed" ? "Jetzt nachholen" : "Training starten"}
            </button>
          )}
        </div>
      )}

      {day.sessions.length === 0 && !day.planned && <p className="mt-2 text-sm text-muted">Ruhetag – keine Einheit geplant.</p>}
      <Link href="/progress" className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-accent">
        Fortschritt ansehen <ChevronRightIcon className="size-4" />
      </Link>
    </Card>
  );
}

function ExportSheet({ plan, open, onClose }: { plan: StoredPlan; open: boolean; onClose: () => void }) {
  const [time, setTime] = useState("18:00");
  const [reminder, setReminder] = useState(30);

  function download() {
    const ics = buildIcs(scheduleFromPlan(plan), { time, reminderMinutes: reminder, now: new Date(), appUrl: window.location.origin });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "trainingsplan.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Termine exportieren">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Uhrzeit</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value || "18:00")}
            className="block min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-base"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Erinnerung</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 15, 30, 60].map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={reminder === m}
                onClick={() => setReminder(m)}
                className={`min-h-11 rounded-lg border text-sm font-medium ${reminder === m ? "border-accent bg-accent text-accent-fg" : "border-border"}`}
              >
                {m === 0 ? "keine" : m === 60 ? "1 h" : `${m} min`}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted">
          Die Datei öffnet sich in deiner Kalender-App. Nach einer Änderung der Wochentage erneut exportieren – vorhandene
          Termine werden in Apple Kalender aktualisiert; in Google Kalender vorher die alten löschen.
        </p>
        <button type="button" className={`${buttonStyles.primary} w-full`} onClick={download}>
          Kalenderdatei laden
        </button>
      </div>
    </Sheet>
  );
}
