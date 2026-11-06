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

// Längen (Körpermaße) werden in cm gespeichert; Zoll ist reine Anzeige.
export const CM_PER_INCH = 2.54;

export function lengthUnitLabel(unit: UnitSystem): "cm" | "in" {
  return unit === "imperial" ? "in" : "cm";
}

export function toDisplayLength(cm: number, unit: UnitSystem): number {
  return Math.round((unit === "imperial" ? cm / CM_PER_INCH : cm) * 10) / 10;
}

export function fromDisplayLength(value: number, unit: UnitSystem): number {
  return Math.round((unit === "imperial" ? value * CM_PER_INCH : value) * 10) / 10;
}
