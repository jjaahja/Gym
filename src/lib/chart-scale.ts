// Achsen-Hilfen für die SVG-Diagramme (reine Funktionen, getestet).

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/** Runde Achsenwerte (1, 2, 2,5, 5 × 10^n), die [lo, hi] einschließen. */
export function niceTicks(lo: number, hi: number, count = 4): NiceScale {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const min = Math.floor(lo / step + 1e-9) * step;
  const max = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  // Rundungsfehler (0.30000000000000004) entfernen
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + (step / magnitude === 2.5 ? 1 : 0));
  return { min, max, step, ticks: ticks.map((t) => Number(t.toFixed(decimals))) };
}

/** Bis zu `max` gleichmäßig verteilte Indizes, immer mit erstem und letztem. */
export function spreadIndices(length: number, max: number): number[] {
  if (length <= 0) return [];
  if (length <= max) return Array.from({ length }, (_, i) => i);
  if (max <= 1) return [length - 1];
  const result = new Set<number>();
  for (let k = 0; k < max; k++) result.add(Math.round((k * (length - 1)) / (max - 1)));
  return [...result];
}

/** Index des Datenpunkts, dessen x-Position `x` am nächsten liegt. */
export function nearestIndex(positions: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i] - x) < Math.abs(positions[best] - x)) best = i;
  return best;
}

/** Säulenpfad: 4px gerundetes Datenende oben, eckig an der Grundlinie. */
export function columnPath(x: number, y: number, width: number, baseline: number, radius = 4): string {
  const h = baseline - y;
  if (h <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, h);
  return [
    `M${x},${baseline}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${baseline}`,
    "Z",
  ].join(" ");
}
