import type { EquipmentSlug } from "@/data/catalog/equipment";
import { TRACKED_MUSCLES, type MuscleSlug, type TrackedMuscle } from "@/data/catalog/muscles";
import { exercises as catalog, getExerciseById, getMuscle, isExerciseAvailable, primaryMuscles, type Exercise } from "@/lib/catalog";
import type {
  ExperienceLevel,
  MovementPattern,
  ProgressionScheme,
  SetType,
  SplitType,
  TrainingGoal,
} from "@/lib/db/enums";
import { resolveExerciseGuidelines, resolveMuscleGuidelines } from "@/lib/science";

// Erstellt einen Trainingsplan aus dem Onboarding-Fragebogen.
// Reine Funktion: gleiche Eingabe → gleicher Plan. Alle Zahlen stammen aus den Richtwerten
// (src/data/science/guidelines.ts); hier steckt nur die Verteilungslogik.

export const GENERATOR_VERSION = "plan-generator@1";
export const MESOCYCLE_WEEKS = 5;

export interface PlanInput {
  goal: TrainingGoal;
  experience: ExperienceLevel;
  daysPerWeek: number;
  sessionDurationMin: number;
  preferredSplit?: SplitType | null;
  priorityMuscles?: readonly TrackedMuscle[];
  equipment: readonly EquipmentSlug[];
  avoidExercises?: readonly string[];
  favoriteExercises?: readonly string[];
}

export interface PlannedExercise {
  exerciseId: string;
  exerciseSlug: string;
  orderIndex: number;
  sets: number;
  repsMin: number;
  repsMax: number;
  rirMin: number;
  rirMax: number;
  restSeconds: number;
  lastSetTechnique: SetType | null;
  progressionScheme: ProgressionScheme;
  /** Richtwerte, aus denen die Vorgabe stammt – für Erklärungen in der UI */
  guidelineKeys: string[];
}

export type DayType = "full_a" | "full_b" | "full_c" | "upper" | "lower" | "push" | "pull" | "legs";

export interface PlannedDay {
  dayIndex: number;
  name: string;
  type: DayType;
  exercises: PlannedExercise[];
  estimatedMinutes: number;
}

export interface MuscleVolume {
  muscle: TrackedMuscle;
  plannedSets: number;
  targetSets: number;
  min: number;
  max: number;
  frequency: number;
  priority: boolean;
  status: "below" | "ok" | "above";
}

export interface GeneratedPlan {
  name: string;
  splitType: SplitType;
  goal: TrainingGoal;
  experience: ExperienceLevel;
  mesocycleWeeks: number;
  generatorVersion: string;
  days: PlannedDay[];
  volume: MuscleVolume[];
  warnings: string[];
}

// ─────────────────────────── Konstanten (Zeitschätzung) ───────────────────────────

const WARMUP_MIN = 6;
const SETUP_MIN_PER_EXERCISE = 1;
const WORK_SECONDS_PER_SET = 40;
const TECHNIQUE_EXTRA_MIN = 0.75;
/** Ein Technik-Segment zählt 0,5 Sätze (wie in der View weekly_muscle_volume). */
const TECHNIQUE_SET_CREDIT = 0.5;
const MIN_SETS = 2;
/** Ein halber Satz unter dem Minimum gilt noch als erreicht (Zählgenauigkeit fraktionaler Sätze). */
const BELOW_MIN_TOLERANCE = 0.5;
const MACHINE_EQUIPMENT: readonly EquipmentSlug[] = [
  "cable", "pec_deck", "leg_curl_machine", "leg_extension_machine", "hip_machine",
  "calf_machine", "leg_press", "chest_press_machine",
];

const LOWER_BODY_PATTERNS: readonly MovementPattern[] = ["squat", "hinge", "lunge", "hip_extension"];
const LOADABLE_EQUIPMENT: readonly EquipmentSlug[] = ["barbell", "leg_press", "back_extension_bench"];
const CORE_PATTERNS: readonly MovementPattern[] = ["core_flexion", "core_anti_extension", "core_rotation"];

