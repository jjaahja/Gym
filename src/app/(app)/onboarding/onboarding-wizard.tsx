"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ScienceHint } from "@/components/science";
import { buttonStyles, Card } from "@/components/ui";
import { VolumeBar } from "@/components/volume-bar";
import { EQUIPMENT, EQUIPMENT_PRESETS, type EquipmentSlug } from "@/data/catalog/equipment";
import { TRACKED_MUSCLES, type TrackedMuscle } from "@/data/catalog/muscles";
import { getExercise, getMuscle } from "@/lib/catalog";
import type { ExperienceLevel, SplitType, TrainingGoal } from "@/lib/db/enums";
import { GOAL_LABELS, SET_TYPE_LABELS } from "@/lib/labels";
import { getGuideline, resolveMuscleGuidelines } from "@/lib/science";
import { getCurrentUserId } from "@/lib/supabase/client";
import { generatePlan, previewSplit, SPLIT_LABELS } from "@/lib/training/plan-generator";
import { defaultWeekdays, recoveryWarnings, weekdayShort, type Weekday } from "@/lib/training/schedule";
import { WeekdayPicker } from "@/components/weekday-picker";
import { planStore, usePlan, usePlanHydrated } from "@/stores/plan";
import type { AssessmentInput } from "@/stores/plan-store";

const MAX_PRIORITIES = 3;

const DEFAULT_DRAFT: AssessmentInput = {
  goal: "hypertrophy",
  experience: "beginner",
  trainingAgeMonths: null,
  daysPerWeek: 3,
  sessionDurationMin: 60,
  preferredSplit: null,
  priorityMuscles: [],
  equipment: [...EQUIPMENT_PRESETS.gym],
  limitations: "",
};

const STEPS = ["Ziel", "Erfahrung", "Zeit", "Ausstattung", "Fokus", "Feinschliff", "Vorschau"] as const;

// ─────────────────────────── Bausteine ───────────────────────────

function OptionCard({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-2xl p-4 text-left transition-colors ${
        selected ? "bg-accent-soft ring-2 ring-accent" : "bg-surface shadow-card"
      }`}
    >
      <span className="block font-semibold">{title}</span>
      {description && <span className="mt-1 block text-sm text-muted">{description}</span>}
    </button>
  );
}

function Chip({ selected, onClick, children, disabled }: { selected: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-full px-4 text-sm font-medium disabled:opacity-40 ${
        selected ? "bg-accent text-accent-fg" : "bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

// ─────────────────────────── Schritte ───────────────────────────

type StepProps = { draft: AssessmentInput; update: (patch: Partial<AssessmentInput>) => void };

const GOALS: { value: TrainingGoal; description: string; guideline: string }[] = [
  { value: "hypertrophy", description: "Mehr Muskeln und bessere Proportionen – der Schwerpunkt dieser App.", guideline: "rep_range.hypertrophy" },
  { value: "strength", description: "So schwer wie möglich heben, z. B. Bankdrücken oder Kniebeuge.", guideline: "rep_range.strength.compound" },
  { value: "endurance", description: "Viele Wiederholungen durchhalten (Kraftausdauer).", guideline: "rep_range.endurance" },
];

function GoalStep({ draft, update }: StepProps) {
  const current = GOALS.find((g) => g.value === draft.goal)!;
  return (
    <div className="space-y-3">
      <StepHeader title="Was ist dein Ziel?" />
      {GOALS.map((g) => (
        <OptionCard key={g.value} selected={draft.goal === g.value} onClick={() => update({ goal: g.value })} title={GOAL_LABELS[g.value]} description={g.description} />
      ))}
      <ScienceHint guideline={getGuideline(current.guideline)} />
    </div>
  );
}

const LEVELS: { value: ExperienceLevel; title: string; description: string; months: number }[] = [
  { value: "beginner", title: "Einsteiger", description: "Weniger als 1 Jahr regelmäßiges Krafttraining.", months: 6 },
  { value: "intermediate", title: "Fortgeschritten", description: "1–3 Jahre regelmäßig, die Grundübungen sitzen.", months: 24 },
  { value: "advanced", title: "Erfahren", description: "Mehr als 3 Jahre, Fortschritt kommt nur noch langsam.", months: 48 },
];

function ExperienceStep({ draft, update }: StepProps) {
  const volume = resolveMuscleGuidelines("chest", draft.goal, draft.experience).weekly_volume!;
  return (
    <div className="space-y-3">
      <StepHeader title="Wie viel Erfahrung hast du?" subtitle="Bestimmt Startvolumen, Übungsauswahl und wie nah du ans Versagen gehst." />
      {LEVELS.map((l) => (
        <OptionCard
          key={l.value}
          selected={draft.experience === l.value}
          onClick={() => update({ experience: l.value, trainingAgeMonths: l.months })}
          title={l.title}
          description={l.description}
        />
      ))}
      <ScienceHint guideline={volume} />
    </div>
  );
}

const DURATIONS = [30, 45, 60, 75, 90, 120];

function TimeStep({ draft, update, weekdays, setWeekdays }: StepProps & { weekdays: Weekday[]; setWeekdays: (w: Weekday[]) => void }) {
  const split = previewSplit(draft.daysPerWeek, draft.preferredSplit);
  return (
    <div className="space-y-4">
      <StepHeader title="Wie viel Zeit hast du?" />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Trainingstage pro Woche</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={draft.daysPerWeek === d}
              onClick={() => update({ daysPerWeek: d })}
              className={`min-h-12 rounded-xl text-lg font-semibold ${
                draft.daysPerWeek === d ? "bg-accent text-accent-fg" : "bg-surface-2"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </fieldset>
      <WeekdayPicker
        label="An welchen Tagen?"
        value={weekdays}
        count={Math.min(draft.daysPerWeek, 6)}
        onChange={setWeekdays}
      />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Minuten pro Einheit</legend>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((m) => (
            <Chip key={m} selected={draft.sessionDurationMin === m} onClick={() => update({ sessionDurationMin: m })}>
              {m} min
            </Chip>
          ))}
        </div>
      </fieldset>
      <Card>
        <p className="text-sm text-muted">Daraus wird</p>
        <p className="font-semibold">
          {split.label} · {Math.min(draft.daysPerWeek, 6)} Tage
        </p>
        {draft.daysPerWeek === 7 && <p className="mt-1 text-sm text-muted">Mindestens ein Ruhetag pro Woche – der Plan nutzt 6 Tage.</p>}
      </Card>
      <ScienceHint guideline={getGuideline("frequency.default")} />
    </div>
  );
}

