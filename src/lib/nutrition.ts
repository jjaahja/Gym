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

/** Eiweiß hinzufügen (Schnelleintrag); macht den Tag zu einem manuellen Eintrag. */
export async function addProtein(
  db: GymDB,
  day: string,
  grams: number,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<NutritionDay | null> {
  const existing = await db.nutrition.get(day);
  const next = Math.max(0, (existing?.proteinG ?? 0) + grams);
  return saveNutrition(db, day, { proteinG: next > 0 ? next : null, source: "manual" }, options);
}

export interface ProteinStatus {
  today: number | null;
  target: { min: number; max: number } | null;
  /** Schnitt der Tage mit Eintrag in den letzten 7 Tagen (inkl. heute) */
  weekAverage: number | null;
  /** Tage im Zielbereich (oder darüber) / Tage mit Eintrag */
  daysOnTarget: number;
  daysLogged: number;
}

export function proteinStatus(days: readonly NutritionDay[], today: string, bodyWeightKg: number | null): ProteinStatus {
  const target = bodyWeightKg ? { min: proteinTarget(bodyWeightKg, PROTEIN_PER_KG.min), max: proteinTarget(bodyWeightKg, PROTEIN_PER_KG.max) } : null;
  const from = new Date(`${today}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 6);
  const week = days.filter((d) => d.day >= from.toISOString().slice(0, 10) && d.day <= today && d.proteinG != null);
  const avg = week.length ? Math.round(week.reduce((sum, d) => sum + d.proteinG!, 0) / week.length) : null;
  return {
    today: days.find((d) => d.day === today)?.proteinG ?? null,
    target,
    weekAverage: avg,
    daysOnTarget: target ? week.filter((d) => d.proteinG! >= target.min).length : 0,
    daysLogged: week.length,
  };
}

/**
 * Tageswerte aus Health Connect übernehmen (z. B. aus einer Ernährungs-App). Von Hand eingetragene Tage bleiben
 * unangetastet; unveränderte Tage erzeugen keinen Eintrag. Liefert die Zahl der geänderten Tage.
 */
export async function importNutritionDays(
  db: GymDB,
  incoming: readonly { day: string; proteinG: number | null; energyKcal: number | null }[],
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<number> {
  let changed = 0;
  for (const d of incoming) {
    if (d.proteinG == null && d.energyKcal == null) continue;
    const existing = await db.nutrition.get(d.day);
    if (existing?.source === "manual") continue;
    const proteinG = d.proteinG == null ? null : Math.round(d.proteinG * 10) / 10;
    const energyKcal = d.energyKcal == null ? null : Math.round(d.energyKcal);
    if (existing && existing.proteinG === proteinG && existing.energyKcal === energyKcal) continue;
    await saveNutrition(db, d.day, { proteinG, energyKcal, source: "health_connect" }, options);
    changed++;
  }
  return changed;
}