// ─────────────────────────── Split & Vorlagen ───────────────────────────

interface Slot {
  patterns: MovementPattern[];
  focus: MuscleSlug;
  required: boolean;
}

const s = (patterns: MovementPattern[], focus: MuscleSlug, required = true): Slot => ({ patterns, focus, required });
const opt = (patterns: MovementPattern[], focus: MuscleSlug): Slot => s(patterns, focus, false);
const CORE: MovementPattern[] = ["core_flexion", "core_anti_extension"];

// Reihenfolge = Priorität: Bei knapper Zeit fallen Slots von hinten weg.
const TEMPLATES: Record<DayType, Slot[]> = {
  full_a: [
    s(["squat", "lunge"], "quads"),
    s(["horizontal_push"], "chest"),
    s(["vertical_pull", "horizontal_pull"], "lats"),
    s(["hinge", "hip_extension"], "hamstrings"),
    s(["shoulder_abduction"], "side_delts"),
    opt(["elbow_extension"], "triceps"),
    opt(["elbow_flexion"], "biceps"),
    opt(["ankle_plantarflexion"], "calves"),
    opt(["shoulder_horizontal_abduction"], "rear_delts"),
    opt(CORE, "abs"),
  ],
  full_b: [
    s(["hinge"], "hamstrings"),
    s(["horizontal_push"], "chest"),
    s(["horizontal_pull"], "upper_back"),
    s(["lunge", "squat"], "quads"),
    s(["shoulder_horizontal_abduction"], "rear_delts"),
    opt(["shoulder_abduction"], "side_delts"),
    opt(["elbow_flexion"], "biceps"),
    opt(["elbow_extension"], "triceps"),
    opt(["hip_extension", "hip_abduction"], "glutes"),
    opt(["knee_flexion"], "hamstrings"),
    opt(["ankle_plantarflexion"], "calves"),
    opt(CORE, "abs"),
  ],
  full_c: [
    s(["squat"], "quads"),
    s(["vertical_pull", "horizontal_pull"], "lats"),
    s(["horizontal_push"], "chest"),
    s(["hip_extension", "lunge"], "glutes"),
    s(["shoulder_abduction"], "side_delts"),
    opt(["knee_flexion", "hinge"], "hamstrings"),
    opt(["elbow_extension"], "triceps"),
    opt(["elbow_flexion"], "biceps"),
    opt(["ankle_plantarflexion"], "calves"),
    opt(["shoulder_horizontal_adduction"], "chest"),
  ],
  upper: [
    s(["horizontal_push"], "chest"),
    s(["vertical_pull", "horizontal_pull"], "lats"),
    s(["horizontal_pull"], "upper_back"),
    s(["shoulder_abduction"], "side_delts"),
    opt(["horizontal_push", "shoulder_horizontal_adduction"], "chest"),
    opt(["elbow_extension"], "triceps"),
    opt(["elbow_flexion"], "biceps"),
    opt(["shoulder_horizontal_abduction"], "rear_delts"),
    opt(["shoulder_extension", "vertical_pull"], "lats"),
    opt(["shoulder_abduction"], "side_delts"),
  ],
  lower: [
    s(["squat"], "quads"),
    s(["hinge"], "hamstrings"),
    s(["lunge", "hip_extension"], "glutes"),
    s(["ankle_plantarflexion"], "calves"),
    opt(["knee_flexion"], "hamstrings"),
    opt(["knee_extension", "squat"], "quads"),
    opt(CORE, "abs"),
    opt(["hip_extension", "hip_abduction"], "glutes"),
  ],
  push: [
    s(["horizontal_push"], "chest"),
    s(["horizontal_push"], "chest"),
    s(["shoulder_abduction"], "side_delts"),
    s(["elbow_extension"], "triceps"),
    opt(["shoulder_horizontal_adduction"], "chest"),
    opt(["elbow_extension"], "triceps"),
    opt(["shoulder_abduction"], "side_delts"),
    opt(["vertical_push"], "front_delts"),
  ],
  pull: [
    s(["vertical_pull", "horizontal_pull"], "lats"),
    s(["horizontal_pull"], "upper_back"),
    s(["shoulder_horizontal_abduction"], "rear_delts"),
    s(["elbow_flexion"], "biceps"),
    opt(["shoulder_extension", "horizontal_pull"], "lats"),
    opt(["elbow_flexion"], "biceps"),
    opt(CORE, "abs"),
  ],
  legs: [
    s(["squat"], "quads"),
    s(["hinge"], "hamstrings"),
    s(["ankle_plantarflexion"], "calves"),
    opt(["knee_flexion"], "hamstrings"),
    opt(["knee_extension", "lunge"], "quads"),
    opt(["lunge", "hip_extension"], "glutes"),
    opt(CORE, "abs"),
  ],
};

