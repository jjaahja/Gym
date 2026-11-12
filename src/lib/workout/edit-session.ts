import type { CompletedSession, CompletedSet, GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";

// Abgeschlossene Trainings nachträglich korrigieren: lokal (Historie) und über die Outbox auf dem Server.
// Die Progression lief beim Abschluss; Korrekturen fließen ab jetzt in Vorschläge, Verlauf und Rekorde ein.

interface Options {
  userId: string | null;
  sink: (entry: NewOutboxEntry) => void;
}

export interface SetPatch {
  weightKg?: number | null;
  reps?: number | null;
  rir?: number | null;
  durationSeconds?: number | null;
}

const setRow = (logId: string, s: CompletedSet) => ({
  id: s.id,
  exercise_log_id: logId,
  set_index: s.setIndex,
  set_type: s.setType,
  weight_kg: s.weightKg,
  reps: s.reps,
  duration_seconds: s.durationSeconds,
  rir: s.rir,
  is_completed: true,
});

function validate(p: SetPatch) {
  if (p.weightKg != null && !(p.weightKg >= 0 && p.weightKg <= 9999.99)) throw new RangeError("Gewicht muss zwischen 0 und 9999,99 kg liegen");
  if (p.reps != null && !(Number.isInteger(p.reps) && p.reps >= 0 && p.reps <= 1000)) throw new RangeError("Wiederholungen: ganze Zahl von 0 bis 1000");
  if (p.rir != null && !(p.rir >= 0 && p.rir <= 10)) throw new RangeError("RIR muss zwischen 0 und 10 liegen");
  if (p.durationSeconds != null && !(Number.isInteger(p.durationSeconds) && p.durationSeconds >= 0 && p.durationSeconds <= 3600))
    throw new RangeError("Dauer muss zwischen 0 und 3600 Sekunden liegen");
}

async function load(db: GymDB, sessionId: string): Promise<CompletedSession> {
  const session = await db.sessions.get(sessionId);
  if (!session) throw new Error("Training nicht gefunden");
  return session;
}

export async function updateCompletedSet(db: GymDB, sessionId: string, logId: string, setId: string, patch: SetPatch, options: Options) {
  validate(patch);
  const session = await load(db, sessionId);
  let changed: CompletedSet | null = null;
  const exercises = session.exercises.map((e) =>
    e.logId !== logId
      ? e
      : {
          ...e,
          sets: e.sets.map((s) => {
            if (s.id !== setId) return s;
            changed = {
              ...s,
              ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg == null ? null : Math.round(patch.weightKg * 100) / 100 } : {}),
              ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
              ...(patch.rir !== undefined ? { rir: patch.rir } : {}),
              ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
            };
            return changed;
          }),
        },
  );
  if (!changed) throw new Error("Satz nicht gefunden");
  await db.sessions.put({ ...session, exercises });
  if (options.userId) options.sink({ table: "set_logs", op: "upsert", rowId: setId, payload: setRow(logId, changed) });
}

/** Satz löschen; nachfolgende Sätze rücken auf (erst löschen, dann aufsteigend neu nummerieren – unique(exercise_log_id, set_index)). */
export async function deleteCompletedSet(db: GymDB, sessionId: string, logId: string, setId: string, options: Options) {
  const session = await load(db, sessionId);
  const exercise = session.exercises.find((e) => e.logId === logId);
  if (!exercise?.sets.some((s) => s.id === setId)) throw new Error("Satz nicht gefunden");
  const remaining = exercise.sets.filter((s) => s.id !== setId).sort((a, b) => a.setIndex - b.setIndex);
  const renumbered = remaining.map((s, i) => (s.setIndex === i ? s : { ...s, setIndex: i }));
  const exercises = session.exercises
    .map((e) => (e.logId === logId ? { ...e, sets: renumbered } : e))
    .filter((e) => e.sets.length > 0);
  if (exercises.length === 0) return deleteCompletedSession(db, sessionId, options);
  await db.sessions.put({ ...session, exercises, exerciseIds: [...new Set(exercises.map((e) => e.exerciseId))] });
  if (!options.userId) return;
  options.sink({ table: "set_logs", op: "delete", rowId: setId, payload: { id: setId } });
  renumbered.filter((s, i) => s !== remaining[i]).forEach((s) => options.sink({ table: "set_logs", op: "upsert", rowId: s.id, payload: setRow(logId, s) }));
  // Übung ohne Sätze: Log entfernen (Server löscht per Fremdschlüssel nichts weiter)
  if (renumbered.length === 0) options.sink({ table: "exercise_logs", op: "delete", rowId: logId, payload: { id: logId } });
}

export async function updateSessionRpe(db: GymDB, sessionId: string, sessionRpe: number | null, options: Options) {
  if (sessionRpe != null && !(sessionRpe >= 1 && sessionRpe <= 10)) throw new RangeError("Anstrengung von 1 bis 10");
  const session = await load(db, sessionId);
  await db.sessions.put({ ...session, sessionRpe });
  if (options.userId)
    options.sink({
      table: "workout_sessions",
      op: "upsert",
      rowId: sessionId,
      payload: {
        id: sessionId,
        user_id: options.userId,
        plan_id: session.planId,
        plan_day_id: session.planDayId,
        status: "completed",
        started_at: session.startedAt,
        ended_at: session.endedAt,
        is_deload: session.deload ?? false,
        session_rpe: sessionRpe,
      },
    });
}

export async function deleteCompletedSession(db: GymDB, sessionId: string, options: Options) {
  await db.sessions.delete(sessionId);
  if (options.userId) options.sink({ table: "workout_sessions", op: "delete", rowId: sessionId, payload: { id: sessionId } });
}
