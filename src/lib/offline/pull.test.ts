import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import { createPlanStore } from "@/stores/plan-store";
import { createWorkoutStore } from "@/stores/workout-store";
import { byId, deviceHistory, memory, USER } from "@/test/device-history";
import { GymDB } from "./db";
import { enqueue, flushOutbox } from "./outbox";
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

describe("Selbstreparatur", () => {
  it("lädt den Plan erneut hoch, wenn der Server ihn nicht kennt (z. B. App sofort geschlossen)", async () => {
    const source = await deviceHistory();
    const device = newDevice();
    await device.pull(source.server.state(USER));

    const emptyServer = { ...source.server.state(USER), plan: null, assessment: null, adaptations: [] };
    const result = await device.pull(emptyServer);
    expect(result.planRepublished).toBe(true);
    const tables = (await device.db.outbox.orderBy("seq").toArray()).map((e) => e.table);
    expect(tables[0]).toBe("user_assessments");
    expect(tables).toContain("training_plans");
    expect(tables.filter((t) => t === "plan_days")).toHaveLength(4);
    expect(tables.at(-1)).toBe("plan_adaptations");
    expect(tables.indexOf("training_plans")).toBeLessThan(tables.indexOf("plan_days"));
    expect(device.entries).toEqual([]); // direkt in die Outbox, nicht hinten angehängt
    // Plan bleibt lokal unverändert
    expect(device.plans.getState().plan).toEqual(source.plans.getState().plan);
  });

  it("löst hängende Trainings: Plan fehlt auf dem Server, Training wartet → Plan wird davor gestellt", async () => {
    // Fall aus dem Live-Betrieb: Beim Anlegen kam nur ein Teil des Plans an (Fragebogen ja, Plan nein).
    // Ein Training mit plan_id scheitert an der Zugriffsregel, die Outbox hängt – und weil etwas aussteht,
    // lief die alte Selbstreparatur nie.
    const source = await deviceHistory();
    const device = newDevice();
    await device.pull(source.server.state(USER));
    const plan = device.plans.getState().plan!;
    const session = {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      user_id: USER,
      plan_id: plan.id,
      plan_day_id: plan.days[0].id,
      status: "in_progress",
      started_at: "2026-12-09T09:00:00.000Z",
    };
    await enqueue(device.db, { table: "workout_sessions", op: "upsert", rowId: session.id, payload: session });
    await enqueue(device.db, {
      table: "exercise_logs",
      op: "upsert",
      rowId: "aaaaaaaa-0000-4000-8000-000000000002",
      payload: { id: "aaaaaaaa-0000-4000-8000-000000000002", session_id: session.id, plan_exercise_id: plan.days[0].exercises[0].id },
    });
    // nach dem Training: Planzeile (nächster Tag) – älterer Stand als der, den die Reparatur hochlädt
    await enqueue(device.db, { table: "training_plans", op: "upsert", rowId: plan.id, payload: { id: plan.id, user_id: USER, next_day_index: 0 } });
    await enqueue(device.db, { table: "profiles", op: "upsert", rowId: USER, payload: { id: USER, unit_system: "imperial" } });

    // Server mit echter Zugriffsregel: Training nur mit eigenem Plan, Kindzeilen nur mit vorhandenem Elternteil
    const server = strictServer();
    const before = await flushOutbox(device.db, server.backend);
    expect(before.error).toBe('new row violates row-level security policy for table "workout_sessions"');
    expect(before.remaining).toBe(4);

    const emptyServer = { ...source.server.state(USER), plan: null, assessment: null, adaptations: [] };
    const result = await device.pull(emptyServer);
    expect(result).toMatchObject({ planRepublished: true, planSkipped: "pending_changes" });

    const queued = await device.db.outbox.orderBy("seq").toArray();
    const firstSession = queued.findIndex((e) => e.table === "workout_sessions");
    expect(queued.findIndex((e) => e.table === "training_plans")).toBeLessThan(firstSession);
    expect(queued.findIndex((e) => e.table === "plan_exercises")).toBeLessThan(firstSession);
    // veraltete Planzeile ersetzt, Profiländerung (andere Spalten) bleibt hinten
    expect(queued.filter((e) => e.table === "training_plans")).toHaveLength(1);
    expect(queued.at(-1)).toMatchObject({ table: "profiles", payload: { unit_system: "imperial" } });

    const after = await flushOutbox(device.db, server.backend);
    expect(after).toEqual({ synced: queued.length, remaining: 0 });
    expect(server.rows("workout_sessions")).toHaveLength(1);
    expect(server.rows("training_plans")[0]).toMatchObject({ id: plan.id, status: "active", next_day_index: plan.nextDayIndex });
    expect(server.rows("profiles")[0]).toMatchObject({ unit_system: "imperial" });

    // Während eines laufenden Trainings ebenso (der lokale Plan wird dabei nicht angefasst)
    const running = newDevice();
    await running.pull(source.server.state(USER));
    running.workout.getState().start({ userId: USER });
    const r2 = await running.pull(emptyServer);
    expect(r2).toMatchObject({ planRepublished: true, planSkipped: "workout_running" });
  });
});

/** Fake-Supabase mit den Prüfungen der Zugriffsregeln/Fremdschlüssel, die für die Reihenfolge zählen. */
function strictServer() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => tables.get(name) ?? tables.set(name, new Map()).get(name)!;
  const key = (name: string, row: Record<string, unknown>) =>
    name === "user_equipment" ? `${row.user_id}:${row.equipment_id}` : String(row.id);
  const has = (name: string, id: unknown) => id != null && table(name).has(String(id));
  const check = (name: string, row: Record<string, unknown>) => {
    const rls = () => new Error(`new row violates row-level security policy for table "${name}"`);
    if (name === "workout_sessions" && row.plan_id != null && !has("training_plans", row.plan_id)) throw rls();
    if (name === "plan_days" && !has("training_plans", row.plan_id)) throw rls();
    if (name === "plan_exercises" && !has("plan_days", row.plan_day_id)) throw rls();
    if (name === "plan_adaptations" && !has("training_plans", row.plan_id)) throw rls();
    if (name === "exercise_logs" && !has("workout_sessions", row.session_id)) throw rls();
    if (name === "exercise_logs" && row.plan_exercise_id != null && !has("plan_exercises", row.plan_exercise_id)) {
      throw new Error('insert or update on table "exercise_logs" violates foreign key constraint');
    }
  };
  const upsert = (name: string, row: Record<string, unknown>) => {
    const k = key(name, row);
    check(name, { ...table(name).get(k), ...row });
    table(name).set(k, { ...table(name).get(k), ...row });
  };
  return {
    rows: (name: string) => [...table(name).values()],
    backend: {
      async upsert(name: string, row: Record<string, unknown>) {
        upsert(name, row);
      },
      async upsertMany(name: string, rows: Record<string, unknown>[]) {
        for (const row of rows) check(name, { ...table(name).get(key(name, row)), ...row });
        rows.forEach((row) => upsert(name, row));
      },
      async remove(name: string, match: Record<string, unknown>) {
        for (const [k, row] of table(name)) if (Object.entries(match).every(([c, v]) => row[c] === v)) table(name).delete(k);
      },
    },
  };
}
