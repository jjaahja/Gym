import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import type { AdaptationRecord, PlanStore } from "@/stores/plan-store";
import type { WorkoutStore } from "@/stores/workout-store";
import type { GymDB } from "./db";
import { adaptationFromRemote, measurementFromRemote, planFromRemote, sessionFromRemote, type RemoteState } from "./remote";

// Server → Gerät. Läuft nach dem Hochladen der Outbox. Regeln:
// - Wem gehören die lokalen Daten? Anderes Konto → lokale Daten (inkl. Outbox) verwerfen.
// - Trainings: zusammenführen (Server ergänzt; nur lokal vorhandene bleiben, bis sie hochgeladen sind).
// - Körpermaße: Server-Stand übernehmen (auch Löschungen), solange lokal nichts dazu aussteht.
// - Plan, Anpassungen, Einstellungen: nur ersetzen, wenn lokal nichts aussteht und kein Training läuft –
//   sonst würde ein älterer Server-Stand frische Änderungen dieses Geräts überschreiben.

export interface OwnerStorage {
  get(): string | null;
  set(userId: string): void;
}

export const localOwner: OwnerStorage = {
  get() {
    try {
      return localStorage.getItem("gym-data-owner");
    } catch {
      return null;
    }
  },
  set(userId) {
    try {
      localStorage.setItem("gym-data-owner", userId);
    } catch {
      // ohne Speicher keine Kontoprüfung – der Abgleich funktioniert trotzdem
    }
  },
};

export interface PullDeps {
  db: GymDB;
  plans: PlanStore;
  workout: WorkoutStore;
  settings: { setUnitSystem(v: UnitSystem): void; setEffortScale(v: EffortScale): void };
  owner: OwnerStorage;
  userId: string;
  fetch: () => Promise<RemoteState>;
  /** Wartet, bis Einträge in der Schreibkette in der Outbox liegen */
  settle?: () => Promise<void>;
}

export interface PullResult {
  /** Lokale Daten eines anderen Kontos wurden entfernt */
  switchedAccount: boolean;
  sessionsAdded: number;
  measurements: number;
  /** Plan vom Server übernommen (oder entfernt) */
  planReplaced: boolean;
  /** Warum der Plan nicht angefasst wurde */
  planSkipped: "pending_changes" | "workout_running" | null;
}

/** Inhaltlicher Vergleich, unabhängig von der Reihenfolge der Objektschlüssel. */
export function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameContent((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

export async function pullFromServer(deps: PullDeps): Promise<PullResult> {
  const { db, plans, workout, userId } = deps;
  const result: PullResult = { switchedAccount: false, sessionsAdded: 0, measurements: 0, planReplaced: false, planSkipped: null };

  // 1) Kontowechsel auf diesem Gerät
  const owner = deps.owner.get();
  const localPlanOwner = plans.getState().plan?.userId;
  if ((owner && owner !== userId) || (localPlanOwner && localPlanOwner !== userId)) {
    await db.transaction("rw", db.outbox, db.sessions, db.measurements, async () => {
      await db.outbox.clear();
      await db.sessions.clear();
      await db.measurements.clear();
    });
    plans.getState().clear();
    workout.setState({ session: null });
    result.switchedAccount = true;
  }
  deps.owner.set(userId);

  // Stand vor dem Abruf: Was sich währenddessen lokal ändert, wird nicht überschrieben
  const planBefore = plans.getState().plan;
  const adaptationsBefore = plans.getState().adaptations;
  const measuresBefore = new Map((await db.measurements.toArray()).map((m) => [m.id, m]));

  const remote = await deps.fetch();
  await deps.settle?.();
  const pending = await db.outbox.toArray();

  // 2) Trainings zusammenführen
  const sessions = remote.sessions.flatMap((s) => sessionFromRemote(s) ?? []);
  const known = new Set(await db.sessions.toCollection().primaryKeys());
  result.sessionsAdded = sessions.filter((s) => !known.has(s.id)).length;
  await db.sessions.bulkPut(sessions);

  // 3) Körpermaße
  const pendingMeasures = new Set(pending.filter((e) => e.table === "body_measurements").map((e) => e.rowId));
  const measurements = remote.measurements.map(measurementFromRemote).filter((m) => !pendingMeasures.has(m.id));
  await db.transaction("rw", db.measurements, async () => {
    const remoteIds = new Set(measurements.map((m) => m.id));
    // Lokal, aber nicht (mehr) auf dem Server, nicht ausstehend und seit dem Abruf unverändert
    // → auf einem anderen Gerät gelöscht
    const stale = (await db.measurements.toArray()).filter(
      (m) => !pendingMeasures.has(m.id) && !remoteIds.has(m.id) && sameContent(m, measuresBefore.get(m.id)),
    );
    await db.measurements.bulkDelete(stale.map((m) => m.id));
    await db.measurements.bulkPut(measurements);
  });
  result.measurements = await db.measurements.count();

  // 4) Plan, Anpassungen, Einstellungen – nur ohne ausstehende Änderungen
  const changedMeanwhile = plans.getState().plan !== planBefore || plans.getState().adaptations !== adaptationsBefore;
  if (pending.length > 0 || changedMeanwhile) {
    result.planSkipped = "pending_changes";
    return result;
  }
  if (workout.getState().session) {
    result.planSkipped = "workout_running";
    return result;
  }

  if (remote.profile) {
    deps.settings.setUnitSystem(remote.profile.unit_system);
    deps.settings.setEffortScale(remote.profile.effort_scale);
  }

  const local = plans.getState();
  if (remote.plan && remote.assessment) {
    const plan = planFromRemote(remote.plan, remote.assessment, remote.equipmentIds);
    const adaptations = remote.adaptations
      .flatMap((a) => adaptationFromRemote(a) ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || keepLocalOrder(local.adaptations, a, b));
    if (!sameContent(plan, local.plan) || !sameContent(adaptations, local.adaptations)) {
      plans.getState().replaceFromServer({ plan, adaptations });
      result.planReplaced = true;
    }
  } else if (local.plan && local.plan.userId !== userId) {
    plans.getState().clear();
    result.planReplaced = true;
  }
  return result;
}

/** Gleiche Zeitstempel (eine Mesozyklus-Auswertung): Reihenfolge des Geräts beibehalten, sonst stabil nach ID. */
function keepLocalOrder(local: readonly AdaptationRecord[], a: AdaptationRecord, b: AdaptationRecord): number {
  const ia = local.findIndex((r) => r.id === a.id);
  const ib = local.findIndex((r) => r.id === b.id);
  if (ia >= 0 && ib >= 0) return ia - ib;
  return a.id.localeCompare(b.id);
}
