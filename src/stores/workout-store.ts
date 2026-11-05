import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { SessionStatus, SetType } from "@/lib/db/enums";
import type { NewOutboxEntry } from "@/lib/offline/outbox";

// Zustand des laufenden Trainings. Lebt im Browser (überlebt Reloads und Funkloch)
// und schreibt jede Änderung als vollständige DB-Zeile in die Outbox.

export interface LoggedSet {
  id: string;
  setIndex: number;
  setType: SetType;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  isCompleted: boolean;
  completedAt: string | null;
}

export interface LoggedExercise {
  id: string;
  exerciseId: string;
  planExerciseId: string | null;
  orderIndex: number;
  pumpRating: number | null;
  jointDiscomfort: number | null;
  sets: LoggedSet[];
}

export interface ActiveSession {
  id: string;
  /** null = Demo-Modus ohne Konto → nichts wird synchronisiert */
  userId: string | null;
  planId: string | null;
  planDayId: string | null;
  startedAt: string;
  exercises: LoggedExercise[];
}

export interface SetInput {
  setType?: SetType;
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
}

export interface WorkoutState {
  session: ActiveSession | null;
  start(options: { userId: string | null; planId?: string | null; planDayId?: string | null }): string;
  addExercise(exerciseId: string, planExerciseId?: string | null): string;
  logSet(exerciseLogId: string, input: SetInput): string;
  updateSet(exerciseLogId: string, setId: string, input: Partial<SetInput>): void;
  removeSet(exerciseLogId: string, setId: string): void;
  rateExercise(
    exerciseLogId: string,
    rating: { pumpRating?: number | null; jointDiscomfort?: number | null },
  ): void;
  finish(): void;
  discard(): void;
}

export interface WorkoutStoreDeps {
  sink: (entry: NewOutboxEntry) => void;
  storage?: () => StateStorage;
  now?: () => Date;
  uuid?: () => string;
}

// ---------- Abbildung auf DB-Zeilen (snake_case, ohne generierte Spalten) ----------

function sessionRow(s: ActiveSession, status: SessionStatus, endedAt: string | null) {
  return {
    id: s.id,
    user_id: s.userId,
    plan_id: s.planId,
    plan_day_id: s.planDayId,
    status,
    started_at: s.startedAt,
    ended_at: endedAt,
  };
}

function exerciseRow(sessionId: string, e: LoggedExercise) {
  return {
    id: e.id,
    session_id: sessionId,
    exercise_id: e.exerciseId,
    plan_exercise_id: e.planExerciseId,
    order_index: e.orderIndex,
    pump_rating: e.pumpRating,
    joint_discomfort: e.jointDiscomfort,
  };
}

function setRow(exerciseLogId: string, s: LoggedSet) {
  // e1rm_kg ist eine generierte Spalte und darf nicht mitgeschickt werden.
  return {
    id: s.id,
    exercise_log_id: exerciseLogId,
    set_index: s.setIndex,
    set_type: s.setType,
    weight_kg: s.weightKg,
    reps: s.reps,
    rir: s.rir,
    is_completed: s.isCompleted,
    completed_at: s.completedAt,
  };
}

// ---------- Validierung (spiegelt die CHECK-Constraints) ----------

function validateSet(input: Partial<SetInput>): void {
  const { weightKg, reps, rir } = input;
  if (weightKg != null && !(weightKg >= 0 && weightKg <= 9999.99)) {
    throw new RangeError("Gewicht muss zwischen 0 und 9999,99 kg liegen");
  }
  if (reps != null && !(Number.isInteger(reps) && reps >= 0 && reps <= 200)) {
    throw new RangeError("Wiederholungen müssen eine ganze Zahl zwischen 0 und 200 sein");
  }
  if (rir != null && !(rir >= 0 && rir <= 10)) {
    throw new RangeError("RIR muss zwischen 0 und 10 liegen");
  }
}

function validateRating(value: number | null | undefined): void {
  if (value != null && !(Number.isInteger(value) && value >= 0 && value <= 3)) {
    throw new RangeError("Bewertung muss 0–3 sein");
  }
}

const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

// ---------- Store ----------