const DAY_LABELS: Record<DayType, string> = {
  full_a: "Ganzkörper",
  full_b: "Ganzkörper",
  full_c: "Ganzkörper",
  upper: "Oberkörper",
  lower: "Unterkörper",
  push: "Push (Drücken)",
  pull: "Pull (Ziehen)",
  legs: "Beine",
};

export const SPLIT_LABELS: Record<SplitType, string> = {
  full_body: "Ganzkörper",
  upper_lower: "Oberkörper/Unterkörper",
  push_pull_legs: "Push/Pull/Beine",
  custom: "Oberkörper/Unterkörper + Push/Pull/Beine",
};

const GOAL_LABELS: Record<TrainingGoal, string> = {
  hypertrophy: "Muskelaufbau & Optik",
  strength: "Maximalkraft",
  endurance: "Kraftausdauer",
};

function cycle<T>(items: T[], n: number): T[] {
  return Array.from({ length: n }, (_, i) => items[i % items.length]);
}

function daySequence(split: SplitType, days: number): DayType[] {
  switch (split) {
    case "full_body":
      return cycle<DayType>(["full_a", "full_b", "full_c"], days);
    case "upper_lower":
      return cycle<DayType>(["upper", "lower"], days);
    case "push_pull_legs":
      return cycle<DayType>(["push", "pull", "legs"], days);
    case "custom":
      return cycle<DayType>(["upper", "lower", "push", "pull", "legs"], days);
  }
}

function chooseSplit(days: number, preferred: SplitType | null | undefined, warnings: string[]): SplitType {
  const auto: SplitType = days <= 3 ? "full_body" : days === 4 ? "upper_lower" : days === 5 ? "custom" : "push_pull_legs";
  if (!preferred || preferred === "custom") return auto;

  const minimumDays: Record<SplitType, number> = { full_body: 1, upper_lower: 2, push_pull_legs: 3, custom: 5 };
  if (days < minimumDays[preferred]) {
    warnings.push(`${SPLIT_LABELS[preferred]} braucht mindestens ${minimumDays[preferred]} Tage – Plan nutzt stattdessen ${SPLIT_LABELS[auto]}.`);
    return auto;
  }
  if (preferred === "push_pull_legs" && days < 6) {
    warnings.push("Mit weniger als 6 Tagen trainiert Push/Pull/Beine manche Muskeln nur 1× pro Woche.");
  }
  return preferred;
}

/** Vorschau für das Onboarding: welcher Split bei dieser Tageszahl entsteht. */
export function previewSplit(daysPerWeek: number, preferred: SplitType | null): { splitType: SplitType; label: string; warnings: string[] } {
  const warnings: string[] = [];
  const splitType = chooseSplit(Math.min(Math.max(1, daysPerWeek), 6), preferred, warnings);
  return { splitType, label: SPLIT_LABELS[splitType], warnings };
}

// ─────────────────────────── Übungsauswahl ───────────────────────────

