"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles, ButtonLink, Card } from "@/components/ui";
import { exercises as catalog, getExerciseById, getMuscle, isExerciseAvailable } from "@/lib/catalog";
import { getDb } from "@/lib/offline/db";
import { useSyncStatus } from "@/lib/offline/sync";
import { getCurrentUserId } from "@/lib/supabase/client";
import { muscleVolume } from "@/lib/training/volume";
import { completeWorkout } from "@/lib/workout/complete";
import { startOptions } from "@/lib/workout/start";
import { dayForWeekday, hasSchedule, isoWeekday, weekdayShort } from "@/lib/training/schedule";
import { planStore, usePlan, usePlanHydrated } from "@/stores/plan";
import { deloadPrescription, type StoredPlanExercise } from "@/stores/plan-store";
import { allowsTechnique, prescribe, techniqueFor } from "@/lib/training/plan-generator";
import { SwapSheet } from "./swap-sheet";
import type { StoredPlan } from "@/stores/plan-store";
import { useWorkout, useWorkoutHydrated, workoutStore } from "@/stores/workout";
import type { ActiveSession } from "@/stores/workout-store";
import { useNow } from "@/lib/use-now";
import { ExerciseCard } from "./exercise-card";
import { RestTimer } from "./rest-timer";
import { useCompletion, useRestTimer } from "./ui-state";


function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export function WorkoutScreen() {
  const workoutReady = useWorkoutHydrated();
  const planReady = usePlanHydrated();
  const session = useWorkout((s) => s.session);
  const result = useCompletion((s) => s.result);

  if (!workoutReady || !planReady) return <Card className="h-32 animate-pulse">{null}</Card>;
  if (session) return <ActiveWorkout session={session} />;
  if (result) return <CompletionSummary />;
  return <StartWorkout />;
}

// ─────────────────────────── Start ───────────────────────────

