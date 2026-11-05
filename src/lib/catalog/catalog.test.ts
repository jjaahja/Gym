import { describe, expect, it } from "vitest";
import { EQUIPMENT_PRESETS } from "@/data/catalog/equipment";
import { TRACKED_MUSCLES } from "@/data/catalog/muscles";
import { exercises, isExerciseAvailable, primaryMuscles } from ".";

describe("Übungskatalog", () => {
  it("hat eindeutige Slugs, IDs und Namen", () => {
    expect(new Set(exercises.map((e) => e.slug)).size).toBe(exercises.length);
    expect(new Set(exercises.map((e) => e.id)).size).toBe(exercises.length);
    expect(new Set(exercises.map((e) => e.nameDe)).size).toBe(exercises.length);
  });

  it("nutzt URL-taugliche Slugs", () => {
    for (const e of exercises) expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(exercises.map((e) => [e.slug, e] as const))("%s ist vollständig beschrieben", (_, e) => {
    expect(e.description.length).toBeGreaterThan(30);
    expect(e.instructions.length).toBeGreaterThanOrEqual(3);
    expect(e.commonMistakes.length).toBeGreaterThanOrEqual(2);
    expect(e.cues.length).toBeGreaterThanOrEqual(2);
    expect(primaryMuscles(e).length).toBeGreaterThanOrEqual(1);
    expect(e.loadIncrementKg).toBeGreaterThan(0);
    // ein Muskel darf nicht doppelt vorkommen (PK in exercise_muscles)
    expect(new Set(e.muscles.map((m) => m.muscle)).size).toBe(e.muscles.length);
  });

  it("deckt jeden gezielt trainierten Muskel mit Übungen ab – im Studio, mit Kurzhanteln und minimal", () => {
    for (const [preset, equipment] of Object.entries(EQUIPMENT_PRESETS)) {
      for (const muscle of TRACKED_MUSCLES) {
        const options = exercises.filter(
          (e) => primaryMuscles(e).includes(muscle) && isExerciseAvailable(e, equipment, "advanced"),
        );
        expect(options.length, `${muscle} in ${preset}`).toBeGreaterThan(0);
      }
    }
  });

  it("bietet Anfängern im Studio für jeden Muskel eine Übung", () => {
    for (const muscle of TRACKED_MUSCLES) {
      const options = exercises.filter(
        (e) => primaryMuscles(e).includes(muscle) && isExerciseAvailable(e, EQUIPMENT_PRESETS.gym, "beginner"),
      );
      expect(options.length, muscle).toBeGreaterThan(0);
    }
  });
});
