import { create } from "zustand";
import { getDb, type GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { writeToOutbox } from "@/lib/offline/sink";
import { importNutritionDays } from "@/lib/nutrition";
import type { DayValue } from "@/lib/recovery";
import { getCurrentUserId } from "@/lib/supabase/client";
import { gymHealthPlugin } from "./gym-health-plugin";
import { isAndroidApp } from "./health-connect";

// Health Connect (ab App 1.3): Ernährung (Eiweiß, Kalorien), Schlaf und Ruhepuls lesen – als Tageswerte.
// Ernährung landet wie selbst eingetragen in „nutrition_days“ (Quelle health_connect, eigene Einträge haben Vorrang).
// Schlaf und Ruhepuls bleiben nur auf diesem Gerät (für den Erholungshinweis) – sie werden nicht hochgeladen.

export type ExtraType = "nutrition" | "sleep" | "restingHeartRate";
export const EXTRA_TYPES: readonly ExtraType[] = ["nutrition", "sleep", "restingHeartRate"];
export const EXTRA_LABELS: Record<ExtraType, string> = { nutrition: "Ernährung (Eiweiß, Kalorien)", sleep: "Schlaf", restingHeartRate: "Ruhepuls" };
export type ExtrasStatus = Record<ExtraType, boolean>;

export interface DailyHealth {
  nutrition?: { day: string; proteinG?: number | null; energyKcal?: number | null }[];
  sleep?: { day: string; minutes: number }[];
  restingHeartRate?: { day: string; bpm: number }[];
}

interface ExtrasPlugin {
  checkReadPermissions(): Promise<ExtrasStatus>;
  requestReadPermissions(options: { types: ExtraType[] }): Promise<ExtrasStatus>;
  readDaily(options: { days: number }): Promise<DailyHealth>;
}

async function plugin(): Promise<{ available: boolean; p: ExtrasPlugin }> {
  const { available, plugin: p } = await gymHealthPlugin<ExtrasPlugin>();
  return { available, p };
}

const KEY = "gym-health-extras";
export interface ExtrasCache {
  status: ExtrasStatus | null;
  lastRead: string | null;
  sleep: DayValue[];
  restingHr: DayValue[];
}
const EMPTY: ExtrasCache = { status: null, lastRead: null, sleep: [], restingHr: [] };

export function readCache(): ExtrasCache {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return EMPTY;
  }
}
function writeCache(cache: ExtrasCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // ohne Speicher: beim nächsten Öffnen neu lesen
  }
}

/** Übernimmt gelesene Tageswerte: Ernährung in die Datenbank, Schlaf/Ruhepuls in den Gerätespeicher. */
export async function applyDaily(
  db: GymDB,
  daily: DailyHealth,
  cache: ExtrasCache,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<{ cache: ExtrasCache; nutritionChanged: number }> {
  const nutritionChanged = daily.nutrition
    ? await importNutritionDays(
        db,
        daily.nutrition.map((n) => ({ day: n.day, proteinG: n.proteinG ?? null, energyKcal: n.energyKcal ?? null })),
        options,
      )
    : 0;
  const next: ExtrasCache = {
    ...cache,
    lastRead: (options.now ?? new Date()).toISOString(),
    sleep: daily.sleep ? daily.sleep.map((s) => ({ day: s.day, value: s.minutes })) : cache.sleep,
    restingHr: daily.restingHeartRate ? daily.restingHeartRate.map((r) => ({ day: r.day, value: r.bpm })) : cache.restingHr,
  };
  return { cache: next, nutritionChanged };
}

interface ExtrasState extends ExtrasCache {
  /** null = noch nicht geprüft; false = Browser oder App-Version ohne diese Funktion */
  supported: boolean | null;
  reading: boolean;
  error: string | null;
  load(): Promise<void>;
  enable(): Promise<void>;
  refresh(force?: boolean): Promise<void>;
}

const anyGranted = (s: ExtrasStatus | null) => Boolean(s && EXTRA_TYPES.some((t) => s[t]));

export const useHealthExtras = create<ExtrasState>((set, get) => ({
  ...EMPTY,
  supported: null,
  reading: false,
  error: null,

  async load() {
    set({ ...readCache() });
    if (!isAndroidApp()) return set({ supported: false });
    try {
      const { available, p } = await plugin();
      if (!available) return set({ supported: false });
      // App 1.2 kennt die Methode nicht → nicht unterstützt
      const status = await p.checkReadPermissions();
      set({ supported: true, status });
      writeCache({ ...readCache(), status });
    } catch {
      set({ supported: false });
    }
  },

  async enable() {
    set({ error: null });
    try {
      const { p } = await plugin();
      const status = await p.requestReadPermissions({ types: [...EXTRA_TYPES] });
      set({ status });
      writeCache({ ...readCache(), status });
      if (!anyGranted(status)) return set({ error: "Keine Berechtigung erteilt – du kannst sie in Health Connect erlauben." });
      await get().refresh(true);
    } catch {
      set({ error: "Health Connect ist nicht erreichbar." });
    }
  },

  async refresh(force = false) {
    const { supported, status, lastRead, reading } = get();
    if (!supported || !anyGranted(status) || reading) return;
    // höchstens alle 30 Minuten automatisch
    if (!force && lastRead && Date.now() - Date.parse(lastRead) < 30 * 60_000) return;
    set({ reading: true, error: null });
    try {
      const { p } = await plugin();
      const daily = await p.readDaily({ days: 21 });
      const { cache } = await applyDaily(getDb(), daily, readCache(), { userId: await getCurrentUserId(), sink: writeToOutbox });
      writeCache(cache);
      set({ ...cache });
    } catch {
      set({ error: "Lesen aus Health Connect fehlgeschlagen." });
    } finally {
      set({ reading: false });
    }
  },
}));