function StartWorkout() {
  const plan = usePlan((s) => s.plan);
  const [starting, setStarting] = useState(false);

  async function start(dayId: string | null) {
    setStarting(true);
    try {
      workoutStore.getState().start({ userId: await getCurrentUserId(), ...startOptions(plan, dayId) });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Training</h1>
      {plan ? (
        <Card>
          <h2 className="text-lg font-semibold">Welcher Tag?</h2>
          <div className="mt-3 space-y-2">
            {plan.days.map((day) => {
              const todays = hasSchedule(plan) ? dayForWeekday(plan, isoWeekday(new Date())) : null;
              const next = todays ? day.id === todays.id : day.dayIndex === plan.nextDayIndex;
              return (
                <button
                  key={day.id}
                  type="button"
                  disabled={starting}
                  onClick={() => start(day.id)}
                  className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-left ${
                    next ? "border-accent bg-accent-soft" : "border-border"
                  }`}
                >
                  <span>
                    <span className="block font-semibold">
                      {day.weekday && <span className="mr-2 text-xs font-bold text-accent">{weekdayShort(day.weekday)}</span>}
                      {day.name}
                    </span>
                    <span className="block text-sm text-muted">
                      {day.exercises.length} Übungen · ca. {day.estimatedMinutes} min
                    </span>
                  </span>
                  {next && <span className="text-xs font-semibold text-accent">{todays ? "Heute" : "Als Nächstes"}</span>}
                </button>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card>
          <h2 className="text-lg font-semibold">Noch kein Plan</h2>
          <p className="mt-1 text-sm text-muted">Mit Plan bekommst du Zielwerte, Gewichtsvorschläge und automatische Steigerungen.</p>
          <div className="mt-3">
            <ButtonLink href="/onboarding">Plan erstellen</ButtonLink>
          </div>
        </Card>
      )}
      <button type="button" className={`${buttonStyles.secondary} w-full`} disabled={starting} onClick={() => start(null)}>
        Freies Training ohne Plan
      </button>
    </div>
  );
}

// ─────────────────────────── Laufendes Training ───────────────────────────

function ActiveWorkout({ session }: { session: ActiveSession }) {
  const plan = usePlan((s) => s.plan);
  const { pending, syncing } = useSyncStatus();
  const now = useNow(1000);
  const [finishOpen, setFinishOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const day = plan && session.planId === plan.id ? plan.days.find((d) => d.id === session.planDayId) ?? null : null;
  const goal = plan?.goal ?? "hypertrophy";
  const experience = plan?.experience ?? "intermediate";

  // Planübungen des Tages + spontan hinzugefügte Übungen
  const items = useMemo(() => {
    const planned = (day?.exercises ?? []).map((pe) => {
      const original = getExerciseById(pe.exerciseId)!;
      const substituteId = session.substitutions?.[pe.id];
      const substitute = substituteId ? getExerciseById(substituteId) : undefined;
      // Heutiger Ersatz: Vorgabe aus den Richtwerten der Ersatzübung, Satzzahl wie geplant, Gewicht neu
      const prescription: StoredPlanExercise = substitute
        ? {
            ...prescribe(substitute, goal, experience, {
              orderIndex: pe.orderIndex,
              sets: pe.sets,
              technique: pe.lastSetTechnique && allowsTechnique(substitute, goal, experience) ? techniqueFor(substitute) : null,
            }),
            id: pe.id,
            targetLoadKg: null,
          }
        : pe;
      return {
        key: pe.id,
        exercise: substitute ?? original,
        original,
        // Deload-Woche: halbe Sätze, RIR 3–4, keine Intensitätstechnik
        planned: session.deload ? deloadPrescription(prescription) : prescription,
        log: session.exercises.find((e) => e.planExerciseId === pe.id) ?? null,
      };
    });
    const extra = session.exercises
      .filter((e) => !e.planExerciseId || !day?.exercises.some((pe) => pe.id === e.planExerciseId))
      .map((e) => ({ key: e.id, exercise: getExerciseById(e.exerciseId)!, original: null, planned: null, log: e }));
    return [...planned, ...extra].filter((i) => i.exercise);
  }, [day, session.exercises, session.deload, session.substitutions, goal, experience]);
  const [swapKey, setSwapKey] = useState<string | null>(null);
  const swapItem = items.find((i) => i.key === swapKey && i.original);

  const firstOpen = items.findIndex((i) => (i.log?.sets.filter((s) => s.setType === "working").length ?? 0) < (i.planned?.sets ?? 3));
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const activeKey = expandedKey ?? items[firstOpen >= 0 ? firstOpen : 0]?.key ?? null;

  const completedSets = session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.isCompleted && s.setType !== "warmup").length, 0);
  const syncLabel = !session.userId ? "Nur lokal" : syncing ? "Synchronisiere …" : (pending ?? 0) > 0 ? `${pending} ausstehend` : "Synchronisiert";

  return (
    <div className="space-y-3 pb-40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{day?.name ?? "Freies Training"}</h1>
          <p className="tabular text-sm text-muted">
            {formatDuration(now - Date.parse(session.startedAt))} · {completedSets} {completedSets === 1 ? "Satz" : "Sätze"} · {syncLabel}
          </p>
        </div>
        <button type="button" className={`${buttonStyles.primary} min-h-11 px-4 text-sm`} onClick={() => setFinishOpen(true)}>
          Beenden
        </button>
      </div>

      {session.deload && (
        <Card className="border-accent bg-accent-soft">
          <p className="text-sm font-semibold">Deload-Woche</p>
          <p className="mt-0.5 text-sm text-muted">
            Etwa halbe Sätze, 3–4 Wiederholungen im Tank, gleiche Übungen. Gewichte bleiben – so baust du Ermüdung ab,
            ohne Kraft zu verlieren. Diese Woche wird nichts gesteigert.
          </p>
        </Card>
      )}

      {items.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Füge eine Übung hinzu, um loszulegen.</p>
        </Card>
      )}

      {items.map((item, index) => {
        const nextOpen = items.slice(index + 1).find((i) => (i.log?.sets.filter((s) => s.setType === "working").length ?? 0) < (i.planned?.sets ?? 3));
        return (
        <ExerciseCard
          key={item.key}
          exercise={item.exercise}
          planned={item.planned}
          log={item.log}
          sessionId={session.id}
          sessionExercises={session.exercises}
          goal={goal}
          experience={experience}
          expanded={activeKey === item.key}
          onToggle={() => setExpandedKey(activeKey === item.key ? "" : item.key)}
          onActivity={() => setExpandedKey(item.key)}
          onNext={nextOpen ? () => setExpandedKey(nextOpen.key) : undefined}
          onSwap={item.original ? () => setSwapKey(item.key) : undefined}
          substitutedFor={item.original && item.original.id !== item.exercise.id ? item.original : null}
        />
        );
      })}

      <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => setAddOpen(true)}>
        + Übung hinzufügen
      </button>

      {swapItem && swapItem.original && (
        <SwapSheet
          key={`${swapItem.key}-${swapItem.exercise.id}`}
          open
          onClose={() => setSwapKey(null)}
          planExerciseId={swapItem.key}
          original={swapItem.original}
          current={swapItem.exercise}
          inSession={new Set(items.filter((i) => i.key !== swapItem.key).map((i) => i.exercise.slug))}
          goal={goal}
          experience={experience}
          equipment={plan?.assessment.equipment ?? []}
          canSwap={(swapItem.log?.sets.length ?? 0) === 0}
        />
      )}

      <RestTimer />
      <AddExerciseSheet open={addOpen} onClose={() => setAddOpen(false)} plan={plan} onAdded={(key) => setExpandedKey(key)} />
      <FinishSheet open={finishOpen} onClose={() => setFinishOpen(false)} session={session} />
    </div>
  );
}

function AddExerciseSheet({
  open,
  onClose,
  plan,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  plan: StoredPlan | null;
  onAdded: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de");
    return catalog
      .filter((e) => !plan || isExerciseAvailable(e, plan.assessment.equipment, "advanced"))
      .filter((e) => q === "" || e.nameDe.toLocaleLowerCase("de").includes(q))
      .slice(0, 40);
  }, [query, plan]);

  return (
    <Sheet open={open} onClose={onClose} title="Übung hinzufügen">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Übung suchen"
        aria-label="Übung suchen"
        className="block min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base outline-none focus:border-accent"
      />
      <ul className="mt-3 divide-y divide-border">
        {options.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
              onClick={() => {
                onAdded(workoutStore.getState().addExercise(e.id));
                setQuery("");
                onClose();
              }}
            >
              <span className="font-medium">{e.nameDe}</span>
              <span className="text-xs text-muted">{getMuscle(e.muscles[0].muscle).nameDe.replace(/ \(.*\)$/, "")}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ─────────────────────────── Abschluss ───────────────────────────

const RPE_OPTIONS = [5, 6, 7, 8, 9, 10];

function FinishSheet({ open, onClose, session }: { open: boolean; onClose: () => void; session: ActiveSession }) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const hasSets = session.exercises.some((e) => e.sets.some((s) => s.isCompleted && s.setType !== "warmup"));
  const volume = muscleVolume(session.exercises);
  const top = [...volume.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);

  async function finish() {
    setSaving(true);
    try {
      useRestTimer.getState().stop();
      const result = await completeWorkout({ db: getDb(), workout: workoutStore, plans: planStore, sessionRpe: rpe });
      useCompletion.getState().setResult(result);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (window.confirm("Training verwerfen? Eingetragene Sätze werden nicht gewertet.")) {
      useRestTimer.getState().stop();
      workoutStore.getState().discard();
      onClose();
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Training beenden">
      {hasSets ? (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">Harte Sätze heute</p>
            <ul className="mt-1 text-sm text-muted">
              {top.map(([m, v]) => (
                <li key={m} className="flex justify-between">
                  <span>{getMuscle(m).nameDe.replace(/ \(.*\)$/, "")}</span>
                  <span className="tabular">{v.total.toLocaleString("de-DE", { maximumFractionDigits: 1 })}</span>
                </li>
              ))}
            </ul>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Wie anstrengend war das Training insgesamt?</legend>
            <p className="text-xs text-muted">Session-RPE: 10 = maximal. Hilft zu erkennen, wann eine leichtere Woche sinnvoll ist.</p>
            <div className="mt-2 grid grid-cols-6 gap-1.5">
              {RPE_OPTIONS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={rpe === v}
                  onClick={() => setRpe(rpe === v ? null : v)}
                  className={`min-h-11 rounded-lg border font-semibold ${rpe === v ? "border-accent bg-accent text-accent-fg" : "border-border"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="button" className={`${buttonStyles.primary} w-full`} onClick={finish} disabled={saving}>
            Speichern & beenden
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">Noch keine Arbeitssätze eingetragen.</p>
      )}
      <button type="button" className={`${buttonStyles.danger} mt-3 w-full`} onClick={discard}>
        Training verwerfen
      </button>
    </Sheet>
  );
}

function CompletionSummary() {
  const result = useCompletion((s) => s.result)!;
  const minutes = Math.round((Date.parse(result.session.endedAt) - Date.parse(result.session.startedAt)) / 60000);
  const sets = result.session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.setType !== "warmup").length, 0);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Stark! Training gespeichert.</h1>
      <Card>
        <p className="tabular">
          <span className="text-2xl font-bold">{minutes}</span> min · <span className="text-2xl font-bold">{sets}</span>{" "}
          {sets === 1 ? "Satz" : "Sätze"} · <span className="text-2xl font-bold">{result.session.exercises.length}</span>{" "}
          {result.session.exercises.length === 1 ? "Übung" : "Übungen"}
        </p>
      </Card>
      <Card>
        <h2 className="font-semibold">Fürs nächste Mal</h2>
        {result.adaptations.length > 0 ? (
          <ul className="mt-2 space-y-2 text-sm">
            {result.adaptations.map((a) => (
              <li key={a.id}>{a.explanation}</li>
            ))}
          </ul>
        ) : result.session.deload ? (
          <p className="mt-1 text-sm text-muted">Deload-Woche – Gewichte bleiben gleich, nach der Woche geht es normal weiter.</p>
        ) : (
          <p className="mt-1 text-sm text-muted">Gewichte bleiben gleich – steigere zuerst die Wiederholungen bis zum oberen Ende des Bereichs.</p>
        )}
      </Card>
      {result.suggestions.length > 0 && (
        <Card className="border-accent">
          <h2 className="font-semibold">{result.suggestions.length === 1 ? "Ein Vorschlag" : `${result.suggestions.length} Vorschläge`} für deinen Plan</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {result.suggestions.map((a) => (
              <li key={a.id}>{a.explanation}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Annehmen oder ablehnen kannst du im Plan.</p>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/dashboard" className={buttonStyles.primary} onClick={() => useCompletion.getState().setResult(null)}>
          Zum Plan
        </Link>
        <button type="button" className={buttonStyles.secondary} onClick={() => useCompletion.getState().setResult(null)}>
          Fertig
        </button>
      </div>
    </div>
  );
}
