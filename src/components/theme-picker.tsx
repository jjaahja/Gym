"use client";

import { Card, Segmented } from "@/components/ui";
import { ACCENTS, useSettings, type Accent } from "@/stores/settings";

// Darstellung: Akzentfarbe (Farbkreise wie in iOS) und Erscheinungsbild.

const LABELS: Record<Accent, string> = {
  orange: "Orange",
  blue: "Blau",
  green: "Grün",
  pink: "Pink",
  purple: "Lila",
  teal: "Türkis",
};

/** Kreisfarbe unabhängig vom aktuellen Thema (hell/dunkel jeweils der passende Ton) */
const SWATCH: Record<Accent, string> = {
  orange: "bg-[#c93c00] dark:bg-[#ff9f0a]",
  blue: "bg-[#0066cc] dark:bg-[#0a84ff]",
  green: "bg-[#1e7a35] dark:bg-[#30d158]",
  pink: "bg-[#c8124f] dark:bg-[#ff375f]",
  purple: "bg-[#8e3fbe] dark:bg-[#bf5af2]",
  teal: "bg-[#00728a] dark:bg-[#40c8e0]",
};

export function ThemePicker() {
  const { accent, appearance, setAccent, setAppearance } = useSettings();
  return (
    <Card className="space-y-5">
      <fieldset>
        <legend className="mb-3 text-[0.9375rem] font-medium">Akzentfarbe</legend>
        <div className="grid grid-cols-6 gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={accent === a}
              aria-label={LABELS[a]}
              onClick={() => setAccent(a)}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={`grid size-9 place-items-center rounded-full ${SWATCH[a]} ring-offset-2 ring-offset-surface transition-shadow ${
                  accent === a ? "ring-2 ring-fg/80" : ""
                }`}
              >
                {accent === a && (
                  <svg viewBox="0 0 24 24" className="size-4 text-white dark:text-black" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="text-[0.6875rem] text-muted">{LABELS[a]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <Segmented
        label="Erscheinungsbild"
        value={appearance}
        onChange={setAppearance}
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Hell" },
          { value: "dark", label: "Dunkel" },
        ]}
      />
    </Card>
  );
}
