import type { UnitSystem } from "@/lib/db/enums";

// Gewichte werden immer in kg gespeichert; lb ist reine Anzeige.
export const KG_PER_LB = 0.45359237;

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

/** Gewicht in der Anzeigeeinheit, auf 0,1 gerundet. */
export function toDisplayWeight(kg: number, unit: UnitSystem): number {
  const value = unit === "imperial" ? kgToLb(kg) : kg;
  return Math.round(value * 10) / 10;
}

/** Eingabe aus der UI → kg für die Datenbank (numeric(6,2)). */
export function fromDisplayWeight(value: number, unit: UnitSystem): number {
  const kg = unit === "imperial" ? lbToKg(value) : value;
  return Math.round(kg * 100) / 100;
}

export function weightUnitLabel(unit: UnitSystem): "kg" | "lb" {
  return unit === "imperial" ? "lb" : "kg";
}

export function formatWeight(kg: number, unit: UnitSystem): string {
  const value = toDisplayWeight(kg, unit);
  return `${value.toLocaleString("de-DE")} ${weightUnitLabel(unit)}`;
}