interface SelectionContext {
  input: PlanInput;
  available: Set<EquipmentSlug>;
  avoid: Set<string>;
  favorites: Set<string>;
  usedInPlan: Map<string, number>;
}

function scoreExercise(e: Exercise, patternIndex: number, ctx: SelectionContext, usedToday: Set<string>): number {
  const { goal } = ctx.input;
  let score = -patternIndex * 20;
  if (ctx.favorites.has(e.slug)) score += 100;
  if (usedToday.has(e.slug)) score -= 1000;
  const timesUsed = ctx.usedInPlan.get(e.slug) ?? 0;
  // Abwechslung zwischen A- und B-Tagen fördert regionales Wachstum (Kassiano et al. 2022);
  // im Kraftfokus werden die Hauptübungen dagegen bewusst wiederholt.
  const isMainLift = e.mechanic === "compound" && e.equipment.includes("barbell");
  // Moderat gewichtet: Abwechslung ja, aber nie auf Kosten der Übungsqualität.
  score -= timesUsed * (goal === "strength" && isMainLift ? 2 : 8);

  const stable = e.equipment.some((x) => MACHINE_EQUIPMENT.includes(x));
  if (goal === "hypertrophy") {
    if (e.resistanceProfile === "lengthened") score += 6;
    if (e.resistanceProfile === "shortened") score -= 2;
    score -= e.systemicFatigue * 0.75; // Reiz pro Ermüdung
    if (stable) score += 3; // Maschinen/Kabel: sicher bis nah ans Versagen
  } else if (goal === "strength") {
    if (isMainLift) score += 15;
  } else {
    score -= e.systemicFatigue;
  }
  // Messbare Last erleichtert die Progression; Bänder nur, wenn nichts anderes da ist.
  if (e.trackingType === "weight_reps") score += 3;
  if (e.equipment.includes("resistance_band")) score -= 8;
  if (e.laterality === "unilateral") score -= 2; // doppelte Zeit pro Satz
  if (ctx.input.experience !== "beginner") {
    if (e.difficulty === "beginner") score -= 1;
    // Beinübungen, deren Last durch Kurzhanteln oder Körpergewicht begrenzt ist, reizen Trainierte kaum
    const lowerBodyCompound = e.mechanic === "compound" && LOWER_BODY_PATTERNS.includes(e.movementPattern);
    const loadable = e.equipment.some((x) => LOADABLE_EQUIPMENT.includes(x));
    if (lowerBodyCompound && !loadable && (e.laterality === "bilateral" || e.equipment.length === 0)) score -= 4;
  }
  return score;
}

function pickExercise(slot: Slot, ctx: SelectionContext, usedToday: Set<string>): Exercise | null {
  let best: { exercise: Exercise; score: number } | null = null;
  for (const e of catalog) {
    const patternIndex = slot.patterns.indexOf(e.movementPattern);
    if (patternIndex < 0) continue;
    if (!primaryMuscles(e).includes(slot.focus)) continue;
    if (ctx.avoid.has(e.slug) || !isExerciseAvailable(e, ctx.available, ctx.input.experience)) continue;
    const score = scoreExercise(e, patternIndex, ctx, usedToday);
    if (score <= -1000) continue;
    if (!best || score > best.score || (score === best.score && e.slug < best.exercise.slug)) {
      best = { exercise: e, score };
    }
  }
  return best?.exercise ?? null;
}

// ─────────────────────────── Volumenverteilung ───────────────────────────

interface WorkingExercise {
  exercise: Exercise;
  slot: Slot;
  slotIndex: number;
  sets: number;
  technique: SetType | null;
  restSeconds: number;
}

interface WorkingDay {
  type: DayType;
  items: WorkingExercise[];
}

/** Untere Grenze des Pausen-Richtwerts: reicht laut Studien bereits; länger pausieren bleibt erlaubt. */
function restSecondsFor(e: Exercise, goal: TrainingGoal, experience: ExperienceLevel): number {
  const rest = resolveExerciseGuidelines(e, goal, experience).rest_interval!;
  return rest.min ?? rest.max ?? 90;
}

