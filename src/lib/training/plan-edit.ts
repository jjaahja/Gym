import type { SetType } from "@/lib/db/enums";
import { SET_TYPE_LABELS } from "@/lib/labels";

// Plan selbst bearbeiten: Grenzen, Reihenfolge, Supersätze und verständliche Änderungstexte.

/** Was der Nutzer an einer Planübung ändern kann. */
export interface PlanExerciseFields {
  sets: number;
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  restSeconds: number;
  lastSetTechnique: SetType | null;
}
export type PlanExercisePatch = Partial<PlanExerciseFields>;

export const EDIT_FIELDS = ["sets", "repsMin", "repsMax", "rirMin", "rirMax", "restSeconds", "lastSetTechnique"] as const;

/** Innerhalb der DB-Grenzen, aber praxisnah (mehr als 10 Sätze einer Übung pro Training bringt nichts Zusätzliches). */
export const EDIT_LIMITS = {
  sets: { min: 1, max: 10 },
  reps: { min: 1, max: 50 },
  rir: { min: 0, max: 5 },
  rest: { min: 15, max: 600, step: 15 },
} as const;

export const TECHNIQUES = ["myo_reps", "dropset", "rest_pause", "lengthened_partials"] as const satisfies readonly SetType[];

const within = (n: number, { min, max }: { min: number; max: number }) => Number.isInteger(n) && n >= min && n <= max;

/** Fehlertext oder null. Prüft das Ergebnis nach dem Ändern (z. B. Wdh. min ≤ max). */
export function validateFields(f: PlanExerciseFields): string | null {
  if (!within(f.sets, EDIT_LIMITS.sets)) return `Sätze: ${EDIT_LIMITS.sets.min}–${EDIT_LIMITS.sets.max}`;
  if (!within(f.repsMin, EDIT_LIMITS.reps) || !within(f.repsMax, EDIT_LIMITS.reps)) return `Wiederholungen: ${EDIT_LIMITS.reps.min}–${EDIT_LIMITS.reps.max}`;
  if (f.repsMin > f.repsMax) return "Wiederholungen: „von“ darf nicht größer als „bis“ sein";
  if (!within(f.rirMin, EDIT_LIMITS.rir) || !within(f.rirMax, EDIT_LIMITS.rir)) return `RIR: ${EDIT_LIMITS.rir.min}–${EDIT_LIMITS.rir.max}`;
  if (f.rirMin > f.rirMax) return "RIR: „von“ darf nicht größer als „bis“ sein";
  if (!within(f.restSeconds, EDIT_LIMITS.rest)) return `Pause: ${EDIT_LIMITS.rest.min}–${EDIT_LIMITS.rest.max} s`;
  if (f.lastSetTechnique != null && !(TECHNIQUES as readonly SetType[]).includes(f.lastSetTechnique)) return "Unbekannte Technik";
  return null;
}

