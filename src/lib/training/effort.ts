import type { EffortScale } from "@/lib/db/enums";

// Anstrengung wird immer als RIR (Wiederholungen im Tank) gespeichert.
// Anzeige wahlweise als RPE nach der RIR-basierten RPE-Skala:
// RPE = 10 − RIR (Zourdos et al. 2016; Helms et al. 2016).

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function rirToRpe(rir: number): number {
  return clamp(10 - rir, 1, 10);
}

export function rpeToRir(rpe: number): number {
  return clamp(10 - rpe, 0, 10);
}

export function formatEffort(rir: number, scale: EffortScale): string {
  const value = scale === "rpe" ? rirToRpe(rir) : rir;
  return `${scale === "rpe" ? "RPE" : "RIR"} ${value.toLocaleString("de-DE")}`;
}
