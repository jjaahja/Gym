"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import type { LoadTarget } from "@/lib/training/load-suggestion";

// Anzeige-Einstellungen. Lokal gespeichert; die Synchronisierung mit
// profiles.unit_system / profiles.effort_scale folgt mit dem Onboarding (Schritt 4).
interface SettingsState {
  unitSystem: UnitSystem;
  effortScale: EffortScale;
  /** Gewichtsvorschlag: letzter Satz bis zum Versagen oder RIR-Bereich des Plans (nur auf diesem Gerät) */
  loadTarget: LoadTarget;
  setUnitSystem(unitSystem: UnitSystem): void;
  setEffortScale(effortScale: EffortScale): void;
  setLoadTarget(loadTarget: LoadTarget): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      unitSystem: "metric",
      effortScale: "rir",
      loadTarget: "failure_last_set",
      setUnitSystem: (unitSystem) => set({ unitSystem }),
      setEffortScale: (effortScale) => set({ effortScale }),
      setLoadTarget: (loadTarget) => set({ loadTarget }),
    }),
    {
      name: "gym-settings",
      version: 2,
      // v1 → v2: Gewichtsvorschlag (Standard: letzter Satz bis zum Versagen)
      migrate: (state) => ({ loadTarget: "failure_last_set", ...(state as Partial<SettingsState>) }) as SettingsState,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);
