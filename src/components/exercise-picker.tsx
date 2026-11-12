"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/sheet";
import type { EquipmentSlug } from "@/data/catalog/equipment";
import type { MuscleSlug } from "@/data/catalog/muscles";
import { exercises as catalog, getMuscle, isExerciseAvailable, primaryMuscles, type Exercise } from "@/lib/catalog";

const muscleName = (m: MuscleSlug) => getMuscle(m).nameDe.replace(/ \(.*\)$/, "");

/** Übung aus dem Katalog wählen (mit vorhandener Ausstattung); optional Empfehlungen für bestimmte Muskeln zuerst. */
export function ExercisePicker({
  open,
  onClose,
  onPick,
  equipment,
  exclude,
  recommend = [],
  title = "Übung hinzufügen",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (exercise: Exercise) => void;
  /** null = alle Übungen (z. B. ohne Plan) */
  equipment: readonly EquipmentSlug[] | null;
  /** schon vorhandene Übungen (Slugs) – werden ausgeblendet */
  exclude?: ReadonlySet<string>;
  /** Muskeln, für die Übungen oben empfohlen werden (z. B. unter dem Wochen-Richtwert) */
  recommend?: readonly MuscleSlug[];
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const available = useMemo(
    () => catalog.filter((e) => (!equipment || isExerciseAvailable(e, equipment, "advanced")) && !exclude?.has(e.slug)),
    [equipment, exclude],
  );
  const q = query.trim().toLocaleLowerCase("de");
  const options = useMemo(
    () => available.filter((e) => q === "" || e.nameDe.toLocaleLowerCase("de").includes(q)).slice(0, 40),
    [available, q],
  );
  const recommended = useMemo(() => {
    if (q !== "" || recommend.length === 0) return [];
    // Isolationsübungen zuerst: gezielt Volumen für einen Muskel, wenig Ermüdung für den Rest
    return available
      .filter((e) => primaryMuscles(e).some((m) => recommend.includes(m)))
      .sort((a, b) => Number(a.mechanic !== "isolation") - Number(b.mechanic !== "isolation"))
      .slice(0, 5);
  }, [available, recommend, q]);

  const pick = (e: Exercise) => {
    onPick(e);
    setQuery("");
    onClose();
  };

  const row = (e: Exercise) => (
    <li key={e.id}>
      <button type="button" className="flex min-h-12 w-full items-center justify-between gap-3 text-left" onClick={() => pick(e)}>
        <span className="font-medium">{e.nameDe}</span>
        <span className="shrink-0 text-xs text-muted">{muscleName(e.muscles[0].muscle)}</span>
      </button>
    </li>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Übung suchen"
        aria-label="Übung suchen"
        className="field block min-h-12 px-4"
      />
      {recommended.length > 0 && (
        <section aria-label="Empfohlen" className="mt-4">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Empfohlen · {recommend.slice(0, 3).map(muscleName).join(", ")} unter dem Richtwert
          </h3>
          <ul className="mt-1 divide-y divide-border rounded-[0.875rem] bg-surface px-3 shadow-card">{recommended.map(row)}</ul>
        </section>
      )}
      <ul className="mt-3 divide-y divide-border" aria-label="Alle Übungen">
        {options.map(row)}
      </ul>
      {options.length === 0 && <p className="mt-3 text-sm text-muted">Keine passende Übung gefunden.</p>}
    </Sheet>
  );
}
