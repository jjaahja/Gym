import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EquipmentSlug } from "@/data/catalog/equipment";
import type { MuscleSlug, TrackedMuscle } from "@/data/catalog/muscles";
import { getExercise } from "@/lib/catalog";
import type { ExperienceLevel, PlanStatus, SplitType, TrainingGoal } from "@/lib/db/enums";
import { catalogId } from "@/lib/db/stable-id";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { distributeVolumeChange, isDeloadActive, planVolume, WEEK_MS, type SetChange } from "@/lib/training/mesocycle";
import {
  allowsTechnique,
  estimateDayMinutes,
  prescribe,
  techniqueFor,
  type DayType,
  type GeneratedPlan,
  type MuscleVolume,
  type PlannedExercise,
} from "@/lib/training/plan-generator";
import type { AdaptationProposal } from "@/lib/training/progression";

// Aktiver Trainingsplan – lokal gespeichert (offline, Demo-Modus) und als DB-Zeilen synchronisiert.

export interface AssessmentInput {
  goal: TrainingGoal;
  experience: ExperienceLevel;
  trainingAgeMonths: number | null;
  daysPerWeek: number;
  sessionDurationMin: number;
  preferredSplit: SplitType | null;
  priorityMuscles: TrackedMuscle[];
  equipment: EquipmentSlug[];
  limitations: string;
}

export interface StoredPlanExercise extends PlannedExercise {
  id: string;
  targetLoadKg: number | null;
}

export interface StoredPlanDay {
  id: string;
  dayIndex: number;
  name: string;
  type: DayType;
  estimatedMinutes: number;
  exercises: StoredPlanExercise[];
}

export interface StoredPlan {
  id: string;
  userId: string | null;
  assessmentId: string;
  parentPlanId: string | null;
  name: string;
  splitType: SplitType;
  goal: TrainingGoal;
  experience: ExperienceLevel;
  mesocycleWeeks: number;
  generatorVersion: string;
  createdAt: string;
  startedAt: string;
  days: StoredPlanDay[];
  volume: MuscleVolume[];
  warnings: string[];
  assessment: AssessmentInput;
  /** Welcher Trainingstag als Nächstes dran ist */
  nextDayIndex: number;
  /** Beginn des laufenden Mesozyklus (nach einer Auswertung bzw. nach der anschließenden Deload-Woche) */
  cycleStartedAt: string;
  completedMesocycles: number;
  /** Beginn der laufenden bzw. letzten Deload-Woche (gilt 7 Tage) */
  deloadWeekStart: string | null;
  lastDeloadAt: string | null;
}

