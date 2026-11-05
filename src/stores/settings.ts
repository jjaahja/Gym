"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";

// Anzeige-Einstellungen. Lokal gespeichert; die Synchronisierung mit
// profiles.unit_system / profiles.effort_scale folgt mit dem Onboarding (Schritt 4).
interface SettingsState {
  unitSystem: UnitSystem;
  effortScale: EffortScale;
  setUnitSystem(unitSystem: UnitSystem): void;
  setEffortScale(effortScale: EffortScale): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      unitSystem: "metric",
      effortScale: "rir",
      setUnitSystem: (unitSystem) => set({ unitSystem }),
      setEffortScale: (effortScale) => set({ effortScale }),
    }),
    {
      name: "gym-settings",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