export function createWorkoutStore(deps: WorkoutStoreDeps) {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  return createStore<WorkoutState>()(
    persist(
      (set, get) => {
        const requireSession = (): ActiveSession => {
          const session = get().session;
          if (!session) throw new Error("Kein laufendes Training");
          return session;
        };

        const requireExercise = (session: ActiveSession, exerciseLogId: string): LoggedExercise => {
          const exercise = session.exercises.find((e) => e.id === exerciseLogId);
          if (!exercise) throw new Error(`Übung ${exerciseLogId} nicht im Training`);
          return exercise;
        };

        const emit = (session: ActiveSession, entry: NewOutboxEntry) => {
          if (session.userId) deps.sink(entry);
        };

        const replaceExercise = (session: ActiveSession, updated: LoggedExercise): ActiveSession => ({
          ...session,
          exercises: session.exercises.map((e) => (e.id === updated.id ? updated : e)),
        });

        const emitSet = (session: ActiveSession, exerciseLogId: string, s: LoggedSet) =>
          emit(session, { table: "set_logs", op: "upsert", rowId: s.id, payload: setRow(exerciseLogId, s) });

        return {
          session: null,

          start({ userId, planId = null, planDayId = null }) {
            if (get().session) throw new Error("Es läuft bereits ein Training");
            const session: ActiveSession = {
              id: uuid(),
              userId,
              planId,
              planDayId,
              startedAt: now().toISOString(),
              exercises: [],
            };
            set({ session });
            emit(session, {
              table: "workout_sessions",
              op: "upsert",
              rowId: session.id,
              payload: sessionRow(session, "in_progress", null),
            });
            return session.id;
          },

          addExercise(exerciseId, planExerciseId = null) {
            const session = requireSession();
            const exercise: LoggedExercise = {
              id: uuid(),
              exerciseId,
              planExerciseId,
              orderIndex: session.exercises.length,
              pumpRating: null,
              jointDiscomfort: null,
              sets: [],
            };
            const next = { ...session, exercises: [...session.exercises, exercise] };
            set({ session: next });
            emit(next, {
              table: "exercise_logs",
              op: "upsert",
              rowId: exercise.id,
              payload: exerciseRow(next.id, exercise),
            });
            return exercise.id;
          },

          logSet(exerciseLogId, input) {
            validateSet(input);
            const session = requireSession();
            const exercise = requireExercise(session, exerciseLogId);
            const loggedSet: LoggedSet = {
              id: uuid(),
              setIndex: exercise.sets.length,
              setType: input.setType ?? "working",
              weightKg: round2(input.weightKg),
              reps: input.reps,
              rir: input.rir,
              isCompleted: true,
              completedAt: now().toISOString(),
            };
            const next = replaceExercise(session, { ...exercise, sets: [...exercise.sets, loggedSet] });
            set({ session: next });
            emitSet(next, exerciseLogId, loggedSet);
            return loggedSet.id;
          },

          updateSet(exerciseLogId, setId, input) {
            validateSet(input);
            const session = requireSession();
            const exercise = requireExercise(session, exerciseLogId);
            const current = exercise.sets.find((s) => s.id === setId);
            if (!current) throw new Error(`Satz ${setId} nicht gefunden`);
            const updated: LoggedSet = {
              ...current,
              ...input,
              weightKg: input.weightKg === undefined ? current.weightKg : round2(input.weightKg),
              setType: input.setType ?? current.setType,
            };
            const next = replaceExercise(session, {
              ...exercise,
              sets: exercise.sets.map((s) => (s.id === setId ? updated : s)),
            });
            set({ session: next });
            emitSet(next, exerciseLogId, updated);
          },

          removeSet(exerciseLogId, setId) {
            const session = requireSession();
            const exercise = requireExercise(session, exerciseLogId);
            if (!exercise.sets.some((s) => s.id === setId)) return;
            // Löschen zuerst, dann nachfolgende Sätze aufsteigend neu nummerieren –
            // so kollidiert unique(exercise_log_id, set_index) nie.
            const remaining = exercise.sets.filter((s) => s.id !== setId);
            const renumbered = remaining.map((s, i) => (s.setIndex === i ? s : { ...s, setIndex: i }));
            const next = replaceExercise(session, { ...exercise, sets: renumbered });
            set({ session: next });
            emit(next, { table: "set_logs", op: "delete", rowId: setId, payload: {} });
            renumbered
              .filter((s, i) => s !== remaining[i])
              .forEach((s) => emitSet(next, exerciseLogId, s));
          },

          rateExercise(exerciseLogId, rating) {
            validateRating(rating.pumpRating);
            validateRating(rating.jointDiscomfort);
            const session = requireSession();
            const exercise = requireExercise(session, exerciseLogId);
            const updated: LoggedExercise = {
              ...exercise,
              pumpRating: rating.pumpRating === undefined ? exercise.pumpRating : rating.pumpRating,
              jointDiscomfort:
                rating.jointDiscomfort === undefined ? exercise.jointDiscomfort : rating.jointDiscomfort,
            };
            const next = replaceExercise(session, updated);
            set({ session: next });
            emit(next, {
              table: "exercise_logs",
              op: "upsert",
              rowId: updated.id,
              payload: exerciseRow(next.id, updated),
            });
          },

          finish() {
            const session = requireSession();
            emit(session, {
              table: "workout_sessions",
              op: "upsert",
              rowId: session.id,
              payload: sessionRow(session, "completed", now().toISOString()),
            });
            set({ session: null });
          },

          discard() {
            const session = get().session;
            if (!session) return;
            emit(session, {
              table: "workout_sessions",
              op: "upsert",
              rowId: session.id,
              payload: sessionRow(session, "abandoned", now().toISOString()),
            });
            set({ session: null });
          },
        };
      },
      {
        name: "gym-active-workout",
        version: 1,
        storage: createJSONStorage(deps.storage ?? (() => localStorage)),
        partialize: (state) => ({ session: state.session }),
        // Rehydrierung erst nach dem ersten Render (StoreHydration), sonst Hydration-Mismatch
        skipHydration: true,
      },
    ),
  );
}

export type WorkoutStore = ReturnType<typeof createWorkoutStore>;