export interface AdaptationRecord extends AdaptationProposal {
  id: string;
  planId: string;
  planExerciseId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Vorschlag mit Bezug zur Planübung (Übungswechsel) oder ohne (Deload, Volumen). */
export interface Suggestion {
  proposal: AdaptationProposal;
  planExerciseId: string | null;
}

export interface MesocycleDecision {
  /** Automatische Volumenänderungen (auto_applied) */
  volume: readonly AdaptationProposal[];
  accepted: readonly Suggestion[];
  rejected: readonly Suggestion[];
}

export interface PlanState {
  plan: StoredPlan | null;
  adaptations: AdaptationRecord[];
  createPlan(args: {
    userId: string | null;
    assessment: AssessmentInput;
    generated: GeneratedPlan;
    timezone?: string;
  }): StoredPlan;
  advanceDay(completedDayIndex: number): void;
  /** Merkt sich das zuletzt genutzte Gewicht ohne Anpassungsprotokoll */
  setTargetLoad(planExerciseId: string, loadKg: number | null): void;
  /** Wendet eine Laständerung an (auto_applied) und protokolliert sie */
  applyLoadChange(planExerciseId: string, proposal: AdaptationProposal, loadKg: number | null): AdaptationRecord;
  /** Rückgängig: Last, Sätze, Übungswechsel oder Deload */
  revertAdaptation(adaptationId: string): void;
  /** Offener Vorschlag (z. B. nach dem Training); null, wenn derselbe schon offen ist */
  addSuggestion(suggestion: Suggestion): AdaptationRecord | null;
  acceptSuggestion(adaptationId: string): void;
  rejectSuggestion(adaptationId: string): void;
  /** Mesozyklus abschließen: Volumen anpassen, Entscheidungen protokollieren, neuen Zyklus beginnen */
  completeMesocycle(decision: MesocycleDecision): AdaptationRecord[];
  clear(): void;
}

export interface PlanStoreDeps {
  sink: (entry: NewOutboxEntry) => void;
  storage?: () => StateStorage;
  now?: () => Date;
  uuid?: () => string;
}

// ─────────────────────────── DB-Zeilen ───────────────────────────

function planRow(plan: StoredPlan, status: PlanStatus) {
  return {
    id: plan.id,
    user_id: plan.userId,
    assessment_id: plan.assessmentId,
    parent_plan_id: plan.parentPlanId,
    name: plan.name,
    split_type: plan.splitType,
    goal: plan.goal,
    status,
    mesocycle_weeks: plan.mesocycleWeeks,
    current_week: 1,
    generator_version: plan.generatorVersion,
    started_at: plan.startedAt,
  };
}

function assessmentRow(plan: StoredPlan) {
  const a = plan.assessment;
  return {
    id: plan.assessmentId,
    user_id: plan.userId,
    goal: a.goal,
    experience_level: a.experience,
    training_age_months: a.trainingAgeMonths,
    days_per_week: a.daysPerWeek,
    session_duration_min: a.sessionDurationMin,
    preferred_split: a.preferredSplit,
    priority_muscle_ids: a.priorityMuscles.map((m) => catalogId("muscle", m)),
    limitations: a.limitations.trim() || null,
    created_at: plan.createdAt,
  };
}

function planExerciseRow(dayId: string, e: StoredPlanExercise) {
  return {
    id: e.id,
    plan_day_id: dayId,
    exercise_id: e.exerciseId,
    order_index: e.orderIndex,
    superset_group: null,
    target_sets: e.sets,
    target_reps_min: e.repsMin,
    target_reps_max: e.repsMax,
    target_rir_min: e.rirMin,
    target_rir_max: e.rirMax,
    target_load_kg: e.targetLoadKg,
    rest_seconds: e.restSeconds,
    progression_scheme: e.progressionScheme,
    last_set_technique: e.lastSetTechnique,
    notes: null,
  };
}

function adaptationRow(userId: string | null, r: AdaptationRecord) {
  return {
    id: r.id,
    user_id: userId,
    plan_id: r.planId,
    plan_exercise_id: r.planExerciseId,
    muscle_group_id: r.muscle ? catalogId("muscle", r.muscle) : null,
    type: r.type,
    reason: r.reason,
    status: r.status,
    before_state: r.before,
    after_state: r.after,
    guideline_id: catalogId("guideline", r.guidelineKey),
    explanation: r.explanation,
    created_at: r.createdAt,
    resolved_at: r.resolvedAt,
  };
}

export function findPlanExercise(plan: StoredPlan, planExerciseId: string) {
  for (const day of plan.days) {
    const exercise = day.exercises.find((e) => e.id === planExerciseId);
    if (exercise) return { day, exercise };
  }
  return null;
}

export interface MesocyclePosition {
  /** Woche im laufenden Mesozyklus (1-basiert, höchstens mesocycleWeeks) */
  week: number;
  mesocycle: number;
  /** Mesozyklus vorbei → Auswertung fällig */
  due: boolean;
  deload: boolean;
}

export function mesocyclePosition(
  plan: Pick<StoredPlan, "cycleStartedAt" | "mesocycleWeeks" | "completedMesocycles" | "deloadWeekStart">,
  now: Date,
): MesocyclePosition {
  const weeks = Math.max(0, Math.floor((now.getTime() - Date.parse(plan.cycleStartedAt)) / WEEK_MS));
  const deload = isDeloadActive(plan, now);
  return {
    week: Math.min(weeks + 1, plan.mesocycleWeeks),
    mesocycle: plan.completedMesocycles + 1,
    due: !deload && weeks >= plan.mesocycleWeeks,
    deload,
  };
}

/** Planübung für die Deload-Woche: etwa halbe Sätze, RIR 3–4, keine Intensitätstechnik. */
export function deloadPrescription<T extends Pick<PlannedExercise, "sets" | "rirMin" | "rirMax" | "lastSetTechnique">>(e: T): T {
  return { ...e, sets: Math.max(1, Math.ceil(e.sets / 2)), rirMin: 3, rirMax: 4, lastSetTechnique: null };
}

/** Geplantes Volumen je Muskel neu berechnen (nach Satz- oder Übungsänderungen). */
function refreshVolume(plan: StoredPlan): StoredPlan {
  const planned = planVolume(plan.days);
  return {
    ...plan,
    days: plan.days.map((d) => ({ ...d, estimatedMinutes: estimateDayMinutes(d.exercises) })),
    volume: plan.volume.map((v) => {
      const plannedSets = Math.round((planned.get(v.muscle) ?? 0) * 10) / 10;
      const status = plannedSets < v.min - 0.5 ? "below" : plannedSets > v.max ? "above" : "ok";
      return { ...v, plannedSets, status };
    }),
  };
}

export { isDeloadActive };

// ─────────────────────────── Store ───────────────────────────

export function createPlanStore(deps: PlanStoreDeps) {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  return createStore<PlanState>()(
    persist(
      (set, get) => {
        const emit = (plan: StoredPlan | null, entry: NewOutboxEntry) => {
          if (plan?.userId) deps.sink(entry);
        };

        const updateExercise = (planExerciseId: string, change: (e: StoredPlanExercise) => StoredPlanExercise) => {
          const plan = get().plan;
          if (!plan) throw new Error("Kein aktiver Plan");
          let updated: { dayId: string; exercise: StoredPlanExercise } | null = null;
          const days = plan.days.map((day) => ({
            ...day,
            exercises: day.exercises.map((e) => {
              if (e.id !== planExerciseId) return e;
              const next = change(e);
              updated = { dayId: day.id, exercise: next };
              return next;
            }),
          }));
          if (!updated) throw new Error(`Planübung ${planExerciseId} nicht gefunden`);
          const nextPlan = { ...plan, days };
          set({ plan: nextPlan });
          const { dayId, exercise } = updated as { dayId: string; exercise: StoredPlanExercise };
          emit(nextPlan, { table: "plan_exercises", op: "upsert", rowId: exercise.id, payload: planExerciseRow(dayId, exercise) });
        };

        /** Mehrere Planübungen ändern, Volumen/Dauer neu berechnen, geänderte Zeilen synchronisieren. */
        const updateExercises = (changes: ReadonlyMap<string, (e: StoredPlanExercise) => StoredPlanExercise>) => {
          const plan = get().plan;
          if (!plan || changes.size === 0) return;
          const touched: { dayId: string; exercise: StoredPlanExercise }[] = [];
          const days = plan.days.map((day) => ({
            ...day,
            exercises: day.exercises.map((e) => {
              const change = changes.get(e.id);
              if (!change) return e;
              const next = change(e);
              touched.push({ dayId: day.id, exercise: next });
              return next;
            }),
          }));
          const nextPlan = refreshVolume({ ...plan, days });
          set({ plan: nextPlan });
          for (const { dayId, exercise } of touched)
            emit(nextPlan, { table: "plan_exercises", op: "upsert", rowId: exercise.id, payload: planExerciseRow(dayId, exercise) });
        };

        const setSets = (sets: Readonly<Record<string, number>>) =>
          updateExercises(new Map(Object.entries(sets).map(([id, n]) => [id, (e: StoredPlanExercise) => ({ ...e, sets: n })])));

        const record = (
          plan: StoredPlan,
          proposal: AdaptationProposal,
          planExerciseId: string | null,
          overrides: Partial<AdaptationRecord> = {},
        ): AdaptationRecord => {
          const stamp = now().toISOString();
          return {
            ...proposal,
            id: uuid(),
            planId: plan.id,
            planExerciseId,
            createdAt: stamp,
            resolvedAt: proposal.status === "suggested" ? null : stamp,
            ...overrides,
          };
        };

        const save = (r: AdaptationRecord) => {
          const exists = get().adaptations.some((a) => a.id === r.id);
          set({
            adaptations: exists
              ? get().adaptations.map((a) => (a.id === r.id ? r : a))
              : [r, ...get().adaptations].slice(0, 100),
          });
          const plan = get().plan;
          emit(plan, { table: "plan_adaptations", op: "upsert", rowId: r.id, payload: adaptationRow(plan?.userId ?? null, r) });
          return r;
        };

        /** Volumenänderung für einen Muskel auf die Planübungen verteilen; liefert before/after mit den Satzzahlen. */
        const applyVolume = (proposal: AdaptationProposal) => {
          const plan = get().plan!;
          const target = (proposal.after as { weekly_sets?: number }).weekly_sets;
          if (!proposal.muscle || target == null) return null;
          const changes: SetChange[] = distributeVolumeChange(plan, proposal.muscle as MuscleSlug, target);
          if (changes.length === 0) return null;
          setSets(Object.fromEntries(changes.map((c) => [c.planExerciseId, c.to])));
          const reached = Math.round((planVolume(get().plan!.days).get(proposal.muscle) ?? 0) * 10) / 10;
          return {
            before: { ...proposal.before, sets: Object.fromEntries(changes.map((c) => [c.planExerciseId, c.from])) },
            after: { weekly_sets: reached, sets: Object.fromEntries(changes.map((c) => [c.planExerciseId, c.to])) },
          };
        };

        /** Übung im Plan ersetzen; Vorgabe aus den Richtwerten der neuen Übung, Last neu ermitteln. */
        const applySwap = (planExerciseId: string, proposal: AdaptationProposal) => {
          const plan = get().plan!;
          const found = findPlanExercise(plan, planExerciseId);
          const replacement = getExercise(String((proposal.after as { exercise_slug?: string }).exercise_slug));
          if (!found || !replacement) return null;
          const previous = found.exercise;
          const technique =
            previous.lastSetTechnique && allowsTechnique(replacement, plan.goal, plan.experience) ? techniqueFor(replacement) : null;
          const next: StoredPlanExercise = {
            ...prescribe(replacement, plan.goal, plan.experience, { orderIndex: previous.orderIndex, sets: previous.sets, technique }),
            id: previous.id,
            targetLoadKg: null,
          };
          updateExercises(new Map([[planExerciseId, () => next]]));
          return { before: { ...proposal.before, plan_exercise: previous } };
        };

        const startDeload = (reason: AdaptationProposal["reason"]) => {
          const plan = get().plan!;
          const start = now();
          const before = {
            previous_last_deload_at: plan.lastDeloadAt,
            previous_deload_week_start: plan.deloadWeekStart,
            previous_cycle_started_at: plan.cycleStartedAt,
          };
          // Deload am Mesozyklus-Ende: der neue Zyklus beginnt nach der leichteren Woche
          const cycleStartedAt =
            reason === "mesocycle_end" ? new Date(start.getTime() + WEEK_MS).toISOString() : plan.cycleStartedAt;
          set({ plan: { ...plan, deloadWeekStart: start.toISOString(), lastDeloadAt: start.toISOString(), cycleStartedAt } });
          return before;
        };

        const accept = (r: AdaptationRecord): AdaptationRecord | null => {
          let before: Record<string, unknown> = r.before;
          let after: Record<string, unknown> = r.after;
          if (r.type === "swap_exercise") {
            if (!r.planExerciseId) return null;
            const result = applySwap(r.planExerciseId, r);
            if (!result) return null;
            before = result.before;
          } else if (r.type === "deload") {
            before = { ...r.before, ...startDeload(r.reason) };
          } else if (r.type === "add_set" || r.type === "remove_set") {
            const result = applyVolume(r);
            if (!result) return null;
            ({ before, after } = result);
          } else {
            return null;
          }
          return { ...r, before, after, status: "accepted", resolvedAt: now().toISOString() };
        };

        return {
          plan: null,
          adaptations: [],

          createPlan({ userId, assessment, generated, timezone }) {
            const previous = get().plan;
            const createdAt = now().toISOString();
            const plan: StoredPlan = {
              id: uuid(),
              userId,
              assessmentId: uuid(),
              parentPlanId: previous?.id ?? null,
              name: generated.name,
              splitType: generated.splitType,
              goal: generated.goal,
              experience: generated.experience,
              mesocycleWeeks: generated.mesocycleWeeks,
              generatorVersion: generated.generatorVersion,
              createdAt,
              startedAt: createdAt,
              volume: generated.volume,
              warnings: generated.warnings,
              assessment,
              nextDayIndex: 0,
              cycleStartedAt: createdAt,
              completedMesocycles: 0,
              deloadWeekStart: null,
              lastDeloadAt: null,
              days: generated.days.map((d) => ({
                id: uuid(),
                dayIndex: d.dayIndex,
                name: d.name,
                type: d.type,
                estimatedMinutes: d.estimatedMinutes,
                exercises: d.exercises.map((e) => ({ ...e, id: uuid(), targetLoadKg: null })),
              })),
            };
            set({ plan, adaptations: [] });

            if (userId) {
              // Reihenfolge: alter Plan archiviert (nur ein aktiver Plan je Nutzer) → Assessment →
              // Equipment → Plan → Tage → Übungen → Profil
              if (previous?.userId === userId) {
                deps.sink({ table: "training_plans", op: "upsert", rowId: previous.id, payload: planRow(previous, "archived") });
              }
              deps.sink({ table: "user_assessments", op: "upsert", rowId: plan.assessmentId, payload: assessmentRow(plan) });
              deps.sink({ table: "user_equipment", op: "delete", rowId: userId, payload: { user_id: userId } });
              for (const slug of assessment.equipment) {
                const equipmentId = catalogId("equipment", slug);
                deps.sink({
                  table: "user_equipment",
                  op: "upsert",
                  rowId: `${userId}:${equipmentId}`,
                  payload: { user_id: userId, equipment_id: equipmentId },
                });
              }
              deps.sink({ table: "training_plans", op: "upsert", rowId: plan.id, payload: planRow(plan, "active") });
              for (const day of plan.days) {
                deps.sink({
                  table: "plan_days",
                  op: "upsert",
                  rowId: day.id,
                  payload: { id: day.id, plan_id: plan.id, day_index: day.dayIndex, name: day.name, weekday: null },
                });
              }
              for (const day of plan.days)
                for (const e of day.exercises)
                  deps.sink({ table: "plan_exercises", op: "upsert", rowId: e.id, payload: planExerciseRow(day.id, e) });
              deps.sink({
                table: "profiles",
                op: "upsert",
                rowId: userId,
                payload: { id: userId, onboarding_completed_at: createdAt, ...(timezone ? { timezone } : {}) },
              });
            }
            return plan;
          },

          advanceDay(completedDayIndex) {
            const plan = get().plan;
            if (!plan) return;
            set({ plan: { ...plan, nextDayIndex: (completedDayIndex + 1) % plan.days.length } });
          },

          setTargetLoad(planExerciseId, loadKg) {
            updateExercise(planExerciseId, (e) => ({ ...e, targetLoadKg: loadKg }));
          },

          applyLoadChange(planExerciseId, proposal, loadKg) {
            const plan = get().plan;
            if (!plan) throw new Error("Kein aktiver Plan");
            updateExercise(planExerciseId, (e) => ({ ...e, targetLoadKg: loadKg }));
            return save(record(plan, proposal, planExerciseId));
          },

          revertAdaptation(adaptationId) {
            const plan = get().plan;
            const r = get().adaptations.find((a) => a.id === adaptationId);
            if (!plan || !r || r.planId !== plan.id || (r.status !== "auto_applied" && r.status !== "accepted")) return;
            const before = r.before as {
              target_load_kg?: number | null;
              sets?: Record<string, number>;
              plan_exercise?: StoredPlanExercise;
              previous_last_deload_at?: string | null;
              previous_deload_week_start?: string | null;
              previous_cycle_started_at?: string;
            };
            if ((r.type === "increase_load" || r.type === "decrease_load") && r.planExerciseId) {
              updateExercise(r.planExerciseId, (e) => ({ ...e, targetLoadKg: before.target_load_kg ?? null }));
            } else if ((r.type === "add_set" || r.type === "remove_set") && before.sets) {
              setSets(before.sets);
            } else if (r.type === "swap_exercise" && r.planExerciseId && before.plan_exercise) {
              const previous = before.plan_exercise;
              updateExercises(new Map([[r.planExerciseId, () => previous]]));
            } else if (r.type === "deload") {
              set({
                plan: {
                  ...plan,
                  deloadWeekStart: before.previous_deload_week_start ?? null,
                  lastDeloadAt: before.previous_last_deload_at ?? null,
                  cycleStartedAt: before.previous_cycle_started_at ?? plan.cycleStartedAt,
                },
              });
            } else {
              return;
            }
            save({ ...r, status: "reverted", resolvedAt: now().toISOString() });
          },

          addSuggestion({ proposal, planExerciseId }) {
            const plan = get().plan;
            if (!plan) return null;
            const duplicate = get().adaptations.some(
              (a) =>
                a.planId === plan.id &&
                a.status === "suggested" &&
                a.type === proposal.type &&
                a.planExerciseId === planExerciseId &&
                a.muscle === proposal.muscle,
            );
            if (duplicate) return null;
            return save(record(plan, { ...proposal, status: "suggested" }, planExerciseId));
          },

          acceptSuggestion(adaptationId) {
            const r = get().adaptations.find((a) => a.id === adaptationId);
            if (!get().plan || !r || r.status !== "suggested" || r.planId !== get().plan!.id) return;
            const accepted = accept(r);
            // Nicht mehr anwendbar (z. B. Übung schon ersetzt) → als abgelehnt schließen
            save(accepted ?? { ...r, status: "rejected", resolvedAt: now().toISOString() });
          },

          rejectSuggestion(adaptationId) {
            const r = get().adaptations.find((a) => a.id === adaptationId);
            if (!r || r.status !== "suggested") return;
            save({ ...r, status: "rejected", resolvedAt: now().toISOString() });
          },

          completeMesocycle({ volume, accepted, rejected }) {
            const plan = get().plan;
            if (!plan) throw new Error("Kein aktiver Plan");
            const records: AdaptationRecord[] = [];
            const reviewedAt = now().toISOString();
            set({ plan: { ...plan, cycleStartedAt: reviewedAt, completedMesocycles: plan.completedMesocycles + 1 } });

            // Abgelehnte zuerst speichern: Das Protokoll ist neueste-zuerst, Änderungen stehen so oben
            for (const s of rejected) {
              records.push(save(record(plan, { ...s.proposal, status: "rejected" }, s.planExerciseId)));
            }
            for (const proposal of volume) {
              const result = applyVolume(proposal);
              if (result) records.push(save(record(plan, { ...proposal, ...result, status: "auto_applied" }, null)));
            }
            for (const s of accepted) {
              const done = accept(record(plan, { ...s.proposal, status: "suggested" }, s.planExerciseId));
              if (done) records.push(save(done));
            }
            const current = get().plan!;
            emit(current, { table: "training_plans", op: "upsert", rowId: current.id, payload: planRow(current, "active") });
            return records;
          },

          clear() {
            set({ plan: null, adaptations: [] });
          },
        };
      },
      {
        name: "gym-active-plan",
        version: 2,
        // v1 → v2: Mesozyklus- und Deload-Felder
        migrate: (persisted, version) => {
          const state = persisted as { plan: (Partial<StoredPlan> & StoredPlan) | null; adaptations: AdaptationRecord[] };
          if (version < 2 && state.plan) {
            state.plan = {
              ...state.plan,
              cycleStartedAt: state.plan.cycleStartedAt ?? state.plan.startedAt,
              completedMesocycles: state.plan.completedMesocycles ?? 0,
              deloadWeekStart: state.plan.deloadWeekStart ?? null,
              lastDeloadAt: state.plan.lastDeloadAt ?? null,
            };
          }
          return state as unknown as PlanState;
        },
        storage: createJSONStorage(deps.storage ?? (() => localStorage)),
        partialize: (state) => ({ plan: state.plan, adaptations: state.adaptations }),
        skipHydration: true,
      },
    ),
  );
}

export type PlanStore = ReturnType<typeof createPlanStore>;