/** Intensitätstechnik nur bei Isolationsübungen (ohne Rumpf), wenn der Richtwert sie zulässt. */
export function allowsTechnique(e: Exercise, goal: TrainingGoal, experience: ExperienceLevel): boolean {
  return (
    goal === "hypertrophy" &&
    e.mechanic === "isolation" &&
    !CORE_PATTERNS.includes(e.movementPattern) &&
    (resolveExerciseGuidelines(e, goal, experience).intensity_technique?.max ?? 0) >= 1
  );
}

/** Maschine/Kabel → Dropsatz, Dehnungsfokus → Teilwiederholungen in Dehnung, sonst Myo-Reps. */
export function techniqueFor(e: Exercise): SetType {
  return e.equipment.some((eq) => MACHINE_EQUIPMENT.includes(eq))
    ? "dropset"
    : e.resistanceProfile === "lengthened"
      ? "lengthened_partials"
      : "myo_reps";
}

/** Vorgabe (Wdh., RIR, Pause) aus den Richtwerten – auch für Übungswechsel im laufenden Plan. */
export function prescribe(
  e: Exercise,
  goal: TrainingGoal,
  experience: ExperienceLevel,
  slot: { orderIndex: number; sets: number; technique: SetType | null },
): PlannedExercise {
  const r = resolveExerciseGuidelines(e, goal, experience);
  return {
    exerciseId: e.id,
    exerciseSlug: e.slug,
    orderIndex: slot.orderIndex,
    sets: slot.sets,
    repsMin: r.rep_range!.min!,
    repsMax: r.rep_range!.max!,
    rirMin: r.proximity_to_failure!.min!,
    rirMax: r.proximity_to_failure!.max!,
    restSeconds: restSecondsFor(e, goal, experience),
    lastSetTechnique: slot.technique,
    progressionScheme: "double_progression",
    guidelineKeys: [r.rep_range!, r.proximity_to_failure!, r.rest_interval!, r.intensity_technique!].map((g) => g.key),
  };
}

type TimedItem = Pick<WorkingExercise, "exercise" | "sets" | "technique" | "restSeconds">;

function minutesPerSet(item: Pick<TimedItem, "exercise" | "restSeconds">): number {
  const sides = item.exercise.laterality === "unilateral" ? 2 : 1;
  return (WORK_SECONDS_PER_SET * sides + item.restSeconds) / 60;
}

function dayMinutes(day: { items: readonly TimedItem[] }): number {
  const active = day.items.filter((i) => i.sets > 0);
  return (
    WARMUP_MIN +
    active.reduce(
      (sum, i) =>
        sum +
        SETUP_MIN_PER_EXERCISE +
        i.sets * minutesPerSet(i) +
        (i.technique ? TECHNIQUE_EXTRA_MIN : 0),
      0,
    )
  );
}

/** Geschätzte Dauer eines geplanten Tages (gleiche Annahmen wie bei der Generierung). */
export function estimateDayMinutes(exercises: readonly PlannedExercise[]): number {
  const items = exercises.flatMap((p) => {
    const exercise = getExerciseById(p.exerciseId);
    return exercise ? [{ exercise, sets: p.sets, technique: p.lastSetTechnique, restSeconds: p.restSeconds }] : [];
  });
  return Math.round(dayMinutes({ items }));
}

function setCredit(item: WorkingExercise): number {
  return item.sets + (item.technique && item.sets > 0 ? TECHNIQUE_SET_CREDIT : 0);
}

function weeklyVolume(days: WorkingDay[]): Map<MuscleSlug, number> {
  const volume = new Map<MuscleSlug, number>();
  for (const day of days)
    for (const item of day.items)
      for (const m of item.exercise.muscles)
        volume.set(m.muscle, (volume.get(m.muscle) ?? 0) + setCredit(item) * m.contribution);
  return volume;
}