const PRESETS: { key: keyof typeof EQUIPMENT_PRESETS; label: string }[] = [
  { key: "gym", label: "Fitnessstudio" },
  { key: "home_dumbbells", label: "Zuhause: Kurzhanteln & Bank" },
  { key: "home_minimal", label: "Minimal: Stange & Band" },
];

function EquipmentStep({ draft, update }: StepProps) {
  const selected = new Set(draft.equipment);
  const toggle = (slug: EquipmentSlug) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    update({ equipment: EQUIPMENT.map((e) => e.slug).filter((s) => next.has(s)) });
  };
  return (
    <div className="space-y-4">
      <StepHeader title="Was steht dir zur Verfügung?" subtitle="Wähle eine Vorlage und passe sie bei Bedarf an." />
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const preset = EQUIPMENT_PRESETS[p.key];
          const active = preset.length === selected.size && preset.every((e) => selected.has(e));
          return (
            <Chip key={p.key} selected={active} onClick={() => update({ equipment: [...preset] })}>
              {p.label}
            </Chip>
          );
        })}
      </div>
      <Card className="divide-y divide-border p-0">
        {EQUIPMENT.map((e) => (
          <label key={e.slug} className="flex min-h-12 items-center gap-3 px-4">
            <input type="checkbox" checked={selected.has(e.slug)} onChange={() => toggle(e.slug)} className="size-5 accent-[var(--accent)]" />
            <span>{e.nameDe}</span>
          </label>
        ))}
      </Card>
      <p className="text-sm text-muted">Übungen ohne Equipment (z. B. Liegestütze, Ausfallschritte) sind immer möglich.</p>
    </div>
  );
}

const FOCUS_PRESETS: { label: string; muscles: TrackedMuscle[] }[] = [
  { label: "V-Form", muscles: ["side_delts", "lats"] },
  { label: "Arme", muscles: ["biceps", "triceps"] },
  { label: "Brust", muscles: ["chest"] },
  { label: "Beine & Po", muscles: ["glutes", "quads"] },
];

