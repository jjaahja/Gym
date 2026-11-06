import type { GymDB, Measurement } from "@/lib/offline/db";
import { saveMeasurement, type MeasurementInput } from "@/lib/offline/measurements";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { localDay } from "@/lib/training/schedule";

// Health Connect (Android): Gewicht und Körperfett aus anderen Apps (z. B. Withings-Waage, Samsung Health)
// in die Körpermaße übernehmen. Nur in der Android-App verfügbar – im Browser gibt es keine Schnittstelle.
// Regel: Health Connect liefert Gewicht und Körperfett; alle anderen Maße (Taille, Arm …) bleiben unberührt.
// Pro Tag zählt die letzte Messung.

export interface BodySample {
  value: number;
  /** ISO-Zeitpunkt der Messung */
  startDate: string;
}

export interface DayValues {
  bodyWeightKg?: number;
  bodyFatPercent?: number;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function lastPerDay(samples: readonly BodySample[]): Map<string, BodySample> {
  const byDay = new Map<string, BodySample>();
  for (const s of samples) {
    const day = localDay(new Date(s.startDate));
    const current = byDay.get(day);
    if (!current || s.startDate > current.startDate) byDay.set(day, s);
  }
  return byDay;
}

/** Messungen je Tag (lokale Zeit); unplausible Werte fallen weg (wie die CHECK-Constraints der Datenbank). */
export function samplesToDays(weight: readonly BodySample[], bodyFat: readonly BodySample[]): Map<string, DayValues> {
  const days = new Map<string, DayValues>();
  for (const [day, s] of lastPerDay(weight)) {
    if (s.value > 20 && s.value < 400) days.set(day, { ...days.get(day), bodyWeightKg: round(s.value, 2) });
  }
  for (const [day, s] of lastPerDay(bodyFat)) {
    // Health Connect liefert 0–100; ein Anteil (0–1) wird sicherheitshalber umgerechnet
    const percent = s.value <= 1 ? s.value * 100 : s.value;
    if (percent >= 2 && percent <= 70) days.set(day, { ...days.get(day), bodyFatPercent: round(percent, 1) });
  }
  return days;
}

const EMPTY: Omit<MeasurementInput, "measuredOn"> = {
  bodyWeightKg: null,
  bodyFatPercent: null,
  shouldersCm: null,
  chestCm: null,
  waistCm: null,
  hipsCm: null,
  armCm: null,
  thighCm: null,
  calfCm: null,
  notes: null,
};

/** Neue Werte für den Tag oder null, wenn sich nichts ändert. Andere Maße und Notizen bleiben erhalten. */
export function mergeDay(day: string, existing: Measurement | undefined, values: DayValues): MeasurementInput | null {
  const base: MeasurementInput = existing ? { ...existing, measuredOn: day } : { ...EMPTY, measuredOn: day };
  const next = {
    ...base,
    ...(values.bodyWeightKg != null ? { bodyWeightKg: values.bodyWeightKg } : {}),
    ...(values.bodyFatPercent != null ? { bodyFatPercent: values.bodyFatPercent } : {}),
  };
  if (existing && existing.bodyWeightKg === next.bodyWeightKg && existing.bodyFatPercent === next.bodyFatPercent) return null;
  delete (next as Partial<Measurement>).id;
  return next;
}

export interface ImportResult {
  /** Tage mit neuen oder geänderten Werten */
  updated: number;
  /** Tage mit Werten aus Health Connect */
  days: number;
}

/** Übernimmt die Tageswerte in die lokalen Körpermaße (und über die Outbox auf den Server). */
export async function importDays(
  db: GymDB,
  days: ReadonlyMap<string, DayValues>,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void },
): Promise<ImportResult> {
  let updated = 0;
  for (const [day, values] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = await db.measurements.where("measuredOn").equals(day).first();
    const input = mergeDay(day, existing, values);
    if (!input) continue;
    await saveMeasurement(db, input, options);
    updated++;
  }
  return { updated, days: days.size };
}