/** Direkte (primäre) Sätze pro Muskel in einer Einheit – Grundlage für die Obergrenze pro Einheit. */
function sessionPrimarySets(day: WorkingDay, muscle: MuscleSlug): number {
  return day.items
    .filter((i) => primaryMuscles(i.exercise).includes(muscle))
    .reduce((sum, i) => sum + setCredit(i), 0);
}

// ─────────────────────────── Hauptfunktion ───────────────────────────

export function generatePlan(input: PlanInput): GeneratedPlan {
  const warnings: string[] = [];
  const { goal, experience } = input;

  let days = Math.round(input.daysPerWeek);
  if (days < 1) throw new RangeError("Mindestens 1 Trainingstag");
  if (days > 6) {
    warnings.push("Mindestens ein Ruhetag pro Woche ist für die Erholung wichtig – der Plan nutzt 6 Tage.");
    days = 6;
  }
  const budget = input.sessionDurationMin;
  const split = chooseSplit(days, input.preferredSplit, warnings);
  const sequence = daySequence(split, days);
  const priority = new Set<MuscleSlug>(input.priorityMuscles ?? []);
  const maxSetsPerExercise = experience === "beginner" ? 4 : 5;

  const ctx: SelectionContext = {
    input,
    available: new Set(input.equipment),
    avoid: new Set(input.avoidExercises ?? []),
    favorites: new Set(input.favoriteExercises ?? []),
    usedInPlan: new Map(),
  };

  // 1) Übungen pro Slot wählen
  const missingFocus = new Set<MuscleSlug>();
  const workingDays: WorkingDay[] = sequence.map((type) => {
    const usedToday = new Set<string>();
    const items: WorkingExercise[] = [];
    TEMPLATES[type].forEach((slot, slotIndex) => {
      const exercise = pickExercise(slot, ctx, usedToday);
      if (!exercise) {
        if (slot.required) missingFocus.add(slot.focus);
        return;
      }
      usedToday.add(exercise.slug);
      // Optionale Slots bleiben oft ungenutzt → zählen nur halb für die Abwechslung
      ctx.usedInPlan.set(exercise.slug, (ctx.usedInPlan.get(exercise.slug) ?? 0) + (slot.required ? 1 : 0.5));
      items.push({
        exercise,
        slot,
        slotIndex,
        sets: slot.required ? MIN_SETS : 0,
        technique: null,
        restSeconds: restSecondsFor(exercise, goal, experience),
      });
    });
    return { type, items };
  });

  // 2) Zielvolumen je Muskel aus den Richtwerten
  const targets = new Map<TrackedMuscle, { min: number; max: number; target: number; sessionMax: number }>();
  for (const m of TRACKED_MUSCLES) {
    const r = resolveMuscleGuidelines(m, goal, experience);
    const min = r.weekly_volume?.min ?? 6;
    const max = r.weekly_volume?.max ?? 20;
    const target = priority.has(m) ? Math.round(min + 0.4 * (max - min)) : min;
    targets.set(m, { min, max, target, sessionMax: r.session_volume?.max ?? 10 });
  }

  // 3) Zeitbudget: Pflicht-Slots von hinten streichen, bis die Einheit passt
  for (const day of workingDays) {
    while (dayMinutes(day) > budget) {
      const active = day.items.filter((i) => i.sets > 0);
      if (active.length <= 1) break;
      active[active.length - 1].sets = 0;
    }
  }

  const fitsSessionCaps = (day: WorkingDay, item: WorkingExercise, addSets: number) =>
    primaryMuscles(item.exercise).every((p) => {
      const cap = targets.get(p as TrackedMuscle)?.sessionMax;
      return cap === undefined || sessionPrimarySets(day, p) + addSets <= cap;
    });

  const staysBelowMax = (volume: Map<MuscleSlug, number>, item: WorkingExercise, addSets: number) =>
    item.exercise.muscles.every((m) => {
      const t = targets.get(m.muscle as TrackedMuscle);
      return !t || (volume.get(m.muscle) ?? 0) + addSets * m.contribution <= t.max;
    });

  // 4) Sätze auffüllen (größtes relatives Defizit zuerst). Phase 1 bringt jeden Muskel auf das
  //    Minimum, erst Phase 2 hebt die Prioritätsmuskeln an – sonst verbrauchen sie die Zeit.
  for (const phase of ["minimum", "target"] as const) {
  const blocked = new Set<MuscleSlug>();
  for (let iteration = 0; iteration < 500; iteration++) {
    const volume = weeklyVolume(workingDays);
    let neediest: TrackedMuscle | null = null;
    let largestGap = 0;
    for (const [m, t] of targets) {
      if (blocked.has(m)) continue;
      const goalSets = phase === "minimum" ? t.min : t.target;
      const gap = (goalSets - (volume.get(m) ?? 0)) / goalSets;
      if (gap > 0.01 && gap > largestGap) {
        largestGap = gap;
        neediest = m;
      }
    }
    if (!neediest) break;

    let best: { day: WorkingDay; item: WorkingExercise; add: number; score: number } | null = null;
    for (const day of workingDays) {
      const directToday = sessionPrimarySets(day, neediest);
      for (const item of day.items) {
        if (!primaryMuscles(item.exercise).includes(neediest)) continue;
        const add = item.sets === 0 ? MIN_SETS : 1;
        if (item.sets + add > maxSetsPerExercise) continue;
        if (!fitsSessionCaps(day, item, add) || !staysBelowMax(volume, item, add)) continue;
        const extraMinutes = add * minutesPerSet(item) + (item.sets === 0 ? SETUP_MIN_PER_EXERCISE : 0);
        if (dayMinutes(day) + extraMinutes > budget) continue;

        // Nutzen pro Minute: wie viel fehlendes Volumen (auch bei mitbeanspruchten Muskeln) der Satz deckt
        const usefulCredit = item.exercise.muscles.reduce((sum, m) => {
          const t = targets.get(m.muscle as TrackedMuscle);
          if (!t) return sum;
          const missing = (phase === "minimum" ? t.min : t.target) - (volume.get(m.muscle) ?? 0);
          return sum + Math.min(Math.max(missing, 0), add * m.contribution);
        }, 0);
        const score =
          (usefulCredit / extraMinutes) * 10 -
          directToday * 3 - // Volumen auf mehrere Tage verteilen
          item.sets * 1 - // lieber eine zweite Übung als eine aufgeblähte (Variation, Kassiano et al. 2022)
          item.slotIndex * 0.1;
        if (!best || score > best.score) best = { day, item, add, score };
      }
    }
    if (!best) {
      blocked.add(neediest);
      continue;
    }
    best.item.sets += best.add;
  }
  }

  // 5) Pump-Finisher: nur Muskelaufbau, nicht für Einsteiger, nur Isolationsübungen
  if (goal === "hypertrophy") {
    for (const day of workingDays) {
      const candidates = day.items
        .filter((i) => i.sets > 0 && allowsTechnique(i.exercise, goal, experience))
        .sort((a, b) => {
          const pa = primaryMuscles(a.exercise).some((m) => priority.has(m)) ? 1 : 0;
          const pb = primaryMuscles(b.exercise).some((m) => priority.has(m)) ? 1 : 0;
          return pb - pa || b.slotIndex - a.slotIndex;
        });
      let applied = 0;
      for (const item of candidates) {
        if (applied >= 2) break;
        const volume = weeklyVolume(workingDays);
        if (!staysBelowMax(volume, item, TECHNIQUE_SET_CREDIT)) continue;
        if (!fitsSessionCaps(day, item, TECHNIQUE_SET_CREDIT)) continue;
        if (dayMinutes(day) + TECHNIQUE_EXTRA_MIN > budget) continue;
        item.technique = techniqueFor(item.exercise);
        applied++;
      }
    }
  }

  // 6) Plan zusammensetzen: Grundübungen zuerst, darin Prioritätsmuskeln vorn
  const finalVolume = weeklyVolume(workingDays);
  const plannedDays: PlannedDay[] = workingDays.map((day, dayIndex) => {
    const active = day.items
      .filter((i) => i.sets > 0)
      .sort((a, b) => {
        const compound = (i: WorkingExercise) => (i.exercise.mechanic === "compound" ? 0 : 1);
        const prio = (i: WorkingExercise) => (primaryMuscles(i.exercise).some((m) => priority.has(m)) ? 0 : 1);
        return compound(a) - compound(b) || prio(a) - prio(b) || a.slotIndex - b.slotIndex;
      });
    const sameTypeBefore = sequence.slice(0, dayIndex).filter((t) => DAY_LABELS[t] === DAY_LABELS[day.type]).length;
    const repeats = sequence.filter((t) => DAY_LABELS[t] === DAY_LABELS[day.type]).length > 1;
    return {
      dayIndex,
      type: day.type,
      name: repeats ? `${DAY_LABELS[day.type]} ${String.fromCharCode(65 + sameTypeBefore)}` : DAY_LABELS[day.type],
      estimatedMinutes: Math.round(dayMinutes(day)),
      exercises: active.map((item, orderIndex) =>
        prescribe(item.exercise, goal, experience, { orderIndex, sets: item.sets, technique: item.technique }),
      ),
    };
  });

  // 7) Volumen-Übersicht und Hinweise
  const volume: MuscleVolume[] = TRACKED_MUSCLES.map((muscle) => {
    const t = targets.get(muscle)!;
    const plannedSets = Math.round((finalVolume.get(muscle) ?? 0) * 10) / 10;
    // Tage mit mindestens einem (auch indirekten) Satz für den Muskel
    const frequency = workingDays.filter((d) => (weeklyVolume([d]).get(muscle) ?? 0) >= 1).length;
    return {
      muscle,
      plannedSets,
      targetSets: t.target,
      min: t.min,
      max: t.max,
      frequency,
      priority: priority.has(muscle),
      // Toleranz: ein halber Satz (Zählgenauigkeit fraktionaler Sätze)
      status: plannedSets < t.min - BELOW_MIN_TOLERANCE ? "below" : plannedSets > t.max + 0.01 ? "above" : "ok",
    };
  });

  for (const focus of missingFocus) {
    warnings.push(`Für ${getMuscle(focus).nameDe} gibt es mit deiner Ausstattung keine passende Übung.`);
  }
  const de = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
  const below = volume.filter((v) => v.status === "below");
  if (below.length > 0) {
    warnings.push(
      `Unter dem Mindestvolumen (Sätze/Woche): ${below.map((v) => `${getMuscle(v.muscle).nameDe} ${de(v.plannedSets)}/${v.min}`).join(", ")}. ` +
        "Mehr Trainingstage, längere Einheiten oder weniger Prioritäten schaffen Platz.",
    );
  }
  const once = volume.filter((v) => days >= 2 && v.frequency === 1 && v.plannedSets > 0);
  if (once.length > 0) {
    warnings.push(`Nur an einem Tag pro Woche trainiert (Richtwert: mindestens 2×): ${once.map((v) => getMuscle(v.muscle).nameDe).join(", ")}.`);
  }
  for (const day of plannedDays) {
    if (day.estimatedMinutes > budget) {
      warnings.push(`${day.name} dauert voraussichtlich ${day.estimatedMinutes} Minuten – mehr als die geplanten ${budget}.`);
    }
  }

  return {
    name: `${SPLIT_LABELS[split]} · ${GOAL_LABELS[goal]}`,
    splitType: split,
    goal,
    experience,
    mesocycleWeeks: MESOCYCLE_WEEKS,
    generatorVersion: GENERATOR_VERSION,
    days: plannedDays,
    volume,
    warnings,
  };
}
