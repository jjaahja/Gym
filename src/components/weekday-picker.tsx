"use client";

import { WEEKDAYS, weekdayLong, weekdayShort, type Weekday } from "@/lib/training/schedule";

/** Auswahl der Trainings-Wochentage (genau `count` Tage). */
export function WeekdayPicker({
  value,
  count,
  onChange,
  label = "Trainingstage",
}: {
  value: readonly Weekday[];
  count: number;
  onChange: (weekdays: Weekday[]) => void;
  label?: string;
}) {
  const selected = new Set(value);
  const remaining = count - selected.size;
  return (
    <fieldset>
      <legend className="mb-2 flex w-full items-baseline justify-between gap-2 text-sm font-medium">
        <span>{label}</span>
        <span className={`tabular text-xs ${remaining === 0 ? "text-muted" : "font-semibold text-accent"}`} aria-live="polite">
          {selected.size} von {count} gewählt
        </span>
      </legend>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => {
          const on = selected.has(d);
          const full = !on && remaining <= 0;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={weekdayLong(d)}
              disabled={full}
              onClick={() => onChange(on ? value.filter((w) => w !== d) : [...value, d].sort((a, b) => a - b))}
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl text-sm font-semibold transition-colors disabled:opacity-35 ${
                on ? "bg-accent text-accent-fg" : "bg-surface-2"
              }`}
            >
              {weekdayShort(d)}
            </button>
          );
        })}
      </div>
      {remaining > 0 && <p className="mt-1.5 text-xs text-muted">Noch {remaining} {remaining === 1 ? "Tag" : "Tage"} wählen.</p>}
      {remaining === 0 && selected.size < 7 && (
        <p className="mt-1.5 text-xs text-muted">Zum Tauschen erst einen Tag abwählen.</p>
      )}
    </fieldset>
  );
}
