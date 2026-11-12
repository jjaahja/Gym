"use client";

import { create } from "zustand";
import { cancelRestEnd, scheduleRestEnd } from "@/lib/native/device";
import type { CompletionResult } from "@/lib/workout/complete";

const REST_BODY = "Zeit für den nächsten Satz.";

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
  start: (seconds, hint) => {
    const endsAt = Date.now() + seconds * 1000;
    set({ endsAt, totalSeconds: seconds, hint });
    // Android-App: Benachrichtigung auch bei ausgeschaltetem Bildschirm
    void scheduleRestEnd(endsAt, REST_BODY).catch(() => {});
  },
  extend: (seconds) => {
    const { endsAt, totalSeconds } = get();
    if (!endsAt) return;
    const next = Math.max(endsAt, Date.now()) + seconds * 1000;
    set({ endsAt: next, totalSeconds: totalSeconds + seconds });
    void scheduleRestEnd(next, REST_BODY).catch(() => {});
  },
  stop: () => {
    set({ endsAt: null });
    void cancelRestEnd().catch(() => {});
  },
}));

interface CompletionState {
  result: CompletionResult | null;
  setResult(result: CompletionResult | null): void;
}

export const useCompletion = create<CompletionState>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
}));
