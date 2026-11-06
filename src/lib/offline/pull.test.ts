import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import { createPlanStore } from "@/stores/plan-store";
import { createWorkoutStore } from "@/stores/workout-store";
import { byId, deviceHistory, memory, USER } from "@/test/device-history";
import { GymDB } from "./db";
import { enqueue } from "./outbox";
import { pullFromServer, sameContent, type OwnerStorage } from "./pull";
import type { RemoteState } from "./remote";

/** Ein zweites, leeres Gerät. */
function newDevice(owner: string | null = null) {
  const db = new GymDB(`p-${crypto.randomUUID()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
  const entries: unknown[] = [];
  const deps = { sink: (e: unknown) => entries.push(e), storage: memory, now: () => new Date("2026-12-09T10:00:00Z") };
  const plans = createPlanStore(deps);
  const workout = createWorkoutStore(deps);
  const settings = { unitSystem: "metric" as UnitSystem, effortScale: "rir" as EffortScale };
  let stored = owner;
  const ownerStorage: OwnerStorage = { get: () => stored, set: (v) => void (stored = v) };
  return {
    db,
    plans,
    workout,
    entries,
    settings,
    owner: () => stored,
    pull: (remote: RemoteState | (() => Promise<RemoteState>), userId = USER) =>
      pullFromServer({
        db,
        plans,
        workout,
        settings: {
          setUnitSystem: (v) => void (settings.unitSystem = v),
          setEffortScale: (v) => void (settings.effortScale = v),
        },
        owner: ownerStorage,
        userId,
        fetch: typeof remote === "function" ? remote : async () => remote,
      }),
  };
}

describe("Abgleich Server → Gerät", () => {
  it("richtet ein neues Gerät vollständig ein – Plan, Protokoll, Trainings, Körpermaße, Einstellungen", async () => {
    const source = await deviceHistory();
    source.server.apply({
      table: "profiles",
      op: "upsert",
      rowId: USER,
      payload: { id: USER, unit_system: "imperial", effort_scale: "rpe" },
    });
    const device = newDevice();
    const result = await device.pull(source.server.state(USER));

    expect(result).toMatchObject({ switchedAccount: false, planReplaced: true, planSkipped: null, sessionsAdded: 2, measurements: 2 });
    expect(device.plans.getState().plan).toEqual(source.plans.getState().plan);
    expect(byId(device.plans.getState().adaptations)).toEqual(byId(source.plans.getState().adaptations));
    expect(byId(await device.db.sessions.toArray())).toEqual(byId(await source.db.sessions.toArray()));
    expect(byId(await device.db.measurements.toArray())).toEqual(byId(await source.db.measurements.toArray()));
    expect(device.settings).toEqual({ unitSystem: "imperial", effortScale: "rpe" });
    expect(device.owner()).toBe(USER);
    expect(device.entries).toEqual([]); // nichts zurück in die Outbox

    // Zweiter Abgleich ohne Änderungen: nichts zu tun
    const again = await device.pull(source.server.state(USER));
    expect(again).toMatchObject({ planReplaced: false, sessionsAdded: 0 });
  });

  it("übernimmt Änderungen eines anderen Geräts", async () => {
    const source = await deviceHistory();
    const device = newDevice();
    await device.pull(source.server.state(USER));

    source.plans.getState().advanceDay(source.plans.getState().plan!.nextDayIndex);
    const open = source.plans.getState().adaptations.find((a) => a.status === "suggested")!;
    source.plans.getState().rejectSuggestion(open.id);

    const result = await device.pull(source.server.state(USER));
    expect(result.planReplaced).toBe(true);
    expect(device.plans.getState().plan!.nextDayIndex).toBe(source.plans.getState().plan!.nextDayIndex);
    expect(device.plans.getState().adaptations.find((a) => a.id === open.id)?.status).toBe("rejected");
  });

  it("überschreibt den Plan nicht, solange lokale Änderungen ausstehen oder ein Training läuft – Trainings kommen trotzdem", async () => {
    const source = await deviceHistory();
    const remote = source.server.state(USER);

    const pending = newDevice();
    await enqueue(pending.db, { table: "profiles", op: "upsert", rowId: USER, payload: { id: USER, unit_system: "metric" } });
    const r1 = await pending.pull(remote);
    expect(r1).toMatchObject({ planReplaced: false, planSkipped: "pending_changes", sessionsAdded: 2 });
    expect(pending.plans.getState().plan).toBeNull();
    expect(pending.settings.unitSystem).toBe("metric");

    const running = newDevice();
    running.workout.getState().start({ userId: USER });
    const r2 = await running.pull(remote);
    expect(r2).toMatchObject({ planReplaced: false, planSkipped: "workout_running" });
  });

  it("verwirft nichts, was sich während des Abrufs lokal ändert", async () => {
    const source = await deviceHistory();
    const device = newDevice();
    await device.pull(source.server.state(USER));

    // Während des Abrufs: Trainingstag weiter und neue Messung (noch nicht in der Outbox)
    const result = await device.pull(async () => {
      device.plans.getState().advanceDay(0);
      await device.db.measurements.put({
        id: "local-new", measuredOn: "2026-12-09", bodyWeightKg: 81, bodyFatPercent: null, shouldersCm: null,
        chestCm: null, waistCm: null, hipsCm: null, armCm: null, thighCm: null, calfCm: null, notes: null,
      });
      return source.server.state(USER);
    });
    expect(result).toMatchObject({ planReplaced: false, planSkipped: "pending_changes" });
    expect(device.plans.getState().plan!.nextDayIndex).toBe(1);
    expect(await device.db.measurements.get("local-new")).toBeDefined();
  });

  it("übernimmt Löschungen von Körpermaßen – außer ausstehenden", async () => {
    const source = await deviceHistory();
    const device = newDevice();
    await device.pull(source.server.state(USER));
    const [first, second] = await device.db.measurements.orderBy("measuredOn").toArray();

    source.server.apply({ table: "body_measurements", op: "delete", rowId: first.id, payload: { id: first.id } });
    source.server.apply({ table: "body_measurements", op: "delete", rowId: second.id, payload: { id: second.id } });
    await enqueue(device.db, { table: "body_measurements", op: "upsert", rowId: second.id, payload: { id: second.id } });

    const result = await device.pull(source.server.state(USER));
    expect(result.measurements).toBe(1);
    expect(await device.db.measurements.get(first.id)).toBeUndefined();
    expect(await device.db.measurements.get(second.id)).toBeDefined();
  });

  it("entfernt beim Kontowechsel die Daten des vorherigen Kontos (inkl. Outbox)", async () => {
    const source = await deviceHistory();
    const device = newDevice("other-user");
    await device.db.sessions.put({ ...(await source.db.sessions.toArray())[0], id: "foreign" });
    await enqueue(device.db, { table: "profiles", op: "upsert", rowId: "other-user", payload: { id: "other-user" } });

    const result = await device.pull(source.server.state(USER));
    expect(result.switchedAccount).toBe(true);
    expect(await device.db.sessions.get("foreign")).toBeUndefined();
    expect(await device.db.outbox.count()).toBe(0);
    expect(device.plans.getState().plan?.userId).toBe(USER);
    expect(device.owner()).toBe(USER);
  });

  it("vergleicht Inhalte unabhängig von der Schlüsselreihenfolge", () => {
    expect(sameContent({ a: 1, b: [1, { c: 2, d: undefined }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameContent([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameContent(null, {})).toBe(false);
  });
});
