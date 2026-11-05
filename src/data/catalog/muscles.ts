import type { BodyRegion } from "@/lib/db/enums";

interface MuscleGroupDefinition {
  slug: string;
  nameDe: string;
  nameEn: string;
  region: BodyRegion;
}

export const MUSCLE_GROUPS = [
  { slug: "chest", nameDe: "Brust", nameEn: "Chest", region: "upper" },
  { slug: "front_delts", nameDe: "Vordere Schulter", nameEn: "Front delts", region: "upper" },
  { slug: "side_delts", nameDe: "Seitliche Schulter", nameEn: "Side delts", region: "upper" },
  { slug: "rear_delts", nameDe: "Hintere Schulter", nameEn: "Rear delts", region: "upper" },
  { slug: "lats", nameDe: "Breiter Rückenmuskel (Latissimus)", nameEn: "Lats", region: "upper" },
  { slug: "upper_back", nameDe: "Oberer Rücken (Trapez, Rhomboiden)", nameEn: "Upper back", region: "upper" },
  { slug: "lower_back", nameDe: "Unterer Rücken (Rückenstrecker)", nameEn: "Lower back", region: "core" },
  { slug: "biceps", nameDe: "Bizeps", nameEn: "Biceps", region: "upper" },
  { slug: "triceps", nameDe: "Trizeps", nameEn: "Triceps", region: "upper" },
  { slug: "forearms", nameDe: "Unterarme", nameEn: "Forearms", region: "upper" },
  { slug: "abs", nameDe: "Bauch (gerade Bauchmuskeln)", nameEn: "Abs", region: "core" },
  { slug: "obliques", nameDe: "Seitliche Bauchmuskeln", nameEn: "Obliques", region: "core" },
  { slug: "glutes", nameDe: "Gesäß", nameEn: "Glutes", region: "lower" },
  { slug: "quads", nameDe: "Oberschenkelvorderseite (Quadrizeps)", nameEn: "Quads", region: "lower" },
  { slug: "hamstrings", nameDe: "Oberschenkelrückseite (Beinbeuger)", nameEn: "Hamstrings", region: "lower" },
  { slug: "adductors", nameDe: "Adduktoren", nameEn: "Adductors", region: "lower" },
  { slug: "calves", nameDe: "Waden", nameEn: "Calves", region: "lower" },
] as const satisfies readonly MuscleGroupDefinition[];

export type MuscleSlug = (typeof MUSCLE_GROUPS)[number]["slug"];

/**
 * Muskeln, für die der Plan-Generator ein eigenes Wochenvolumen anstrebt.
 * Die übrigen (vordere Schulter, Unterarme, unterer Rücken, seitlicher Bauch, Adduktoren)
 * bekommen bei Grund- und Zugübungen genug indirektes Volumen; gezieltes Training ist optional.
 */
export const TRACKED_MUSCLES = [
  "chest",
  "side_delts",
  "rear_delts",
  "lats",
  "upper_back",
  "biceps",
  "triceps",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "abs",
] as const satisfies readonly MuscleSlug[];

export type TrackedMuscle = (typeof TRACKED_MUSCLES)[number];
