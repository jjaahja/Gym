// Anzeigeformate für die Verlaufsansichten.

export const num = (n: number, digits = 1) => n.toLocaleString("de-DE", { maximumFractionDigits: digits });

export const signed = (n: number, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${num(Math.abs(n), digits)}`;

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });

export const formatDateMedium = (ms: number) => new Date(ms).toLocaleDateString("de-DE", { day: "numeric", month: "short" });

export const formatDateShort = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
};

/** YYYY-MM-DD in lokaler Zeit (für Körpermaße). */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD → ms (lokale Mitternacht). */
export const dayToMs = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

export const shortMuscleName = (name: string) => name.replace(/ \(.*\)$/, "");
