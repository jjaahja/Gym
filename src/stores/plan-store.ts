import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EquipmentSlug } from "@/data/catalog/equipment";
import type { TrackedMuscle } from "@/data/catalog/muscles";
import type { ExperienceLevel, PlanStatus, SplitType, TrainingGoal } from "@/lib/db/enums";
import { catalogId } from "@/lib/db/stable-id";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import type { DayType, GeneratedPlan, MuscleVolume, PlannedExercise } from "@/lib/training/plan-generator";
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
}

export interface AdaptationRecord extends AdaptationProposal {
  id: string;
  planId: string;
  planExerciseId: string | null;
  createdAt: string;
  resolvedAt: string | null;
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
  revertAdaptation(adaptationId: string): void;
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

/** Woche im aktuellen Mesozyklus (1-basiert) und Nummer des Mesozyklus. */
export function mesocyclePosition(plan: Pick<StoredPlan, "startedAt" | "mesocycleWeeks">, now: Date) {
  const weeks = Math.max(0, Math.floor((now.getTime() - Date.parse(plan.startedAt)) / (7 * 24 * 3600 * 1000)));
  return { week: (weeks % plan.mesocycleWeeks) + 1, mesocycle: Math.floor(weeks / plan.mesocycleWeeks) + 1 };
}

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
            const record: AdaptationRecord = {
              ...proposal,
              id: uuid(),
              planId: plan.id,
              planExerciseId,
              createdAt: now().toISOString(),
              resolvedAt: proposal.status === "auto_applied" ? now().toISOString() : null,
            };
            set({ adaptations: [record, ...get().adaptations].slice(0, 50) });
            emit(plan, { table: "plan_adaptations", op: "upsert", rowId: record.id, payload: adaptationRow(plan.userId, record) });
            return record;
          },

          revertAdaptation(adaptationId) {
            const plan = get().plan;
            const record = get().adaptations.find((a) => a.id === adaptationId);
            if (!plan || !record || record.status !== "auto_applied" || !record.planExerciseId) return;
            const previousLoad = (record.before as { target_load_kg?: number | null }).target_load_kg ?? null;
            updateExercise(record.planExerciseId, (e) => ({ ...e, targetLoadKg: previousLoad }));
            const reverted: AdaptationRecord = { ...record, status: "reverted", resolvedAt: now().toISOString() };
            set({ adaptations: get().adaptations.map((a) => (a.id === adaptationId ? reverted : a)) });
            emit(plan, { table: "plan_adaptations", op: "upsert", rowId: reverted.id, payload: adaptationRow(plan.userId, reverted) });
          },

          clear() {
            set({ plan: null, adaptations: [] });
          },
        };
      },
      {
        name: "gym-active-plan",
        version: 1,
        storage: createJSONStorage(deps.storage ?? (() => localStorage)),
        partialize: (state) => ({ plan: state.plan, adaptations: state.adaptations }),
        skipHydration: true,
      },
    ),
  );
}

export type PlanStore = ReturnType<typeof createPlanStore>;
