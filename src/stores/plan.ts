"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { writeToOutbox } from "@/lib/offline/sink";
import { createPlanStore, type PlanState } from "./plan-store";

export const planStore = createPlanStore({ sink: writeToOutbox });

export function usePlan<T>(selector: (state: PlanState) => T): T {
  return useStore(planStore, selector);
}

export function usePlanHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => planStore.persist.onFinishHydration(onChange),
    () => planStore.persist.hasHydrated(),
    () => false,
  );
}
