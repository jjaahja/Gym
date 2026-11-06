"use client";

import { SwapIcon } from "@/components/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui";
import { getMuscle, primaryMuscles, type Exercise } from "@/lib/catalog";
import type { EffortScale, ExperienceLevel, SetType, TrainingGoal, UnitSystem } from "@/lib/db/enums";
import { SET_TYPE_LABELS } from "@/lib/labels";
import { getDb } from "@/lib/offline/db";
import { lastPerformance } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { formatGuidelineMessage, resolveExerciseGuidelines, resolveMuscleGuidelines } from "@/lib/science";
import { formatEffort, rirToRpe } from "@/lib/training/effort";
import { suggestNextSet } from "@/lib/training/progression";
import { muscleVolume, TECHNIQUE_SET_TYPES } from "@/lib/training/volume";
import { formatWeight, fromDisplayWeight, kgToLb, toDisplayWeight, weightUnitLabel } from "@/lib/units";
import type { StoredPlanExercise } from "@/stores/plan-store";
import { useSettings } from "@/stores/settings";
import { workoutStore } from "@/stores/workout";
import type { LoggedExercise, LoggedSet } from "@/stores/workout-store";
import { useRestTimer } from "./ui-state";

const RIR_OPTIONS = [0, 1, 2, 3, 4, 5];

interface Prescription {
  sets: number;
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  restSeconds: number;
  technique: SetType | null;
}

const formatInput = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 2, useGrouping: false });