/** Nur die Felder, die sich wirklich ändern. */
export function changedFields(before: PlanExerciseFields, patch: PlanExercisePatch): PlanExercisePatch {
  const out: PlanExercisePatch = {};
  for (const key of EDIT_FIELDS) {
    if (key in patch && patch[key] !== undefined && patch[key] !== before[key]) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

export function pickFields(e: PlanExerciseFields, keys: readonly string[]): PlanExercisePatch {
  return Object.fromEntries(EDIT_FIELDS.filter((k) => keys.includes(k)).map((k) => [k, e[k]])) as PlanExercisePatch;
}

const range = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

/** „Sätze 3 → 4 · Wdh. 8–12 → 10–15 · Pause 120 → 90 s · Technik: keine → Myo-Reps“ */
export function describeChange(before: PlanExerciseFields, after: PlanExerciseFields): string {
  const parts: string[] = [];
  if (before.sets !== after.sets) parts.push(`Sätze ${before.sets} → ${after.sets}`);
  if (before.repsMin !== after.repsMin || before.repsMax !== after.repsMax)
    parts.push(`Wdh. ${range(before.repsMin, before.repsMax)} → ${range(after.repsMin, after.repsMax)}`);
  if (before.rirMin !== after.rirMin || before.rirMax !== after.rirMax)
    parts.push(`RIR ${range(before.rirMin, before.rirMax)} → ${range(after.rirMin, after.rirMax)}`);
  if (before.restSeconds !== after.restSeconds) parts.push(`Pause ${before.restSeconds} → ${after.restSeconds} s`);
  if (before.lastSetTechnique !== after.lastSetTechnique) {
    const label = (t: SetType | null) => (t ? SET_TYPE_LABELS[t] : "keine");
    parts.push(`Technik im letzten Satz: ${label(before.lastSetTechnique)} → ${label(after.lastSetTechnique)}`);
  }
  return parts.join(" · ");
}

/**
 * Neue Positionen für `count` Übungen eines Tages, die mit keiner bestehenden Position kollidieren.
 * Der Server verlangt (Tag, Position) eindeutig – und prüft das Zeile für Zeile. Werden die neuen Werte so gewählt,
 * dass sie weder untereinander noch mit den alten übereinstimmen, gibt es in keinem Zwischenschritt einen Konflikt,
 * egal wie die Outbox die Zeilen bündelt. Wechselt zwischen 0… und „hinter dem Maximum“, wächst also nicht endlos.
 */
export function freshOrderIndexes(current: readonly number[], count: number): number[] {
  const min = current.length ? Math.min(...current) : count;
  const start = min >= count ? 0 : Math.max(...current) + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

/** Supersatz-Gruppen aus dem Plan (gleiche Gruppennummer, direkt hintereinander) als Schlüssel-Listen. */
export function planSupersets(exercises: readonly { id: string; supersetGroup?: number | null }[]): string[][] {
  const groups: string[][] = [];
  let run: string[] = [];
  let current: number | null = null;
  for (const e of exercises) {
    const g = e.supersetGroup ?? null;
    if (g != null && g === current) {
      run.push(e.id);
      continue;
    }
    if (run.length >= 2) groups.push(run);
    run = g != null ? [e.id] : [];
    current = g;
  }
  if (run.length >= 2) groups.push(run);
  return groups;
}

/** Gruppennummern (1, 2, …) je Übung für die gespeicherten Supersätze. */
export function supersetNumbers(groups: readonly (readonly string[])[]): Map<string, number> {
  const numbers = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((id) => numbers.set(id, i + 1)));
  return numbers;
}

/** Kurzanleitung je Intensitätstechnik (im Plan-Editor und im Training). */
export const TECHNIQUE_HOWTO: Record<(typeof TECHNIQUES)[number], string> = {
  myo_reps:
    "Letzter Satz bis etwa 1 Wdh. vor Versagen, dann 3–5 Atemzüge Pause und 3–5 Wdh. – wiederholen, bis du die Mini-Sätze nicht mehr schaffst (meist 3–5).",
  dropset: "Nach dem letzten Satz das Gewicht um etwa 20–30 % senken und ohne Pause weitermachen, bis kurz vor Versagen.",
  rest_pause: "Nach dem letzten Satz 15–20 Sekunden durchatmen, dann mit demselben Gewicht noch einmal so viele Wdh. wie möglich (1–2 Mal).",
  lengthened_partials: "Wenn keine volle Wdh. mehr geht: weiter mit halben Wiederholungen in der gedehnten Position, bis auch die nicht mehr gehen.",
};

/** Pause vor dem Technik-Satz bzw. zwischen Mini-Sätzen (Sekunden; 0 = direkt weiter). */
export const TECHNIQUE_REST_SECONDS: Record<(typeof TECHNIQUES)[number], number> = {
  myo_reps: 15,
  rest_pause: 20,
  dropset: 10,
  lengthened_partials: 0,
};