function FocusStep({ draft, update }: StepProps) {
  const volume = resolveMuscleGuidelines("chest", draft.goal, draft.experience).weekly_volume!;
  const boosted = Math.round(volume.min! + 0.4 * (volume.max! - volume.min!));
  const toggle = (m: TrackedMuscle) => {
    const has = draft.priorityMuscles.includes(m);
    if (!has && draft.priorityMuscles.length >= MAX_PRIORITIES) return;
    update({ priorityMuscles: has ? draft.priorityMuscles.filter((x) => x !== m) : [...draft.priorityMuscles, m] });
  };
  return (
    <div className="space-y-4">
      <StepHeader
        title="Welche Partien sollen optisch besonders zulegen?"
        subtitle={`Optional, höchstens ${MAX_PRIORITIES}. Diese Muskeln bekommen mehr Volumen und kommen früher im Training dran.`}
      />
      <div className="flex flex-wrap gap-2">
        {FOCUS_PRESETS.map((p) => (
          <Chip
            key={p.label}
            selected={p.muscles.every((m) => draft.priorityMuscles.includes(m)) && p.muscles.length === draft.priorityMuscles.length}
            onClick={() => update({ priorityMuscles: p.muscles })}
          >
            {p.label}
          </Chip>
        ))}
        <Chip selected={draft.priorityMuscles.length === 0} onClick={() => update({ priorityMuscles: [] })}>
          Ausgewogen
        </Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        {TRACKED_MUSCLES.map((m) => (
          <Chip
            key={m}
            selected={draft.priorityMuscles.includes(m)}
            disabled={!draft.priorityMuscles.includes(m) && draft.priorityMuscles.length >= MAX_PRIORITIES}
            onClick={() => toggle(m)}
          >
            {getMuscle(m).nameDe.replace(/ \(.*\)$/, "")}
          </Chip>
        ))}
      </div>
      <ScienceHint guideline={volume}>
        Prioritätsmuskeln starten bei etwa {boosted} statt {volume.min} Sätzen pro Woche. Jede Priorität kostet Trainingszeit –
        deshalb lieber wenige gezielt wählen.
      </ScienceHint>
    </div>
  );
}

const SPLIT_OPTIONS: (SplitType | null)[] = [null, "full_body", "upper_lower", "push_pull_legs"];

