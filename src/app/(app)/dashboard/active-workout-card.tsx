"use client";

import { ButtonLink, Card } from "@/components/ui";
import { useWorkout } from "@/stores/workout";

export function ActiveWorkoutCard() {
  const session = useWorkout((s) => s.session);
  if (!session) return null;

  const sets = session.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  return (
    <Card className="ring-1 ring-accent/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Training läuft</p>
      <p className="mt-1 text-sm text-muted">
        {session.exercises.length} Übungen · {sets} Sätze
      </p>
      <div className="mt-3">
        <ButtonLink href="/workout">Weiter trainieren</ButtonLink>
      </div>
    </Card>
  );
}
