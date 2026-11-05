"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { writeToOutbox } from "@/lib/offline/sink";
import { createWorkoutStore, type WorkoutState } from "./workout-store";

export const workoutStore = createWorkoutStore({ sink: writeToOutbox });

export function useWorkout<T>(selector: (state: WorkoutState) => T): T {
  return useStore(workoutStore, selector);
}

/** false, bis das laufende Training aus dem Speicher geladen ist – verhindert kurzes Aufblitzen von "kein Training". */
export function useWorkoutHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => workoutStore.persist.onFinishHydration(onChange),
    () => workoutStore.persist.hasHydrated(),
    () => false,
  );
}
