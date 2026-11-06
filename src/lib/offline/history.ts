import type { CompletedExercise, CompletedSession, CompletedSet, GymDB } from "./db";

// Lokale Trainingshistorie (IndexedDB): Grundlage für „Letztes Mal“, Progression und Wochenvolumen.
// Funktioniert offline und im Demo-Modus; die Server-Kopie entsteht parallel über die Outbox.

export async function saveSession(db: GymDB, session: CompletedSession): Promise<void> {
  await db.sessions.put(session);
}

/** Sessions mit dieser Übung, älteste zuerst. */
export async function sessionsWithExercise(db: GymDB, exerciseId: string): Promise<CompletedSession[]> {
  const sessions = await db.sessions.where("exerciseIds").equals(exerciseId).toArray();
  return sessions.sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

export interface ExercisePerformance {
  sessionId: string;
  endedAt: string;
  sets: CompletedSet[];
  exercise: CompletedExercise;
}

function performanceIn(session: CompletedSession, exerciseId: string): ExercisePerformance | null {
  const exercise = session.exercises.find((e) => e.exerciseId === exerciseId && e.sets.length > 0);
  return exercise ? { sessionId: session.id, endedAt: session.endedAt, sets: exercise.sets, exercise } : null;
}

/** Letzte abgeschlossene Einheit mit dieser Übung (wie die View exercise_last_performance). */
export async function lastPerformance(
  db: GymDB,
  exerciseId: string,
  excludeSessionId?: string,
): Promise<ExercisePerformance | null> {
  const sessions = await sessionsWithExercise(db, exerciseId);
  for (const session of sessions.reverse()) {
    if (session.id === excludeSessionId) continue;
    const performance = performanceIn(session, exerciseId);
    if (performance) return performance;
  }
  return null;
}

/** Die letzten n Einheiten mit dieser Übung, älteste zuerst. */
export async function recentPerformances(db: GymDB, exerciseId: string, n: number): Promise<ExercisePerformance[]> {
  const sessions = await sessionsWithExercise(db, exerciseId);
  return sessions
    .map((s) => performanceIn(s, exerciseId))
    .filter((p): p is ExercisePerformance => p !== null)
    .slice(-n);
}

export async function sessionsSince(db: GymDB, isoDate: string): Promise<CompletedSession[]> {
  return db.sessions.where("endedAt").aboveOrEqual(isoDate).sortBy("endedAt");
}

export async function allSessions(db: GymDB): Promise<CompletedSession[]> {
  return db.sessions.orderBy("endedAt").toArray();
}

export async function clearHistory(db: GymDB): Promise<void> {
  await db.sessions.clear();
}
