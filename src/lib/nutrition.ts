import type { GymDB, NutritionDay } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";

// Ernährung je Tag: Protein (und optional Kalorien). Für Muskelaufbau 1,6–2,2 g Protein je kg Körpergewicht und Tag
// (Morton et al. 2018: Plateau des Zusatznutzens bei ~1,6 g/kg, obere Grenze des Konfidenzintervalls ~2,2 g/kg).

export const PROTEIN_PER_KG = { min: 1.6, max: 2.2 } as const;

/** Tagesziel in Gramm (gerundet auf 5 g) aus Körpergewicht und gewähltem Faktor. */
export function proteinTarget(bodyWeightKg: number, perKg: number): number {
  return Math.round((bodyWeightKg * perKg) / 5) * 5;
}

export async function saveNutrition(
  db: GymDB,
  day: string,
  values: { proteinG: number | null; energyKcal?: number | null; source?: NutritionDay["source"] },
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<NutritionDay | null> {
  const existing = await db.nutrition.get(day);
  const proteinG = values.proteinG == null ? null : Math.round(Math.min(1000, Math.max(0, values.proteinG)) * 10) / 10;
  const energyKcal =
    values.energyKcal === undefined ? (existing?.energyKcal ?? null) : values.energyKcal == null ? null : Math.round(Math.min(20000, Math.max(0, values.energyKcal)));
  const entry: NutritionDay = {
    day,
    proteinG,
    energyKcal,
    source: values.source ?? "manual",
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  if (entry.proteinG == null && entry.energyKcal == null) {
    await db.nutrition.delete(day);
    if (options.userId) options.sink({ table: "nutrition_days", op: "delete", rowId: day, payload: { user_id: options.userId, day } });
    return null;
  }
  await db.nutrition.put(entry);
  if (options.userId)
    options.sink({
      table: "nutrition_days",
      op: "upsert",
      rowId: day,
      payload: {
        user_id: options.userId,
        day,
        protein_g: entry.proteinG,
        energy_kcal: entry.energyKcal,
        source: entry.source,
        updated_at: entry.updatedAt,
      },
    });
  return entry;
}
