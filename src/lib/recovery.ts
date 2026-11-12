// Erholungshinweis aus Health Connect: Schlaf der letzten Nacht und Ruhepuls im Vergleich zum eigenen Schnitt.
// Nur ein Hinweis, keine Diagnose – und keine automatische Planänderung.
// Schlafmangel verschlechtert die Leistung (im Mittel −7,6 %), vor allem bei Schlafentzug oder spät verkürzter Nacht
// und bei Training am Abend; morgens war die Leistung weitgehend unverändert (Craven et al. 2022, Meta-Analyse,
// DOI 10.1007/s40279-022-01706-y). Ein deutlich erhöhter Ruhepuls kann auf unvollständige Erholung oder einen
// beginnenden Infekt hindeuten – das ist ein Erfahrungswert, kein harter Grenzwert.

export interface DayValue {
  /** YYYY-MM-DD (Schlaf: Tag des Aufwachens) */
  day: string;
  value: number;
}

export interface Recovery {
  sleep: { minutes: number; baseline: number | null; short: boolean } | null;
  restingHr: { bpm: number; baseline: number; delta: number; high: boolean } | null;
  level: "ok" | "reduced" | "low";
  advice: string;
}

export const SHORT_SLEEP_MIN = 6 * 60;
export const SLEEP_DROP_MIN = 90;
export const RHR_RISE_BPM = 5;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const window14 = (values: readonly DayValue[], today: string) => {
  const from = addDays(today, -14);
  return values.filter((v) => v.day < today && v.day >= from && v.value > 0).map((v) => v.value);
};

export function assessRecovery(sleep: readonly DayValue[], restingHr: readonly DayValue[], today: string): Recovery | null {
  const night = sleep.find((s) => s.day === today && s.value > 0);
  const sleepBase = window14(sleep, today);
  const sleepResult = night
    ? (() => {
        const baseline = sleepBase.length >= 4 ? Math.round(median(sleepBase)) : null;
        return { minutes: night.value, baseline, short: night.value < SHORT_SLEEP_MIN || (baseline != null && night.value < baseline - SLEEP_DROP_MIN) };
      })()
    : null;

  // Ruhepuls von heute, sonst von gestern (manche Uhren berechnen ihn erst im Laufe des Tages)
  const rhrToday = restingHr.find((r) => r.day === today && r.value > 0) ?? restingHr.find((r) => r.day === addDays(today, -1) && r.value > 0);
  const rhrBase = rhrToday ? window14(restingHr, rhrToday.day) : [];
  const rhrResult =
    rhrToday && rhrBase.length >= 5
      ? (() => {
          const baseline = Math.round((rhrBase.reduce((a, b) => a + b, 0) / rhrBase.length) * 10) / 10;
          const delta = Math.round((rhrToday.value - baseline) * 10) / 10;
          return { bpm: Math.round(rhrToday.value), baseline, delta, high: delta >= RHR_RISE_BPM };
        })()
      : null;

  if (!sleepResult && !rhrResult) return null;
  const flags = [sleepResult?.short, rhrResult?.high].filter(Boolean).length;
  const level = flags === 0 ? "ok" : flags === 1 ? "reduced" : "low";
  const advice =
    level === "ok"
      ? "Gut erholt – trainiere wie geplant."
      : level === "low"
        ? "Wenig Schlaf und erhöhter Ruhepuls: Heute eher locker – 1 Satz weniger pro Übung und 1–2 Wdh. mehr im Tank. Ein leichteres Training kostet kaum Fortschritt. Bei Krankheitszeichen lieber pausieren."
        : sleepResult?.short
          ? "Wenig Schlaf: Die Leistung kann heute geringer sein, vor allem abends. Gewichte nicht erzwingen – lieber 1 Wdh. mehr im Tank. Wenn möglich, früher am Tag trainieren."
          : "Ruhepuls über deinem Schnitt: Das kann auf unvollständige Erholung oder einen beginnenden Infekt hindeuten. Hör auf dein Gefühl – bei Krankheitszeichen lieber pausieren.";
  return { sleep: sleepResult, restingHr: rhrResult, level, advice };
}

export const formatSleep = (minutes: number) => `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")} min`;
