"use client";

import { useEffect, useState } from "react";
import { buttonStyles, Card } from "@/components/ui";
import { useSyncStatus } from "@/lib/offline/sync";
import { getCurrentUserId } from "@/lib/supabase/client";
import { useWorkout, useWorkoutHydrated } from "@/stores/workout";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

export function WorkoutScreen() {
  const hydrated = useWorkoutHydrated();
  const session = useWorkout((s) => s.session);

  if (!hydrated) return <Card className="h-32 animate-pulse">{null}</Card>;
  return session ? <RunningWorkout /> : <StartWorkout />;
}

function StartWorkout() {
  const start = useWorkout((s) => s.start);
  const [starting, setStarting] = useState(false);

  async function handleStart() {
    setStarting(true);
    try {
      start({ userId: await getCurrentUserId() });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Kein Training aktiv</h2>
      <p className="mt-1 text-sm text-muted">
        Starte ein freies Training. Mit Trainingsplan, „Letztes Mal“-Werten und Richtwerten pro Satz geht es in
        Schritt 4 weiter.
      </p>
      <button type="button" onClick={handleStart} disabled={starting} className={`${buttonStyles.primary} mt-4 w-full`}>
        Training starten
      </button>
    </Card>
  );
}

function RunningWorkout() {
  const session = useWorkout((s) => s.session)!;
  const finish = useWorkout((s) => s.finish);
  const discard = useWorkout((s) => s.discard);
  const { pending, syncing, lastError } = useSyncStatus();
  const now = useNow(1000);

  const completedSets = session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.isCompleted).length, 0);
  const syncLabel = !session.userId
    ? "Nur lokal (Demo)"
    : syncing
      ? "Synchronisiere …"
      : pending > 0
        ? `${pending} Änderungen ausstehend`
        : "Synchronisiert";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted">Dauer</p>
          <p className="text-xs text-muted" title={lastError ?? undefined}>
            {syncLabel}
          </p>
        </div>
        <p className="tabular mt-1 text-4xl font-bold">{formatDuration(now - Date.parse(session.startedAt))}</p>
        <p className="mt-1 text-sm text-muted">
          {session.exercises.length} Übungen · {completedSets} Sätze
        </p>
      </Card>

      <Card>
        <p className="text-sm text-muted">
          Übungen hinzufügen und Sätze eintragen kommt mit der Übungs-Datenbank (Schritt 3) und dem Live-Tracker
          (Schritt 4).
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className={buttonStyles.danger}
          onClick={() => {
            if (window.confirm("Training verwerfen? Eingetragene Sätze werden nicht gewertet.")) discard();
          }}
        >
          Verwerfen
        </button>
        <button type="button" className={buttonStyles.primary} disabled={completedSets === 0} onClick={finish}>
          Beenden
        </button>
      </div>
    </div>
  );
}
