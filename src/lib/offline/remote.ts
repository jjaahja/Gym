import type { SupabaseClient } from "@supabase/supabase-js";
import type { EquipmentSlug } from "@/data/catalog/equipment";
import type { MuscleSlug, TrackedMuscle } from "@/data/catalog/muscles";
import { GUIDELINES } from "@/data/science/guidelines";
import { equipmentList, getExerciseById, muscleGroups } from "@/lib/catalog";
import type {
  AdaptationReason,
  AdaptationStatus,
  AdaptationType,
  EffortScale,
  ExperienceLevel,
  ProgressionScheme,
  SetType,
  SplitType,
  TrainingGoal,
  UnitSystem,
} from "@/lib/db/enums";
import { catalogId } from "@/lib/db/stable-id";
import { resolveExerciseGuidelines } from "@/lib/science";
import type { DayType, MuscleVolume } from "@/lib/training/plan-generator";
import type { Weekday } from "@/lib/training/schedule";
import { withPlannedVolume, type AdaptationRecord, type StoredPlan, type StoredPlanExercise } from "@/stores/plan-store";
import type { CompletedSession, Measurement } from "./db";
import { MEASURE_FIELDS } from "./measurements";

// Server → Gerät: Zeilen so, wie PostgREST/Supabase sie liefert (snake_case, Zeitstempel mit „+00:00“,
// numeric als Zahl), und ihre Umwandlung in den lokalen Zustand. Gegenstück zu den *Row-Funktionen der Stores.

type Id = string;
type Timestamp = string;

export interface RemotePlanExercise {
  id: Id;
  exercise_id: Id;
  order_index: number;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  target_rir_min: number;
  target_rir_max: number;
  target_load_kg: number | null;
  rest_seconds: number;
  progression_scheme: ProgressionScheme;
  last_set_technique: SetType | null;
}

export interface RemotePlanDay {
  id: Id;
  day_index: number;
  name: string;
  day_type: DayType | null;
  weekday: number | null;
  plan_exercises: RemotePlanExercise[];
}

export interface RemoteMuscleTarget {
  muscle_group_id: Id;
  target_sets: number;
  min: number;
  max: number;
  frequency: number;
  priority: boolean;
}

export interface RemotePlan {
  id: Id;
  user_id: Id;
  assessment_id: Id | null;
  parent_plan_id: Id | null;
  name: string;
  split_type: SplitType;
  goal: TrainingGoal;
  status: string;
  mesocycle_weeks: number;
  generator_version: string | null;
  started_at: Timestamp | null;
  created_at: Timestamp;
  next_day_index: number;
  cycle_started_at: Timestamp | null;
  completed_mesocycles: number;
  deload_week_start: Timestamp | null;
  last_deload_at: Timestamp | null;
  warnings: string[] | null;
  muscle_targets: RemoteMuscleTarget[] | null;
  plan_days: RemotePlanDay[];
}

export interface RemoteAssessment {
  id: Id;
  goal: TrainingGoal;
  experience_level: ExperienceLevel;
  training_age_months: number | null;
  days_per_week: number;
  session_duration_min: number;
  preferred_split: SplitType | null;
  priority_muscle_ids: Id[] | null;
  limitations: string | null;
}

export interface RemoteAdaptation {
  id: Id;
  plan_id: Id;
  plan_exercise_id: Id | null;
  muscle_group_id: Id | null;
  type: AdaptationType;
  reason: AdaptationReason;
  status: AdaptationStatus;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  guideline_id: Id | null;
  explanation: string;
  created_at: Timestamp;
  resolved_at: Timestamp | null;
}

export interface RemoteSetLog {
  id: Id;
  set_index: number;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  rir: number | null;
  is_completed: boolean;
}

export interface RemoteExerciseLog {
  id: Id;
  exercise_id: Id;
  plan_exercise_id: Id | null;
  order_index: number;
  pump_rating: number | null;
  joint_discomfort: number | null;
  set_logs: RemoteSetLog[];
}

export interface RemoteSession {
  id: Id;
  plan_id: Id | null;
  plan_day_id: Id | null;
  status: string;
  started_at: Timestamp;
  ended_at: Timestamp | null;
  session_rpe: number | null;
  is_deload: boolean | null;
  exercise_logs: RemoteExerciseLog[];
}

export type RemoteMeasurement = { id: Id; measured_on: string; notes: string | null } & Record<string, unknown>;

export interface RemoteProfile {
  unit_system: UnitSystem;
  effort_scale: EffortScale;
}

/** Alles, was ein Gerät für den Start braucht. */
export interface RemoteState {
  profile: RemoteProfile | null;
  plan: RemotePlan | null;
  assessment: RemoteAssessment | null;
  equipmentIds: Id[];
  adaptations: RemoteAdaptation[];
  sessions: RemoteSession[];
  measurements: RemoteMeasurement[];
}

