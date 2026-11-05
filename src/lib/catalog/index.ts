import { EQUIPMENT, type EquipmentSlug } from "@/data/catalog/equipment";
import { EXERCISES, type ExerciseDefinition } from "@/data/catalog/exercises";
import { MUSCLE_GROUPS, type MuscleSlug } from "@/data/catalog/muscles";
import type {
  BodyRegion,
  ExerciseMechanic,
  ExerciseTracking,
  ExperienceLevel,
  Laterality,
  MovementPattern,
  MuscleRole,
  ResistanceProfile,
} from "@/lib/db/enums";
import { catalogId } from "@/lib/db/stable-id";

// Aufbereiteter, typisierter Katalog mit stabilen IDs – genutzt von UI, Plan-Generator und Seed.

export type { EquipmentSlug, MuscleSlug };

export interface MuscleGroup {
  id: string;
  slug: MuscleSlug;
  nameDe: string;
  nameEn: string;
  region: BodyRegion;
  sortOrder: number;
}

export interface Equipment {
  id: string;
  slug: EquipmentSlug;
  nameDe: string;
  nameEn: string;
}

export interface ExerciseMuscle {
  muscle: MuscleSlug;
  role: MuscleRole;
  contribution: number;
}

export interface Exercise {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string;
  description: string;
  instructions: string[];
  commonMistakes: string[];
  cues: string[];
  imageUrl: string | null;
  videoUrl: string | null;
  gifUrl: string | null;
  mechanic: ExerciseMechanic;
  movementPattern: MovementPattern;
  resistanceProfile: ResistanceProfile | null;
  laterality: Laterality;
  trackingType: ExerciseTracking;
  difficulty: ExperienceLevel;
  systemicFatigue: number;
  loadIncrementKg: number;
  muscles: ExerciseMuscle[];
  equipment: EquipmentSlug[];
}

/** Gewicht eines Sekundärmuskels bei der Volumenzählung (fraktionale Sätze). */
export const SECONDARY_CONTRIBUTION = 0.5;

function buildExercise(def: ExerciseDefinition): Exercise {
  return {
    id: catalogId("exercise", def.slug),
    slug: def.slug,
    nameDe: def.nameDe,
    nameEn: def.nameEn,
    description: def.description,
    instructions: def.steps,
    commonMistakes: def.mistakes,
    cues: def.cues,
    imageUrl: null,
    videoUrl: null,
    gifUrl: null,
    mechanic: def.mechanic,
    movementPattern: def.pattern,
    resistanceProfile: def.profile,
    laterality: def.laterality ?? "bilateral",
    trackingType: def.tracking ?? "weight_reps",
    difficulty: def.difficulty,
    systemicFatigue: def.fatigue,
    loadIncrementKg: def.increment,
    muscles: [
      ...def.primary.map((muscle) => ({ muscle, role: "primary" as const, contribution: 1 })),
      ...(def.secondary ?? []).map((muscle) => ({
        muscle,
        role: "secondary" as const,
        contribution: SECONDARY_CONTRIBUTION,
      })),
    ],
    equipment: def.equipment,
  };
}

export const muscleGroups: MuscleGroup[] = MUSCLE_GROUPS.map((m, i) => ({
  ...m,
  id: catalogId("muscle", m.slug),
  sortOrder: i,
}));

export const equipmentList: Equipment[] = EQUIPMENT.map((e) => ({ ...e, id: catalogId("equipment", e.slug) }));

export const exercises: Exercise[] = EXERCISES.map(buildExercise);

const exerciseBySlug = new Map(exercises.map((e) => [e.slug, e]));
const exerciseById = new Map(exercises.map((e) => [e.id, e]));
const muscleBySlug = new Map(muscleGroups.map((m) => [m.slug, m]));
const equipmentBySlug = new Map(equipmentList.map((e) => [e.slug, e]));

export const getExercise = (slug: string): Exercise | undefined => exerciseBySlug.get(slug);
export const getExerciseById = (id: string): Exercise | undefined => exerciseById.get(id);
export const getMuscle = (slug: MuscleSlug): MuscleGroup => muscleBySlug.get(slug)!;
export const getEquipment = (slug: EquipmentSlug): Equipment => equipmentBySlug.get(slug)!;

export const primaryMuscles = (exercise: Exercise): MuscleSlug[] =>
  exercise.muscles.filter((m) => m.role === "primary").map((m) => m.muscle);

const LEVEL_RANK: Record<ExperienceLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/** Übung ist für diese Erfahrungsstufe geeignet und mit dem vorhandenen Equipment machbar. */
export function isExerciseAvailable(
  exercise: Exercise,
  available: ReadonlySet<EquipmentSlug> | readonly EquipmentSlug[],
  experience: ExperienceLevel,
): boolean {
  const set = available instanceof Set ? available : new Set(available);
  return (
    LEVEL_RANK[exercise.difficulty] <= LEVEL_RANK[experience] && exercise.equipment.every((e) => set.has(e))
  );
}
