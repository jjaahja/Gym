import type { GymDB, Measurement } from "./db";
import type { NewOutboxEntry } from "./outbox";

// Körpermaße: lokal gespeichert (ein Eintrag pro Tag) und als body_measurements synchronisiert.

export type MeasurementInput = Omit<Measurement, "id">;

export const MEASURE_FIELDS = [
  { key: "bodyWeightKg", column: "body_weight_kg", label: "Körpergewicht", unit: "kg", max: 999.99, decimals: 2 },
  { key: "waistCm", column: "waist_cm", label: "Taille", unit: "cm", max: 999.9, decimals: 1 },
  { key: "armCm", column: "arm_cm", label: "Oberarm", unit: "cm", max: 999.9, decimals: 1 },
  { key: "shouldersCm", column: "shoulders_cm", label: "Schultern", unit: "cm", max: 999.9, decimals: 1 },
  { key: "chestCm", column: "chest_cm", label: "Brust", unit: "cm", max: 999.9, decimals: 1 },
  { key: "hipsCm", column: "hips_cm", label: "Hüfte", unit: "cm", max: 999.9, decimals: 1 },
  { key: "thighCm", column: "thigh_cm", label: "Oberschenkel", unit: "cm", max: 999.9, decimals: 1 },
  { key: "calfCm", column: "calf_cm", label: "Wade", unit: "cm", max: 999.9, decimals: 1 },
  { key: "bodyFatPercent", column: "body_fat_percent", label: "Körperfett", unit: "%", max: 70, decimals: 1 },
] as const;

export type MeasureKey = (typeof MEASURE_FIELDS)[number]["key"];

/** Prüft wie die CHECK-Constraints der Tabelle body_measurements. */
export function validateMeasurement(input: MeasurementInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.measuredOn)) return "Ungültiges Datum";
  const values = MEASURE_FIELDS.map((f) => input[f.key]);
  if (values.every((v) => v == null)) return "Bitte mindestens einen Wert eintragen";
  for (const f of MEASURE_FIELDS) {
    const v = input[f.key];
    if (v == null) continue;
    if (!(v > 0 && v <= f.max)) return `${f.label}: Wert außerhalb des gültigen Bereichs`;
    if (f.key === "bodyFatPercent" && v < 2) return "Körperfett: mindestens 2 %";
  }
  return null;
}

function toRow(userId: string, m: Measurement) {
  return {
    id: m.id,
    user_id: userId,
    measured_on: m.measuredOn,
    ...Object.fromEntries(MEASURE_FIELDS.map((f) => [f.column, m[f.key] ?? null])),
    notes: m.notes?.trim() || null,
  };
}

export async function saveMeasurement(
  db: GymDB,
  input: MeasurementInput,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; uuid?: () => string },
): Promise<Measurement> {
  // Auf die Nachkommastellen der Spalten runden (numeric(5,2) bzw. (x,1)) – lokal wie auf dem Server
  input = {
    ...input,
    ...Object.fromEntries(
      MEASURE_FIELDS.map((f) => [f.key, input[f.key] == null ? null : Math.round(input[f.key]! * 10 ** f.decimals) / 10 ** f.decimals]),
    ),
  };
  const error = validateMeasurement(input);
  if (error) throw new RangeError(error);
  // Ein Eintrag pro Tag (unique(user_id, measured_on)) → bestehende ID weiterverwenden
  const existing = await db.measurements.where("measuredOn").equals(input.measuredOn).first();
  const measurement: Measurement = { ...input, id: existing?.id ?? (options.uuid ?? (() => crypto.randomUUID()))() };
  await db.measurements.put(measurement);
  if (options.userId) {
    options.sink({ table: "body_measurements", op: "upsert", rowId: measurement.id, payload: toRow(options.userId, measurement) });
  }
  return measurement;
}

export async function deleteMeasurement(
  db: GymDB,
  id: string,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void },
): Promise<void> {
  await db.measurements.delete(id);
  if (options.userId) options.sink({ table: "body_measurements", op: "delete", rowId: id, payload: { id } });
}

export async function listMeasurements(db: GymDB): Promise<Measurement[]> {
  return db.measurements.orderBy("measuredOn").toArray();
}