// ─────────────────────────── Zuordnung Katalog-ID → Slug ───────────────────────────

const muscleById = new Map(muscleGroups.map((m) => [m.id, m.slug]));
const equipmentOrder = new Map(equipmentList.map((e, i) => [e.id, i]));
const equipmentById = new Map(equipmentList.map((e) => [e.id, e.slug]));
const guidelineById = new Map(GUIDELINES.map((g) => [catalogId("guideline", g.key), g.key]));

const iso = (value: Timestamp | null | undefined): string | null => (value == null ? null : new Date(value).toISOString());
const num = (value: unknown): number | null => (value == null ? null : Number(value));

// ─────────────────────────── Plan ───────────────────────────

function planExercise(row: RemotePlanExercise, goal: TrainingGoal, experience: ExperienceLevel): StoredPlanExercise | null {
  const exercise = getExerciseById(row.exercise_id);
  if (!exercise) return null;
  const r = resolveExerciseGuidelines(exercise, goal, experience);
  return {
    exerciseId: exercise.id,
    exerciseSlug: exercise.slug,
    orderIndex: row.order_index,
    sets: row.target_sets,
    repsMin: row.target_reps_min,
    repsMax: row.target_reps_max,
    rirMin: Number(row.target_rir_min),
    rirMax: Number(row.target_rir_max),
    restSeconds: row.rest_seconds,
    lastSetTechnique: row.last_set_technique,
    progressionScheme: row.progression_scheme,
    // wie bei der Generierung: Richtwerte, aus denen die Vorgabe stammt
    guidelineKeys: [r.rep_range, r.proximity_to_failure, r.rest_interval, r.intensity_technique].flatMap((g) => (g ? [g.key] : [])),
    id: row.id,
    targetLoadKg: num(row.target_load_kg),
  };
}

/** Plan aus Server-Zeilen wiederherstellen (inkl. Zielvolumen, Dauer und geplantem Volumen). */
export function planFromRemote(
  row: RemotePlan,
  assessment: RemoteAssessment,
  equipmentIds: readonly Id[],
): StoredPlan {
  const experience = assessment.experience_level;
  const volume: MuscleVolume[] = (row.muscle_targets ?? []).flatMap((t) => {
    const muscle = muscleById.get(t.muscle_group_id);
    if (!muscle) return [];
    return [
      {
        muscle: muscle as TrackedMuscle,
        plannedSets: 0,
        targetSets: Number(t.target_sets),
        min: Number(t.min),
        max: Number(t.max),
        frequency: Number(t.frequency),
        priority: Boolean(t.priority),
        status: "ok" as const,
      },
    ];
  });
  const plan: StoredPlan = {
    id: row.id,
    userId: row.user_id,
    assessmentId: assessment.id,
    parentPlanId: row.parent_plan_id,
    name: row.name,
    splitType: row.split_type,
    goal: row.goal,
    experience,
    mesocycleWeeks: row.mesocycle_weeks,
    generatorVersion: row.generator_version ?? "",
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at ?? row.created_at)!,
    days: [...row.plan_days]
      .sort((a, b) => a.day_index - b.day_index)
      .map((d) => ({
        id: d.id,
        dayIndex: d.day_index,
        name: d.name,
        type: d.day_type ?? "full_a",
        weekday: (d.weekday as Weekday | null) ?? null,
        estimatedMinutes: 0,
        exercises: [...d.plan_exercises]
          .sort((a, b) => a.order_index - b.order_index)
          .flatMap((e) => planExercise(e, row.goal, experience) ?? []),
      })),
    volume,
    warnings: row.warnings ?? [],
    assessment: {
      goal: assessment.goal,
      experience,
      trainingAgeMonths: assessment.training_age_months,
      daysPerWeek: assessment.days_per_week,
      sessionDurationMin: assessment.session_duration_min,
      preferredSplit: assessment.preferred_split,
      priorityMuscles: (assessment.priority_muscle_ids ?? []).flatMap((id) => {
        const slug = muscleById.get(id);
        return slug ? [slug as TrackedMuscle] : [];
      }),
      equipment: [...equipmentIds]
        .filter((id) => equipmentById.has(id))
        .sort((a, b) => equipmentOrder.get(a)! - equipmentOrder.get(b)!)
        .map((id) => equipmentById.get(id)! as EquipmentSlug),
      limitations: assessment.limitations ?? "",
    },
    nextDayIndex: row.next_day_index ?? 0,
    cycleStartedAt: iso(row.cycle_started_at ?? row.started_at ?? row.created_at)!,
    completedMesocycles: row.completed_mesocycles ?? 0,
    deloadWeekStart: iso(row.deload_week_start),
    lastDeloadAt: iso(row.last_deload_at),
  };
  // Geplantes Volumen und Dauer aus den Übungen – wie nach jeder Änderung auf dem Gerät
  return withPlannedVolume(plan);
}