function DetailsStep({ draft, update }: StepProps) {
  return (
    <div className="space-y-4">
      <StepHeader title="Feinschliff" subtitle="Alles optional." />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Trainingsaufteilung</legend>
        <div className="flex flex-wrap gap-2">
          {SPLIT_OPTIONS.map((s) => (
            <Chip key={s ?? "auto"} selected={draft.preferredSplit === s} onClick={() => update({ preferredSplit: s })}>
              {s ? SPLIT_LABELS[s] : "Automatisch (empfohlen)"}
            </Chip>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">
        Verletzungen oder Einschränkungen
        <textarea
          value={draft.limitations}
          onChange={(e) => update({ limitations: e.target.value })}
          rows={3}
          placeholder="z. B. Schulter rechts empfindlich bei Überkopfübungen"
          className="field mt-1 block py-3"
        />
      </label>
      <p className="text-sm text-muted">
        Wird gespeichert und bei Übungswechseln berücksichtigt. Bei Schmerzen bitte ärztlich oder physiotherapeutisch abklären lassen.
      </p>
    </div>
  );
}

function PreviewStep({ draft, weekdays }: { draft: AssessmentInput; weekdays: Weekday[] }) {
  const plan = useMemo(() => generatePlan(draft), [draft]);
  const scheduled = plan.days.map((d, i) => ({ ...d, weekday: weekdays[i] ?? null }));
  const recovery = recoveryWarnings(
    scheduled.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ exerciseId: getExercise(e.exerciseSlug)!.id, sets: e.sets })) })) as never,
  );
  return (
    <div className="space-y-4">
      <StepHeader title={plan.name} subtitle={`${plan.days.length} Tage pro Woche · Mesozyklus ${plan.mesocycleWeeks} Wochen`} />

      {plan.warnings.length + recovery.length > 0 && (
        <div className="space-y-2 rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning-fg" role="status">
          {[...plan.warnings, ...recovery].map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {scheduled.map((day) => (
        <Card key={day.dayIndex}>
          <div className="flex items-baseline justify-between">
            <h3 className="flex items-baseline gap-2 font-semibold">
              {day.weekday && (
                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-bold text-accent">{weekdayShort(day.weekday)}</span>
              )}
              {day.name}
            </h3>
            <span className="text-sm text-muted">ca. {day.estimatedMinutes} min</span>
          </div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {day.exercises.map((e) => (
              <li key={e.exerciseSlug} className="flex justify-between gap-3">
                <span>
                  {getExercise(e.exerciseSlug)!.nameDe}
                  {e.lastSetTechnique && <span className="text-accent"> + {SET_TYPE_LABELS[e.lastSetTechnique]}</span>}
                </span>
                <span className="tabular shrink-0 text-muted">
                  {e.sets} × {e.repsMin}–{e.repsMax}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card>
        <h3 className="font-semibold">Harte Sätze pro Woche</h3>
        <p className="mt-1 text-sm text-muted">Mitbeanspruchte Muskeln zählen halb. Der markierte Bereich ist der Richtwert.</p>
        <div className="mt-3 space-y-3">
          {plan.volume.map((v) => (
            <VolumeBar key={v.muscle} label={getMuscle(v.muscle).nameDe.replace(/ \(.*\)$/, "")} value={v.plannedSets} min={v.min} max={v.max} highlight={v.priority} />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────── Wizard ───────────────────────────

export function OnboardingWizard() {
  const hydrated = usePlanHydrated();
  // Erst nach dem Laden des gespeicherten Plans starten, damit der Entwurf vorbelegt werden kann
  return hydrated ? <Wizard /> : <Card className="h-64 animate-pulse">{null}</Card>;
}

function Wizard() {
  const router = useRouter();
  const existing = usePlan((s) => s.plan);
  const [draft, setDraft] = useState<AssessmentInput>(() => existing?.assessment ?? DEFAULT_DRAFT);
  const [weekdays, setWeekdays] = useState<Weekday[]>(() => {
    const current = existing?.days.map((d) => d.weekday).filter((w): w is Weekday => w != null) ?? [];
    const count = Math.min((existing?.assessment ?? DEFAULT_DRAFT).daysPerWeek, 6);
    return current.length === count ? [...current].sort((a, b) => a - b) : defaultWeekdays(count);
  });
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<AssessmentInput>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.daysPerWeek !== undefined) setWeekdays(defaultWeekdays(patch.daysPerWeek));
  };
  const weekdaysComplete = weekdays.length === Math.min(draft.daysPerWeek, 6);
  const isLast = step === STEPS.length - 1;

  async function accept() {
    setSaving(true);
    try {
      const generated = generatePlan(draft);
      planStore.getState().createPlan({
        userId: await getCurrentUserId(),
        assessment: draft,
        generated,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        weekdays,
      });
      router.push("/dashboard");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted">
          Schritt {step + 1} von {STEPS.length} · {STEPS[step]}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {step === 0 && <GoalStep draft={draft} update={update} />}
      {step === 1 && <ExperienceStep draft={draft} update={update} />}
      {step === 2 && <TimeStep draft={draft} update={update} weekdays={weekdays} setWeekdays={setWeekdays} />}
      {step === 3 && <EquipmentStep draft={draft} update={update} />}
      {step === 4 && <FocusStep draft={draft} update={update} />}
      {step === 5 && <DetailsStep draft={draft} update={update} />}
      {step === 6 && <PreviewStep draft={draft} weekdays={weekdays} />}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={buttonStyles.secondary} onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
          Zurück
        </button>
        {isLast ? (
          <button type="button" className={buttonStyles.primary} onClick={accept} disabled={saving}>
            {existing ? "Neu starten" : "Übernehmen"}
          </button>
        ) : (
          <button
            type="button"
            className={buttonStyles.primary}
            onClick={() => setStep((s) => s + 1)}
            disabled={step === 2 && !weekdaysComplete}
          >
            {step === STEPS.length - 2 ? "Plan erstellen" : "Weiter"}
          </button>
        )}
      </div>
      {isLast && existing && (
        <p className="text-center text-sm text-muted">Dein bisheriger Plan wird archiviert, deine Trainingshistorie bleibt erhalten.</p>
      )}
    </div>
  );
}
