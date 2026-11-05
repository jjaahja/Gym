"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { getDb } from "@/lib/offline/db";
import { enqueue, type NewOutboxEntry } from "@/lib/offline/outbox";
import { requestSync } from "@/lib/offline/sync";
import { createWorkoutStore, type WorkoutState } from "./workout-store";

// Kette garantiert, dass Outbox-Einträge in Aufruf-Reihenfolge geschrieben werden.
let chain: Promise<void> = Promise.resolve();

function writeToOutbox(entry: NewOutboxEntry): void {
  chain = chain
    .then(() => enqueue(getDb(), entry))
    .then(() => requestSync())
    .catch((err) => console.error("Outbox-Schreibfehler", err));
}

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
