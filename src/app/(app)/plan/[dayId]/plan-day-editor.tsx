"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ExercisePicker } from "@/components/exercise-picker";
import { CheckIcon, PencilIcon, ReorderIcon, SwapIcon, TrashIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Card, List, ListRow, SectionLabel, Stepper } from "@/components/ui";
import type { MuscleSlug } from "@/data/catalog/muscles";
import { getExercise, getExerciseById, getMuscle, primaryMuscles } from "@/lib/catalog";
import type { SetType } from "@/lib/db/enums";
import { SET_TYPE_LABELS } from "@/lib/labels";
import { planVolume } from "@/lib/training/mesocycle";
import { allowsTechnique } from "@/lib/training/plan-generator";
import {
  EDIT_LIMITS,
  planSupersets,
  TECHNIQUE_HOWTO,
  TECHNIQUES,
  validateFields,
  type PlanExerciseFields,
} from "@/lib/training/plan-edit";
import { removalWarnings } from "@/lib/training/removal";
import { weekdayLong } from "@/lib/training/schedule";
import { supersetInfo } from "@/lib/workout/arrange";
import { planStore, usePlan, usePlanHydrated } from "@/stores/plan";
import type { StoredPlan, StoredPlanDay, StoredPlanExercise } from "@/stores/plan-store";
import { useWorkout } from "@/stores/workout";
import { ArrangeSheet } from "../../workout/arrange-sheet";
import { SwapSheet } from "../../workout/swap-sheet";

