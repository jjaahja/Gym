"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExerciseMechanic } from "@/lib/db/enums";

export interface ExerciseListItem {
  slug: string;
  name: string;
  primary: string[];
  /** Hauptmuskeln – der Filter zeigt nur Übungen, die den Muskel direkt trainieren */
  muscleSlugs: string[];
  sortKey: number;
  equipment: string;
  mechanic: ExerciseMechanic;
  lengthened: boolean;
}

const FILTERS = [
  { label: "Alle", muscles: [] },
  { label: "Brust", muscles: ["chest"] },
  { label: "Schultern", muscles: ["front_delts", "side_delts", "rear_delts"] },
  { label: "Rücken", muscles: ["lats", "upper_back", "lower_back"] },
  { label: "Arme", muscles: ["biceps", "triceps", "forearms"] },
  { label: "Beine", muscles: ["quads", "hamstrings", "adductors", "calves"] },
  { label: "Gesäß", muscles: ["glutes"] },
  { label: "Bauch", muscles: ["abs", "obliques"] },
] as const;

export function ExerciseBrowser({ items }: { items: ExerciseListItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(0);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de");
    const muscles: readonly string[] = FILTERS[filter].muscles;
    return items.filter(
      (item) =>
        (muscles.length === 0 || item.muscleSlugs.some((m) => muscles.includes(m))) &&
        (q === "" || item.name.toLocaleLowerCase("de").includes(q) || item.primary.some((p) => p.toLocaleLowerCase("de").includes(q))),
    );
  }, [items, query, filter]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Übung oder Muskel suchen"
        aria-label="Übungen durchsuchen"
        className="block min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Nach Muskelgruppe filtern">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={filter === i}
            onClick={() => setFilter(i)}
            className={`min-h-10 shrink-0 rounded-full border px-4 text-sm font-medium ${
              filter === i ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        {visible.length} {visible.length === 1 ? "Übung" : "Übungen"}
      </p>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {visible.map((item) => (
          <li key={item.slug}>
            <Link href={`/exercises/${item.slug}`} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}</p>
                <p className="truncate text-sm text-muted">
                  {item.primary.join(", ")} · {item.equipment}
                </p>
              </div>
              {item.lengthened && (
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium">Dehnung</span>
              )}
              <span aria-hidden="true" className="text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="text-center text-sm text-muted">Keine Übung gefunden.</p>}
    </div>
  );
}
