"use client";

import { create } from "zustand";
import type { CompletionResult } from "@/lib/workout/complete";

// Flüchtiger UI-Zustand des Trackers (nicht persistiert).

interface RestTimerState {
  endsAt: number | null;
  totalSeconds: number;
  /** Richtwert-Hinweis, z. B. „120–180 Sekunden Pause“ */
  hint: string;
  start(seconds: number, hint: string): void;
  extend(seconds: number): void;
  stop(): void;
}

export const useRestTimer = create<RestTimerState>((set, get) => ({
  endsAt: null,
  totalSeconds: 0,
  hint: "",
  start: (seconds, hint) => set({ endsAt: Date.now() + seconds * 1000, totalSeconds: seconds, hint }),
  extend: (seconds) => {
    const { endsAt, totalSeconds } = get();
    if (endsAt) set({ endsAt: Math.max(endsAt, Date.now()) + seconds * 1000, totalSeconds: totalSeconds + seconds });
  },
  stop: () => set({ endsAt: null }),
}));

interface CompletionState {
  result: CompletionResult | null;
  setResult(result: CompletionResult | null): void;
}

export const useCompletion = create<CompletionState>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
}));