export function adaptationFromRemote(row: RemoteAdaptation): AdaptationRecord | null {
  const guidelineKey = row.guideline_id ? guidelineById.get(row.guideline_id) : undefined;
  if (!guidelineKey) return null;
  const muscle = row.muscle_group_id ? (muscleById.get(row.muscle_group_id) as MuscleSlug | undefined) : undefined;
  return {
    id: row.id,
    planId: row.plan_id,
    planExerciseId: row.plan_exercise_id,
    type: row.type,
    reason: row.reason,
    status: row.status,
    ...(muscle ? { muscle } : {}),
    before: row.before_state ?? {},
    after: row.after_state ?? {},
    guidelineKey,
    explanation: row.explanation,
    createdAt: iso(row.created_at)!,
    resolvedAt: iso(row.resolved_at),
  };
}

// ─────────────────────────── Trainings & Körpermaße ───────────────────────────

/** Abgeschlossenes Training wie `finish()` es lokal speichert: nur erledigte Sätze und Übungen mit Sätzen. */
export function sessionFromRemote(row: RemoteSession): CompletedSession | null {
  if (row.status !== "completed" || !row.ended_at) return null;
  const exercises = [...row.exercise_logs]
    .sort((a, b) => a.order_index - b.order_index)
    .map((e) => ({
      logId: e.id,
      exerciseId: e.exercise_id,
      planExerciseId: e.plan_exercise_id,
      pumpRating: e.pump_rating,
      jointDiscomfort: e.joint_discomfort,
      sets: [...e.set_logs]
        .filter((s) => s.is_completed)
        .sort((a, b) => a.set_index - b.set_index)
        .map((s) => ({
          id: s.id,
          setIndex: s.set_index,
          setType: s.set_type,
          weightKg: num(s.weight_kg),
          reps: s.reps,
          durationSeconds: s.duration_seconds,
          rir: num(s.rir),
        })),
    }))
    .filter((e) => e.sets.length > 0);
  return {
    id: row.id,
    planId: row.plan_id,
    planDayId: row.plan_day_id,
    startedAt: iso(row.started_at)!,
    endedAt: iso(row.ended_at)!,
    sessionRpe: num(row.session_rpe),
    ...(row.is_deload ? { deload: true } : {}),
    exerciseIds: [...new Set(exercises.map((e) => e.exerciseId))],
    exercises,
  };
}

export function measurementFromRemote(row: RemoteMeasurement): Measurement {
  return {
    id: row.id,
    measuredOn: row.measured_on,
    ...(Object.fromEntries(MEASURE_FIELDS.map((f) => [f.key, num(row[f.column])])) as Pick<
      Measurement,
      (typeof MEASURE_FIELDS)[number]["key"]
    >),
    notes: row.notes,
  };
}

// ─────────────────────────── Abruf ───────────────────────────

const PAGE = 500;

async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Liest den Stand des angemeldeten Nutzers (RLS beschränkt auf eigene Zeilen). */
export async function fetchRemoteState(client: SupabaseClient, userId: string): Promise<RemoteState> {
  const check = <T>(result: { data: T; error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  const [profile, plan, equipment, measurements, sessions] = await Promise.all([
    client.from("profiles").select("unit_system, effort_scale").eq("id", userId).maybeSingle().then(check),
    client
      .from("training_plans")
      .select("*, plan_days(*, plan_exercises(*))")
      .eq("status", "active")
      .maybeSingle()
      .then(check),
    client.from("user_equipment").select("equipment_id").then(check),
    all<RemoteMeasurement>((from, to) => client.from("body_measurements").select("*").order("measured_on").range(from, to)),
    all<RemoteSession>((from, to) =>
      client
        .from("workout_sessions")
        .select("id, plan_id, plan_day_id, status, started_at, ended_at, session_rpe, is_deload, exercise_logs(*, set_logs(*))")
        .eq("status", "completed")
        .order("started_at")
        .range(from, to),
    ),
  ]);

  const remotePlan = plan as RemotePlan | null;
  const [assessment, adaptations] = remotePlan
    ? await Promise.all([
        remotePlan.assessment_id
          ? client.from("user_assessments").select("*").eq("id", remotePlan.assessment_id).maybeSingle().then(check)
          : Promise.resolve(null),
        all<RemoteAdaptation>((from, to) =>
          client.from("plan_adaptations").select("*").eq("plan_id", remotePlan.id).order("created_at", { ascending: false }).range(from, to),
        ),
      ])
    : [null, []];

  return {
    profile: profile as RemoteProfile | null,
    plan: remotePlan,
    assessment: assessment as RemoteAssessment | null,
    equipmentIds: ((equipment ?? []) as { equipment_id: string }[]).map((e) => e.equipment_id),
    adaptations: adaptations as RemoteAdaptation[],
    sessions,
    measurements,
  };
}
