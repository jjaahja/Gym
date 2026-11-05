import { describe, expect, it } from "vitest";
import { TRACKED_MUSCLES } from "@/data/catalog/muscles";
import { exercises, getExercise } from "@/lib/catalog";
import { DB_ENUMS } from "@/lib/db/enums";
import {
  formatGuidelineMessage,
  guidelines,
  matchingExerciseGuidelines,
  matchingMuscleGuidelines,
  resolveExerciseGuidelines,
  resolveMuscleGuidelines,
  sources,
} from ".";

const GOALS = DB_ENUMS.training_goal;
const LEVELS = DB_ENUMS.experience_level;

describe("Quellen", () => {
  it("haben eindeutige Schlüssel und DOIs", () => {
    expect(new Set(sources.map((s) => s.key)).size).toBe(sources.length);
    const dois = sources.map((s) => s.doi).filter(Boolean);
    expect(new Set(dois).size).toBe(dois.length);
  });

  it("haben gültige DOIs", () => {
    for (const s of sources) if (s.doi) expect(s.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
  });

  it("werden alle von mindestens einem Richtwert verwendet", () => {
    const used = new Set(guidelines.flatMap((g) => g.sources.map((s) => s.key)));
    for (const s of sources) expect(used.has(s.key), s.key).toBe(true);
  });
});

describe("Richtwerte – Integrität", () => {
  it("haben eindeutige Schlüssel", () => {
    expect(new Set(guidelines.map((g) => g.key)).size).toBe(guidelines.length);
  });

  it("erfüllen die DB-Constraints (min ≤ max, Wert oder qualitativ)", () => {
    for (const g of guidelines) {
      if (g.min != null && g.max != null) expect(g.min, g.key).toBeLessThanOrEqual(g.max);
      expect(g.unit === "qualitative" || g.min != null || g.max != null, g.key).toBe(true);
    }
  });

  it("verweisen nur auf existierende Übungen", () => {
    for (const g of guidelines) if (g.scope.exercise) expect(getExercise(g.scope.exercise), g.key).toBeDefined();
  });

  it("haben keine zwei Regeln mit identischer Kategorie und identischem Geltungsbereich", () => {
    const seen = new Set<string>();
    for (const g of guidelines) {
      const id = JSON.stringify([g.category, g.scope.goal, g.scope.experience, g.scope.mechanic, g.scope.muscle, g.scope.pattern, g.scope.exercise]);
      expect(seen.has(id), g.key).toBe(false);
      seen.add(id);
    }
  });

  it("ersetzen Platzhalter in Nachrichten", () => {
    for (const g of guidelines) expect(formatGuidelineMessage(g), g.key).not.toMatch(/\{(min|max)\}/);
  });
});

describe("Auflösung pro Übung", () => {
  const cases = exercises.flatMap((e) => GOALS.flatMap((goal) => LEVELS.map((level) => [e, goal, level] as const)));

  it("liefert für jede Übung, jedes Ziel und jede Stufe Wiederholungen, Pause, RIR und Technik-Regel", () => {
    for (const [e, goal, level] of cases) {
      const r = resolveExerciseGuidelines(e, goal, level);
      for (const category of ["rep_range", "rest_interval", "proximity_to_failure", "intensity_technique", "progression"] as const) {
        expect(r[category], `${e.slug}/${goal}/${level}/${category}`).toBeDefined();
      }
    }
  });

  it("ist eindeutig: nie zwei passende Regeln mit gleichem Rang (sonst wäre die SQL-Funktion nicht deterministisch)", () => {
    for (const [e, goal, level] of cases) {
      for (const [category, list] of matchingExerciseGuidelines(e, goal, level)) {
        if (list.length < 2) continue;
        const [a, b] = list;
        expect(a.specificity * 1000 + a.priority, `${e.slug}/${goal}/${level}/${category}`).not.toBe(
          b.specificity * 1000 + b.priority,
        );
      }
    }
  });

  it("wählt die spezifischste Regel (Beispiele aus der Doku)", () => {
    const pick = (slug: string, goal: (typeof GOALS)[number], level: (typeof LEVELS)[number]) =>
      resolveExerciseGuidelines(getExercise(slug)!, goal, level);

    expect(pick("barbell-bench-press", "hypertrophy", "intermediate").rep_range?.key).toBe("rep_range.hypertrophy");
    expect(pick("dumbbell-lateral-raise", "hypertrophy", "intermediate").rep_range?.key).toBe("rep_range.hypertrophy.isolation");
    expect(pick("barbell-bench-press", "strength", "advanced").rep_range?.key).toBe("rep_range.strength.compound");
    expect(pick("barbell-bench-press", "hypertrophy", "intermediate").proximity_to_failure?.key).toBe("rir.hypertrophy.compound");
    expect(pick("deadlift", "hypertrophy", "intermediate").proximity_to_failure?.key).toBe("rir.hinge");
    expect(pick("barbell-back-squat", "hypertrophy", "beginner").proximity_to_failure?.key).toBe("rir.barbell-back-squat");
    expect(pick("leg-press", "hypertrophy", "beginner").proximity_to_failure?.key).toBe("rir.beginner.compound");
    expect(pick("standing-calf-raise", "hypertrophy", "intermediate").range_of_motion?.key).toBe("rom.calves");
    expect(pick("cable-curl", "hypertrophy", "beginner").intensity_technique?.key).toBe("technique.beginner.isolation");
    expect(pick("cable-curl", "hypertrophy", "advanced").intensity_technique?.key).toBe("technique.isolation");
    expect(pick("barbell-bench-press", "strength", "advanced").rest_interval?.key).toBe("rest.strength.compound");
  });
});

describe("Auflösung pro Muskel", () => {
  it("liefert Volumen, Volumen pro Einheit und Frequenz für alle gezielt trainierten Muskeln", () => {
    for (const muscle of TRACKED_MUSCLES)
      for (const goal of GOALS)
        for (const level of LEVELS) {
          const r = resolveMuscleGuidelines(muscle, goal, level);
          expect(r.weekly_volume, `${muscle}/${goal}/${level}`).toBeDefined();
          expect(r.session_volume).toBeDefined();
          expect(r.frequency).toBeDefined();
          for (const list of matchingMuscleGuidelines(muscle, goal, level).values()) {
            if (list.length > 1) expect(list[0].specificity).not.toBe(list[1].specificity);
          }
        }
  });

  it("gibt Einsteigern weniger Volumen", () => {
    expect(resolveMuscleGuidelines("chest", "hypertrophy", "intermediate").weekly_volume?.min).toBe(10);
    expect(resolveMuscleGuidelines("chest", "hypertrophy", "beginner").weekly_volume?.min).toBe(6);
    expect(resolveMuscleGuidelines("abs", "hypertrophy", "beginner").weekly_volume?.key).toBe("volume.abs");
  });
});