const shortMuscle = (m: MuscleSlug) => getMuscle(m).nameDe.replace(/ \(.*\)$/, "");
const de1 = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const restLabel = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s} s`);
const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

export function prescriptionText(e: Pick<StoredPlanExercise, "sets" | "repsMin" | "repsMax" | "rirMin" | "rirMax" | "restSeconds" | "lastSetTechnique">) {
  return `${e.sets} × ${range(e.repsMin, e.repsMax)} Wdh. · RIR ${range(e.rirMin, e.rirMax)} · ${restLabel(e.restSeconds)}${
    e.lastSetTechnique ? ` · + ${SET_TYPE_LABELS[e.lastSetTechnique]}` : ""
  }`;
}

/** Trainingstag im Plan bearbeiten: Vorgaben, Übungen hinzufügen/tauschen/entfernen, Reihenfolge und Supersätze. */
export function PlanDayEditor() {
  const { dayId } = useParams<{ dayId: string }>();
  const hydrated = usePlanHydrated();
  const plan = usePlan((s) => s.plan);
  const day = plan?.days.find((d) => d.id === dayId) ?? null;

  if (!hydrated) return <div className="h-64 animate-pulse rounded-[1.125rem] bg-surface" />;
  if (!plan || !day)
    return (
      <Card>
        <p className="font-semibold">Trainingstag nicht gefunden</p>
        <p className="mt-1 text-sm text-muted">Vielleicht hast du inzwischen einen neuen Plan erstellt.</p>
        <Link href="/dashboard" className={`${buttonStyles.secondary} mt-3 w-full`}>
          Zum Plan
        </Link>
      </Card>
    );
  return <Editor plan={plan} day={day} />;
}

function Editor({ plan, day }: { plan: StoredPlan; day: StoredPlanDay }) {
  const session = useWorkout((s) => s.session);
  const [editId, setEditId] = useState<string | null>(null);
  const [swapId, setSwapId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [arranging, setArranging] = useState(false);

  const groups = useMemo(() => planSupersets(day.exercises), [day.exercises]);
  const info = useMemo(() => supersetInfo(day.exercises.map((e) => e.id), groups), [day.exercises, groups]);
  const below = plan.volume.filter((v) => v.status === "below").map((v) => v.muscle);
  const editing = day.exercises.find((e) => e.id === editId) ?? null;
  const swapping = day.exercises.find((e) => e.id === swapId) ?? null;
  const loggedInSession = (id: string) =>
    Boolean(session && session.planDayId === day.id && session.exercises.some((e) => e.planExerciseId === id && e.sets.length > 0));

  return (
    <div className="space-y-6">
      <header>
        <Link href="/dashboard" className="text-[1.0625rem] text-accent">
          ‹ Plan
        </Link>
        <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15]">{day.name}</h1>
        <p className="text-[0.9375rem] text-muted">
          {day.weekday ? `${weekdayLong(day.weekday)} · ` : ""}ca. {day.estimatedMinutes} min · {day.exercises.length} Übungen
        </p>
      </header>

      <section>
        <SectionLabel>Übungen</SectionLabel>
        <List>
          {day.exercises.map((e) => {
            const s = info.get(e.id);
            return (
              <ListRow
                key={e.id}
                onClick={() => setEditId(e.id)}
                title={
                  <>
                    {s && <span className="mr-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent">{s.label}</span>}
                    {getExerciseById(e.exerciseId)?.nameDe ?? "Übung"}
                  </>
                }
                subtitle={prescriptionText(e)}
              />
            );
          })}
        </List>
        {day.exercises.length === 0 && <p className="mt-2 px-4 text-sm text-muted">Noch keine Übungen an diesem Tag.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className={buttonStyles.secondary} onClick={() => setAdding(true)}>
            + Übung
          </button>
          <button type="button" className={buttonStyles.secondary} disabled={day.exercises.length < 2} onClick={() => setArranging(true)}>
            <ReorderIcon className="size-5" /> Reihenfolge
          </button>
        </div>
        <p className="mt-2 px-4 text-[0.8125rem] text-muted">
          Änderungen gelten ab dem nächsten Training. Du findest sie unter „Anpassungen“ und kannst sie dort rückgängig machen.
        </p>
      </section>

      <VolumeOverview plan={plan} />

      {editing && (
        <EditSheet
          key={editing.id}
          plan={plan}
          day={day}
          exercise={editing}
          onClose={() => setEditId(null)}
          onSwap={() => {
            setEditId(null);
            setSwapId(editing.id);
          }}
        />
      )}
      {swapping && (
        <SwapSheet
          open
          onClose={() => setSwapId(null)}
          planExerciseId={swapping.id}
          original={getExercise(swapping.exerciseSlug)!}
          current={getExercise(swapping.exerciseSlug)!}
          inSession={new Set(day.exercises.map((e) => e.exerciseSlug))}
          goal={plan.goal}
          experience={plan.experience}
          equipment={plan.assessment.equipment}
          canSwap={!loggedInSession(swapping.id)}
          planOnly
        />
      )}
      <ExercisePicker
        open={adding}
        onClose={() => setAdding(false)}
        equipment={plan.assessment.equipment}
        exclude={new Set(day.exercises.map((e) => e.exerciseSlug))}
        recommend={below}
        title="Übung zum Plan hinzufügen"
        onPick={(e) => {
          const added = planStore.getState().addPlanExercise(day.id, e.slug);
          if (added) setEditId(added.id);
        }}
      />
      {arranging && (
        <ArrangeSheet
          onClose={() => setArranging(false)}
          items={day.exercises.map((e) => ({ key: e.id, name: getExerciseById(e.exerciseId)?.nameDe ?? "Übung" }))}
          supersets={groups}
          hint="Gilt für jedes Training dieses Tages – im Training kannst du es für einen Tag ändern."
          onSave={(order, supersets) => planStore.getState().arrangeDay(day.id, order, supersets)}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Vorgabe ändern ───────────────────────────

const TECHNIQUE_OPTIONS: { value: "none" | (typeof TECHNIQUES)[number]; label: string }[] = [
  { value: "none", label: "Keine" },
  { value: "myo_reps", label: "Myo-Reps" },
  { value: "dropset", label: "Dropsatz" },
  { value: "rest_pause", label: "Rest-Pause" },
  { value: "lengthened_partials", label: "Teilwiederholungen in Dehnung" },
];

function EditSheet({
  plan,
  day,
  exercise,
  onClose,
  onSwap,
}: {
  plan: StoredPlan;
  day: StoredPlanDay;
  exercise: StoredPlanExercise;
  onClose: () => void;
  onSwap: () => void;
}) {
  const catalogExercise = getExercise(exercise.exerciseSlug);
  const [fields, setFields] = useState<PlanExerciseFields>({
    sets: exercise.sets,
    repsMin: exercise.repsMin,
    repsMax: exercise.repsMax,
    rirMin: exercise.rirMin,
    rirMax: exercise.rirMax,
    restSeconds: exercise.restSeconds,
    lastSetTechnique: exercise.lastSetTechnique,
  });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = <K extends keyof PlanExerciseFields>(key: K, value: PlanExerciseFields[K]) => setFields((f) => ({ ...f, [key]: value }));
  // „von“ und „bis“ zusammen halten, statt einen Fehler zu zeigen
  const setRange = (lo: "repsMin" | "rirMin", hi: "repsMax" | "rirMax", which: "lo" | "hi", value: number) =>
    setFields((f) =>
      which === "lo" ? { ...f, [lo]: value, [hi]: Math.max(f[hi], value) } : { ...f, [hi]: value, [lo]: Math.min(f[lo], value) },
    );
  const error = validateFields(fields);
  const changed = (Object.keys(fields) as (keyof PlanExerciseFields)[]).some((k) => fields[k] !== exercise[k]);
  const techniqueAdvised = catalogExercise ? allowsTechnique(catalogExercise, plan.goal, plan.experience) : false;

  // Auswirkung auf das Wochenvolumen der Zielmuskeln
  const volumeChange = useMemo(() => {
    if (!catalogExercise || fields.sets === exercise.sets) return [];
    const before = planVolume(plan.days);
    const after = planVolume(
      plan.days.map((d) => (d.id === day.id ? { ...d, exercises: d.exercises.map((e) => (e.id === exercise.id ? { ...e, sets: fields.sets } : e)) } : d)),
    );
    return primaryMuscles(catalogExercise).map((m) => {
      const target = plan.volume.find((v) => v.muscle === m);
      return { muscle: m, before: before.get(m) ?? 0, after: after.get(m) ?? 0, min: target?.min, max: target?.max };
    });
  }, [catalogExercise, fields.sets, exercise, plan, day.id]);

  function save() {
    if (error) return;
    planStore.getState().editPlanExercise(exercise.id, fields);
    onClose();
  }

  if (confirmRemove) {
    const warnings = removalWarnings(plan, exercise.id);
    return (
      <Sheet open onClose={onClose} title="Aus dem Plan entfernen">
        <p className="text-[0.9375rem]">
          <strong>{catalogExercise?.nameDe}</strong> wird aus „{day.name}“ entfernt. Du kannst das unter „Anpassungen“ rückgängig machen.
        </p>
        {warnings.length > 0 && (
          <div className="mt-3 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="status">
            {warnings.map((w) => (
              <p key={w.muscle}>
                {shortMuscle(w.muscle)}: {de1(w.before)} → {de1(w.after)} Sätze/Woche – unter dem Richtwert von {w.min}.
              </p>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className={`${buttonStyles.danger} w-full`}
            onClick={() => {
              planStore.getState().removeExercise(exercise.id);
              onClose();
            }}
          >
            <TrashIcon className="size-5" /> Entfernen
          </button>
          <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => setConfirmRemove(false)}>
            Abbrechen
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={catalogExercise?.nameDe ?? "Übung"}>
      <div className="space-y-5">
        <div className="divide-y divide-border rounded-[1.125rem] bg-surface px-4 shadow-card">
          <Stepper label="Sätze" value={fields.sets} min={EDIT_LIMITS.sets.min} max={EDIT_LIMITS.sets.max} onChange={(v) => set("sets", v)} />
          <Stepper
            label="Wdh. von"
            value={fields.repsMin}
            min={EDIT_LIMITS.reps.min}
            max={EDIT_LIMITS.reps.max}
            onChange={(v) => setRange("repsMin", "repsMax", "lo", v)}
          />
          <Stepper
            label="Wdh. bis"
            value={fields.repsMax}
            min={EDIT_LIMITS.reps.min}
            max={EDIT_LIMITS.reps.max}
            onChange={(v) => setRange("repsMin", "repsMax", "hi", v)}
          />
          <Stepper label="RIR von" value={fields.rirMin} min={EDIT_LIMITS.rir.min} max={EDIT_LIMITS.rir.max} onChange={(v) => setRange("rirMin", "rirMax", "lo", v)} />
          <Stepper label="RIR bis" value={fields.rirMax} min={EDIT_LIMITS.rir.min} max={EDIT_LIMITS.rir.max} onChange={(v) => setRange("rirMin", "rirMax", "hi", v)} />
          <Stepper
            label="Pause"
            value={fields.restSeconds}
            min={EDIT_LIMITS.rest.min}
            max={EDIT_LIMITS.rest.max}
            step={EDIT_LIMITS.rest.step}
            format={restLabel}
            onChange={(v) => set("restSeconds", v)}
          />
        </div>
        <p className="-mt-3 px-1 text-[0.8125rem] text-muted">
          RIR = Wiederholungen in Reserve: wie viele du am Satzende noch geschafft hättest. Für Muskelaufbau zählen Sätze nahe am
          Versagen (RIR 0–3) am meisten.
        </p>

        {volumeChange.length > 0 && (
          <div className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status">
            {volumeChange.map((v) => (
              <p key={v.muscle}>
                {shortMuscle(v.muscle)}: {de1(v.before)} → <strong>{de1(v.after)}</strong> Sätze/Woche
                {v.min != null && v.max != null && ` (Richtwert ${v.min}–${v.max})`}
                {v.max != null && v.after > v.max ? " – über dem Richtwert" : v.min != null && v.after < v.min ? " – unter dem Richtwert" : ""}
              </p>
            ))}
          </div>
        )}

        <div>
          <SectionLabel>Technik im letzten Satz</SectionLabel>
          <List>
            {TECHNIQUE_OPTIONS.map((o) => {
              const selected = (fields.lastSetTechnique ?? "none") === o.value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set("lastSetTechnique", o.value === "none" ? null : (o.value as SetType))}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-[1.0625rem] active:bg-surface-2"
                  >
                    {o.label}
                    {selected && <CheckIcon className="size-5 shrink-0 text-accent" />}
                  </button>
                </li>
              );
            })}
          </List>
          {fields.lastSetTechnique && (
            <p className="mt-2 px-1 text-[0.8125rem] text-muted">
              {TECHNIQUE_HOWTO[fields.lastSetTechnique as (typeof TECHNIQUES)[number]]}
              {!techniqueAdvised &&
                " Für diese Übung nicht empfohlen: Intensitätstechniken passen vor allem zu Isolationsübungen – bei schweren Grundübungen steigen Ermüdung und Verletzungsrisiko."}
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="alert">
            {error}
          </p>
        )}
        <button type="button" className={`${buttonStyles.primary} w-full`} disabled={!changed || Boolean(error)} onClick={save}>
          <PencilIcon className="size-5" /> Speichern
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={buttonStyles.secondary} onClick={onSwap}>
            <SwapIcon className="size-5" /> Tauschen
          </button>
          <button type="button" className={buttonStyles.danger} onClick={() => setConfirmRemove(true)}>
            <TrashIcon className="size-5" /> Entfernen
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ─────────────────────────── Wochenvolumen ───────────────────────────

function VolumeOverview({ plan }: { plan: StoredPlan }) {
  const off = plan.volume.filter((v) => v.status !== "ok");
  return (
    <section>
      <SectionLabel>Wochenvolumen (ganzer Plan)</SectionLabel>
      {off.length === 0 ? (
        <Card>
          <p className="text-[0.9375rem]">Alle Muskeln liegen im empfohlenen Bereich.</p>
        </Card>
      ) : (
        <List>
          {off.map((v) => (
            <ListRow
              key={v.muscle}
              title={shortMuscle(v.muscle)}
              subtitle={`Richtwert ${v.min}–${v.max} Sätze/Woche`}
              detail={
                <span className={v.status === "below" ? "text-warning-fg" : "text-danger"}>
                  {de1(v.plannedSets)} {v.status === "below" ? "↓" : "↑"}
                </span>
              }
            />
          ))}
        </List>
      )}
      <p className="mt-2 px-4 text-[0.8125rem] text-muted">
        Nebenmuskeln zählen halb. Unter dem Richtwert wächst ein Muskel langsamer, deutlich darüber steigt vor allem die Ermüdung.
      </p>
    </section>
  );
}