// ─────────────────────────── Anbindung an das Plugin (nur Android-App) ───────────────────────────

const STATE_KEY = "gym-health-connect";

export interface SyncState {
  connected: boolean;
  lastSync: string | null;
}

export function readState(): SyncState {
  try {
    return { connected: false, lastSync: null, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") };
  } catch {
    return { connected: false, lastSync: null };
  }
}

function writeState(state: SyncState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // ohne Speicher: nächster Start fragt erneut
  }
}

/** Läuft die App als Android-App (Capacitor)? Ohne das Plugin-Paket zu laden. */
export function isAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === "android");
}

// In ein Objekt verpackt: Ein Capacitor-Plugin ist ein Proxy, der auf jede Methode reagiert – auch auf `then`.
// Direkt aus einer async-Funktion zurückgegeben, hielte JavaScript es für ein Promise ("Health.then() is not implemented").
const loadPlugin = async () => ({ health: (await import("@capgo/capacitor-health")).Health });

export type Availability = { available: true } | { available: false; reason: string; installable: boolean };

/** Ist Health Connect auf dem Gerät nutzbar? Bis Android 13 ist es eine eigene App aus dem Play Store. */
export async function availability(): Promise<Availability> {
  if (!isAndroidApp()) return { available: false, reason: "Nur in der Android-App verfügbar.", installable: false };
  const { health } = await loadPlugin();
  const result = await health.isAvailable();
  if (result.available) return { available: true };
  if (result.reason?.includes("update")) {
    return { available: false, reason: "Health Connect muss installiert oder aktualisiert werden.", installable: true };
  }
  return { available: false, reason: "Health Connect wird auf diesem Gerät nicht unterstützt.", installable: false };
}

export const HEALTH_CONNECT_STORE_URL = "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";

/** Health-Connect-Einstellungen (Berechtigungen ändern oder entziehen). */
export async function openSettings(): Promise<void> {
  const { health } = await loadPlugin();
  await health.openHealthConnectSettings();
}

/** Automatischer Abgleich höchstens stündlich (App-Start, Rückkehr in die App). */
export function autoSyncDue(state: SyncState, now: Date, intervalMs = 60 * 60_000): boolean {
  return state.connected && (!state.lastSync || now.getTime() - Date.parse(state.lastSync) >= intervalMs);
}

/** Berechtigung anfragen (Gewicht, Körperfett, ältere Daten). true, wenn mindestens Gewicht erlaubt ist. */
export async function connect(): Promise<boolean> {
  const { health } = await loadPlugin();
  const status = await health.requestAuthorization({ read: ["weight", "bodyFat"], requestHistoryAccess: true });
  const ok = status.readAuthorized.includes("weight") || status.readAuthorized.includes("bodyFat");
  writeState({ ...readState(), connected: ok });
  return ok;
}

export function disconnect(): void {
  writeState({ connected: false, lastSync: null });
}

/** Neue Messungen holen: beim ersten Mal 90 Tage, danach ab dem letzten Abgleich (2 Tage Überlappung). */
export async function syncFromHealthConnect(
  db: GymDB,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<ImportResult> {
  const now = options.now ?? new Date();
  const state = readState();
  const from = state.lastSync ? new Date(Date.parse(state.lastSync) - 2 * 86_400_000) : new Date(now.getTime() - 90 * 86_400_000);
  const { health } = await loadPlugin();
  const query = (dataType: "weight" | "bodyFat") =>
    health.readSamples({ dataType, startDate: from.toISOString(), endDate: now.toISOString(), limit: 1000, ascending: true });
  const [weight, bodyFat] = await Promise.all([query("weight"), query("bodyFat").catch(() => ({ samples: [] }))]);
  const result = await importDays(db, samplesToDays(weight.samples, bodyFat.samples), options);
  writeState({ connected: true, lastSync: now.toISOString() });
  return result;
}
