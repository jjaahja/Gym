interface EquipmentDefinition {
  slug: string;
  nameDe: string;
  nameEn: string;
}

// Bei Übungen wird nur das zwingend nötige Equipment eingetragen
// (z. B. Bulgarische Kniebeuge: Bank – Kurzhanteln sind optional).
export const EQUIPMENT = [
  { slug: "barbell", nameDe: "Langhantel", nameEn: "Barbell" },
  { slug: "dumbbell", nameDe: "Kurzhanteln", nameEn: "Dumbbells" },
  { slug: "ez_bar", nameDe: "SZ-Stange", nameEn: "EZ bar" },
  { slug: "bench", nameDe: "Hantelbank (verstellbar)", nameEn: "Adjustable bench" },
  { slug: "squat_rack", nameDe: "Kniebeugenständer / Rack", nameEn: "Squat rack" },
  { slug: "pullup_bar", nameDe: "Klimmzugstange", nameEn: "Pull-up bar" },
  { slug: "dip_station", nameDe: "Dip-Barren", nameEn: "Dip station" },
  { slug: "cable", nameDe: "Kabelzug (inkl. Latzug und Rudern)", nameEn: "Cable station" },
  { slug: "leg_press", nameDe: "Beinpresse", nameEn: "Leg press" },
  { slug: "leg_curl_machine", nameDe: "Beinbeuger-Maschine", nameEn: "Leg curl machine" },
  { slug: "leg_extension_machine", nameDe: "Beinstrecker-Maschine", nameEn: "Leg extension machine" },
  { slug: "chest_press_machine", nameDe: "Brustpresse", nameEn: "Chest press machine" },
  { slug: "pec_deck", nameDe: "Butterfly-Maschine", nameEn: "Pec deck" },
  { slug: "hip_machine", nameDe: "Abduktoren-/Adduktoren-Maschine", nameEn: "Hip abduction/adduction machine" },
  { slug: "calf_machine", nameDe: "Wadenmaschine", nameEn: "Calf raise machine" },
  { slug: "back_extension_bench", nameDe: "Hyperextension-Bank", nameEn: "Back extension bench" },
  { slug: "resistance_band", nameDe: "Widerstandsband", nameEn: "Resistance band" },
] as const satisfies readonly EquipmentDefinition[];

export type EquipmentSlug = (typeof EQUIPMENT)[number]["slug"];

/** Vorlagen für das Onboarding */
export const EQUIPMENT_PRESETS: Record<"gym" | "home_dumbbells" | "home_minimal", readonly EquipmentSlug[]> = {
  gym: EQUIPMENT.map((e) => e.slug),
  home_dumbbells: ["dumbbell", "bench", "pullup_bar", "resistance_band"],
  home_minimal: ["pullup_bar", "resistance_band"],
};