function parseNumber(value: string): number | null {
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function displayIncrement(kg: number, unit: UnitSystem): number {
  return unit === "imperial" ? Math.max(2.5, Math.round(kgToLb(kg) / 2.5) * 2.5) : kg;
}

function describeSet(s: Pick<LoggedSet, "weightKg" | "reps" | "durationSeconds" | "rir">, unit: UnitSystem, scale: EffortScale) {
  const parts: string[] = [];
  if (s.weightKg) parts.push(formatWeight(s.weightKg, unit));
  if (s.reps != null) parts.push(`${s.reps} Wdh.`);
  if (s.durationSeconds != null) parts.push(`${s.durationSeconds} s`);
  if (s.rir != null) parts.push(formatEffort(s.rir, scale));
  return parts.join(" · ");
}

export function ExerciseCard({
  exercise,
  planned,
  log,
  sessionId,
  sessionExercises,
  goal,
  experience,
  expanded,
  onToggle,
  onActivity,
  onNext,
  onSwap,
  substitutedFor = null,
}: {
  exercise: Exercise;
  planned: StoredPlanExercise | null;
  log: LoggedExercise | null;
  sessionId: string;
  sessionExercises: LoggedExercise[];
  goal: TrainingGoal;
  experience: ExperienceLevel;
  expanded: boolean;
  onToggle: () => void;
  /** Satz eingetragen → Karte bleibt offen (Finisher, Bewertung) */
  onActivity: () => void;
  /** Zur nächsten offenen Übung springen */
  onNext?: () => void;
  /** Übung tauschen (nur Planübungen) */
  onSwap?: () => void;
  /** heute ersetzt – Originalübung laut Plan */
  substitutedFor?: Exercise | null;
}) {
  const { unitSystem: unit, effortScale: scale } = useSettings();
  const guidelines = resolveExerciseGuidelines(exercise, goal, experience);
  const p: Prescription = planned
    ? {
        sets: planned.sets,
        repsMin: planned.repsMin,
        repsMax: planned.repsMax,
        rirMin: planned.rirMin,
        rirMax: planned.rirMax,
        restSeconds: planned.restSeconds,
        technique: planned.lastSetTechnique,
      }
    : {
        sets: 3,
        repsMin: guidelines.rep_range!.min!,
        repsMax: guidelines.rep_range!.max!,
        rirMin: guidelines.proximity_to_failure!.min!,
        rirMax: guidelines.proximity_to_failure!.max!,
        restSeconds: guidelines.rest_interval!.min!,
        technique: null,
      };

  const last = useLiveQuery(() => lastPerformance(getDb(), exercise.id, sessionId), [exercise.id, sessionId], null);
  const lastWorking = last?.sets.filter((s) => s.setType === "working") ?? [];
  const lastTop = lastWorking.length ? Math.max(...lastWorking.map((s) => s.weightKg ?? 0)) : null;

  const sets = log?.sets ?? [];
  const working = sets.filter((s) => s.setType === "working");
  const done = working.length >= p.sets;
  const suggestion = suggestNextSet(
    { repsMin: p.repsMin, repsMax: p.repsMax, rirMin: p.rirMin, rirMax: p.rirMax, targetLoadKg: planned?.targetLoadKg ?? lastTop, loadIncrementKg: exercise.loadIncrementKg },
    sets,
  );

  const techniqueDone = sets.some((s) => TECHNIQUE_SET_TYPES.includes(s.setType));
  const [mode, setMode] = useState<"working" | "warmup" | "technique">("working");
  const nextType: SetType = mode === "warmup" ? "warmup" : mode === "technique" && p.technique ? p.technique : "working";

  // Junk Volume: harte Sätze heute je Hauptmuskel gegen den Richtwert pro Einheit
  const today = muscleVolume(sessionExercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets })));
  const overCap = primaryMuscles(exercise)
    .map((m) => ({ m, cap: resolveMuscleGuidelines(m, goal, experience).session_volume?.max ?? 10, sets: today.get(m)?.direct ?? 0 }))
    .filter((x) => x.sets >= x.cap);

  const weighted = exercise.trackingType === "weight_reps" || !exercise.equipment.includes("resistance_band");
  const timed = exercise.trackingType === "duration";

  return (
    <section className={`rounded-2xl border bg-surface ${expanded ? "border-accent" : "border-border"}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"
          }`}
        >
          {done ? "✓" : `${working.length}/${p.sets}`}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{exercise.nameDe}</span>
          <span className="tabular block text-sm text-muted">
            {p.sets} × {timed ? "Zeit" : `${p.repsMin}–${p.repsMax}`} · {scale === "rpe" ? `RPE ${rirToRpe(p.rirMax)}–${rirToRpe(p.rirMin)}` : `RIR ${p.rirMin}–${p.rirMax}`}
            {planned?.targetLoadKg != null && ` · ${formatWeight(planned.targetLoadKg, unit)}`}
          </span>
        </span>
        <span aria-hidden="true" className={`text-muted transition-transform ${expanded ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
          {(onSwap || substitutedFor) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {substitutedFor ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  Heute statt {substitutedFor.nameDe}
                </span>
              ) : (
                <span />
              )}
              {onSwap && (
                <button
                  type="button"
                  onClick={onSwap}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium"
                >
                  <SwapIcon className="size-4" /> Übung tauschen
                </button>
              )}
            </div>
          )}
          {/* Richtwerte inline */}
          <details className="group rounded-xl bg-accent-soft px-3 py-2 text-sm">
            <summary className="flex cursor-pointer list-none flex-wrap gap-x-3 gap-y-1">
              <span className="font-medium">{timed ? "Zeit nach Gefühl" : `${p.repsMin}–${p.repsMax} Wdh.`}</span>
              <span className="font-medium">
                {scale === "rpe" ? `RPE ${rirToRpe(p.rirMax)}–${rirToRpe(p.rirMin)}` : `${p.rirMin}–${p.rirMax} im Tank`}
              </span>
              <span className="font-medium">{p.restSeconds} s Pause</span>
              {p.technique && <span className="font-medium">+ {SET_TYPE_LABELS[p.technique]}</span>}
              <span className="ml-auto text-accent group-open:hidden">Warum?</span>
            </summary>
            <ul className="mt-2 space-y-1.5 text-muted">
              {[guidelines.rep_range, guidelines.proximity_to_failure, guidelines.rest_interval, guidelines.range_of_motion, guidelines.attentional_focus]
                .filter((g) => g !== undefined)
                .map((g) => (
                  <li key={g.key}>
                    <span className="font-medium text-fg">{formatGuidelineMessage(g)}.</span> {g.rationale}
                  </li>
                ))}
            </ul>
            <Link href={`/exercises/${exercise.slug}`} className="mt-2 inline-block text-accent">
              Ausführung ansehen ›
            </Link>
          </details>

          {/* Letztes Mal */}
          <p className="text-sm">
            <span className="text-muted">Letztes Mal: </span>
            {lastWorking.length ? (
              <span className="tabular font-medium">
                {lastWorking
                  .map((s) => (timed ? `${s.durationSeconds} s` : s.weightKg ? `${formatWeight(s.weightKg, unit)} × ${s.reps}` : `${s.reps} Wdh.`))
                  .join(" · ")}
              </span>
            ) : (
              <span className="text-muted">noch kein Eintrag</span>
            )}
          </p>

          {overCap.length > 0 && (
            <p role="status" className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              {overCap.map((x) => `${getMuscle(x.m).nameDe.replace(/ \(.*\)$/, "")}: ${x.sets.toLocaleString("de-DE")} harte Sätze heute`).join(", ")} – mehr
              als {overCap[0].cap} pro Einheit bringen kaum Zusatznutzen (Junk Volume).
            </p>
          )}

          {/* Erledigte Sätze */}
          {sets.length > 0 && (
            <ol className="space-y-1.5">
              {sets.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <span className="w-16 shrink-0 text-xs text-muted">
                    {s.setType === "working" ? `Satz ${working.indexOf(s) + 1}` : SET_TYPE_LABELS[s.setType]}
                  </span>
                  <span className="tabular flex-1 font-medium">{describeSet(s, unit, scale)}</span>
                  <button
                    type="button"
                    aria-label="Satz löschen"
                    onClick={() => log && workoutStore.getState().removeSet(log.id, s.id)}
                    className="min-h-9 min-w-9 rounded-lg text-muted"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* Satztyp */}
          <div className="flex flex-wrap gap-2 text-sm">
            <ModeChip active={mode === "working"} onClick={() => setMode("working")}>
              Arbeitssatz
            </ModeChip>
            <ModeChip active={mode === "warmup"} onClick={() => setMode("warmup")}>
              Aufwärmen
            </ModeChip>
            {p.technique && working.length > 0 && !techniqueDone && (
              <ModeChip active={mode === "technique"} onClick={() => setMode("technique")}>
                {SET_TYPE_LABELS[p.technique]}
              </ModeChip>
            )}
          </div>

          <SetEntry
            key={`${sets.length}-${nextType}`}
            exercise={exercise}
            unit={unit}
            scale={scale}
            weighted={weighted}
            timed={timed}
            setType={nextType}
            repsHint={`${p.repsMin}–${p.repsMax}`}
            defaultWeightKg={nextType === "warmup" ? (suggestion.weightKg ? Math.round((suggestion.weightKg * 0.5) / exercise.loadIncrementKg) * exercise.loadIncrementKg : null) : suggestion.weightKg}
            suggestionReason={nextType === "working" && working.length > 0 ? suggestion.reason : null}
            onLogged={(type) => {
              onActivity();
              if (type === p.technique) setMode("working");
              const isLastPlanned = type === "working" && working.length + 1 >= p.sets && !p.technique;
              useRestTimer
                .getState()
                .start(type === "warmup" ? 60 : p.restSeconds, isLastPlanned ? "Übung geschafft – Pause vor der nächsten" : formatGuidelineMessage(guidelines.rest_interval!));
            }}
            ensureLog={() => workoutStore.getState().ensureExercise(exercise.id, planned?.id ?? null)}
          />

          {working.length > 0 && log && <Rating log={log} />}

          {done && onNext && (
            <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={onNext}>
              Weiter zur nächsten Übung ›
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function ModeChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-full border px-3 font-medium ${active ? "border-accent bg-accent text-accent-fg" : "border-border"}`}
    >
      {children}
    </button>
  );
}

