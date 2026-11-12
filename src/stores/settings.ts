"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import type { LoadTarget } from "@/lib/training/load-suggestion";

export const ACCENTS = ["orange", "blue", "green", "pink", "purple", "teal"] as const;
export type Accent = (typeof ACCENTS)[number];
export type Appearance = "system" | "light" | "dark";

/** Thema sofort auf <html> anwenden (beim Start setzt es ein Inline-Skript im Layout). */
export function applyTheme(accent: Accent, appearance: Appearance) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.accent = accent;
  if (appearance === "system") delete root.dataset.theme;
  else root.dataset.theme = appearance;
}

// Anzeige-Einstellungen. Lokal gespeichert; die Synchronisierung mit
// profiles.unit_system / profiles.effort_scale folgt mit dem Onboarding (Schritt 4).
interface SettingsState {
  unitSystem: UnitSystem;
  effortScale: EffortScale;
  /** Gewichtsvorschlag: letzter Satz bis zum Versagen oder RIR-Bereich des Plans (nur auf diesem Gerät) */
  loadTarget: LoadTarget;
  /** Akzentfarbe und Erscheinungsbild (nur auf diesem Gerät) */
  accent: Accent;
  appearance: Appearance;
  /** Trainings pro Woche als Ziel; null = so viele wie Trainingstage im Plan */
  weeklyGoal: number | null;
  /** Erinnerung an Trainingstagen (nur Android-App) */
  reminders: { enabled: boolean; time: string };
  setUnitSystem(unitSystem: UnitSystem): void;
  setEffortScale(effortScale: EffortScale): void;
  setLoadTarget(loadTarget: LoadTarget): void;
  setAccent(accent: Accent): void;
  setAppearance(appearance: Appearance): void;
  setWeeklyGoal(goal: number | null): void;
  setReminders(reminders: { enabled: boolean; time: string }): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      unitSystem: "metric",
      effortScale: "rir",
      loadTarget: "failure_last_set",
      accent: "orange",
      appearance: "system",
      weeklyGoal: null,
      reminders: { enabled: false, time: "17:00" },
      setUnitSystem: (unitSystem) => set({ unitSystem }),
      setEffortScale: (effortScale) => set({ effortScale }),
      setLoadTarget: (loadTarget) => set({ loadTarget }),
      setAccent: (accent) => {
        set({ accent });
        applyTheme(accent, get().appearance);
      },
      setAppearance: (appearance) => {
        set({ appearance });
        applyTheme(get().accent, appearance);
      },
      setWeeklyGoal: (weeklyGoal) => set({ weeklyGoal: weeklyGoal == null ? null : Math.min(7, Math.max(1, Math.round(weeklyGoal))) }),
      setReminders: (reminders) => set({ reminders: { enabled: reminders.enabled, time: /^\d{2}:\d{2}$/.test(reminders.time) ? reminders.time : "17:00" } }),
    }),
    {
      name: "gym-settings",
      version: 4,
      // v2: Gewichtsvorschlag (Standard: letzter Satz bis zum Versagen); v3: Akzentthema, Erscheinungsbild;
      // v4: Wochenziel, Erinnerungen
      migrate: (state) =>
        ({
          loadTarget: "failure_last_set",
          accent: "orange",
          appearance: "system",
          weeklyGoal: null,
          reminders: { enabled: false, time: "17:00" },
          ...(state as Partial<SettingsState>),
        }) as SettingsState,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