function SetEntry({
  exercise,
  unit,
  scale,
  weighted,
  timed,
  setType,
  repsHint,
  defaultWeightKg,
  suggestionReason,
  onLogged,
  ensureLog,
}: {
  exercise: Exercise;
  unit: UnitSystem;
  scale: EffortScale;
  weighted: boolean;
  timed: boolean;
  setType: SetType;
  repsHint: string;
  defaultWeightKg: number | null;
  suggestionReason: string | null;
  onLogged: (type: SetType) => void;
  ensureLog: () => string;
}) {
  const step = displayIncrement(exercise.loadIncrementKg, unit);
  const [weight, setWeight] = useState(defaultWeightKg != null && defaultWeightKg > 0 ? formatInput(toDisplayWeight(defaultWeightKg, unit)) : "");
  const [reps, setReps] = useState("");
  const [rir, setRir] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyweight = exercise.trackingType !== "weight_reps";
  const formRef = useRef<HTMLFormElement>(null);

  // Nach einem eingetragenen Satz (neue Instanz über key) das Eingabefeld über dem Pausen-Timer zeigen
  useEffect(() => {
    if (suggestionReason !== null) formRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [suggestionReason]);

  const bump = (value: string, delta: number, min = 0) => {
    const n = parseNumber(value) ?? 0;
    return formatInput(Math.max(min, Math.round((n + delta) * 100) / 100));
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const w = parseNumber(weight);
    const r = parseNumber(reps);
    if (!timed && (r == null || !Number.isInteger(r) || r < 0)) return setError("Bitte Wiederholungen eintragen");
    if (timed && (r == null || r <= 0)) return setError("Bitte Sekunden eintragen");
    if (!bodyweight && weighted && w == null) return setError("Bitte Gewicht eintragen");
    try {
      const logId = ensureLog();
      workoutStore.getState().logSet(logId, {
        setType,
        weightKg: w == null ? null : fromDisplayWeight(w, unit),
        reps: timed ? null : r,
        durationSeconds: timed ? Math.round(r!) : null,
        rir: timed ? null : rir,
      });
      onLogged(setType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Satz konnte nicht gespeichert werden");
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="scroll-mb-[calc(8.5rem+env(safe-area-inset-bottom))] space-y-3 rounded-xl border border-border p-3">
      <div className="grid grid-cols-2 gap-3">
        {weighted && (
          <NumberField
            label={bodyweight ? `Zusatz (${weightUnitLabel(unit)})` : `Gewicht (${weightUnitLabel(unit)})`}
            value={weight}
            onChange={setWeight}
            onMinus={() => setWeight(bump(weight, -step))}
            onPlus={() => setWeight(bump(weight, step))}
            inputMode="decimal"
            placeholder={bodyweight ? "optional" : "0"}
          />
        )}
        <NumberField
          label={timed ? "Sekunden" : "Wiederholungen"}
          value={reps}
          onChange={setReps}
          onMinus={() => setReps(bump(reps, timed ? -5 : -1))}
          onPlus={() => setReps(bump(reps, timed ? 5 : 1))}
          inputMode="numeric"
          placeholder={timed ? "30" : repsHint}
        />
      </div>

      {suggestionReason && <p className="text-xs text-muted">Vorschlag: {suggestionReason}</p>}

      {!timed && setType !== "warmup" && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">
            {scale === "rpe" ? "Wie anstrengend? (RPE)" : "Wie viele hättest du noch geschafft? (RIR)"}
          </legend>
          <div className="grid grid-cols-6 gap-1.5">
            {RIR_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rir === value}
                onClick={() => setRir(rir === value ? null : value)}
                className={`min-h-11 rounded-lg border text-sm font-semibold ${
                  rir === value ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface"
                }`}
              >
                {scale === "rpe" ? (value === 5 ? "≤5" : rirToRpe(value)) : value === 5 ? "5+" : value}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className={`${buttonStyles.primary} w-full`}>
        {setType === "working" ? "Satz eintragen" : `${SET_TYPE_LABELS[setType]} eintragen`}
      </button>
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
  onMinus,
  onPlus,
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onMinus: () => void;
  onPlus: () => void;
  inputMode: "decimal" | "numeric";
  placeholder: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <div className="mt-1 flex items-stretch overflow-hidden rounded-xl border border-border bg-surface focus-within:border-accent">
        <button type="button" onClick={onMinus} aria-label={`${label} verringern`} className="min-w-11 text-xl text-muted">
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={inputMode}
          placeholder={placeholder}
          className="tabular min-h-12 w-full min-w-0 bg-transparent text-center text-lg font-semibold outline-none"
        />
        <button type="button" onClick={onPlus} aria-label={`${label} erhöhen`} className="min-w-11 text-xl text-muted">
          +
        </button>
      </div>
    </label>
  );
}

const RATING_LABELS = ["kein", "leicht", "deutlich", "stark"];

function Rating({ log }: { log: LoggedExercise }) {
  const rate = (patch: { pumpRating?: number | null; jointDiscomfort?: number | null }) => workoutStore.getState().rateExercise(log.id, patch);
  return (
    <div className="space-y-2 text-sm">
      {(
        [
          ["Pump", "pumpRating", log.pumpRating],
          ["Gelenkbeschwerden", "jointDiscomfort", log.jointDiscomfort],
        ] as const
      ).map(([label, field, current]) => (
        <fieldset key={field}>
          <legend className="mb-1 font-medium">{label}</legend>
          <div className="grid grid-cols-4 gap-1.5">
            {RATING_LABELS.map((text, value) => (
              <button
                key={text}
                type="button"
                aria-pressed={current === value}
                onClick={() => rate({ [field]: current === value ? null : value })}
                className={`min-h-10 rounded-lg border text-xs font-medium ${
                  current === value ? "border-accent bg-accent text-accent-fg" : "border-border"
                }`}
              >
                {text}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-muted">
        Pump hilft, passende Übungen für dich zu finden – als Wachstumssignal ist er nicht belegt. Gelenkbeschwerden ab „deutlich“
        in zwei Einheiten führen zu einem Wechselvorschlag.
      </p>
    </div>
  );
}
