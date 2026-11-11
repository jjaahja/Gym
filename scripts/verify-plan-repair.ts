// Prüft die Selbstreparatur gegen echte Zugriffsregeln (Row Level Security), nachgestellt nach einem Fall aus
// dem Live-Betrieb: Beim Anlegen des Plans kamen nur Fragebogen und Ausstattung auf dem Server an, der Plan
// selbst nicht. Danach scheiterte jedes Training mit „new row violates row-level security policy for table
// workout_sessions“ (die Regel verlangt einen eigenen Plan) – und die strikt geordnete Outbox hing.
//
// Erzeugt drei SQL-Dateien im angegebenen Ordner:
//   1-arrived.sql  – was damals ankam (muss klappen)
//   2-stuck.sql    – die wartende Outbox OHNE Reparatur (muss an workout_sessions scheitern)
//   3-repaired.sql – die Outbox nach dem Abgleich (Plan davor gestellt; muss klappen) + Prüfungen
//
// Aufruf (nach Migration + Seed): npx tsx scripts/verify-plan-repair.ts <ordner>, dann die Dateien der Reihe nach
// mit psql als Superuser ausführen (die Einträge selbst laufen als Rolle „authenticated“).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "../src/data/catalog/equipment";
import { GymDB } from "../src/lib/offline/db";
import { enqueueMany, type NewOutboxEntry } from "../src/lib/offline/outbox";
import { pullFromServer, type OwnerStorage } from "../src/lib/offline/pull";
import type { RemoteState } from "../src/lib/offline/remote";
import { generatePlan } from "../src/lib/training/plan-generator";
import { completeWorkout } from "../src/lib/workout/complete";
import { createPlanStore, type AssessmentInput } from "../src/stores/plan-store";
import { createWorkoutStore } from "../src/stores/workout-store";

const USER = "22222222-3333-4444-8555-666666666666";
const memory = (): StateStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

const JSON_COLUMNS = new Set(["before_state", "after_state", "muscle_targets"]);
const lit = (v: unknown, column = ""): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && (JSON_COLUMNS.has(column) || !Array.isArray(v))) return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
  if (Array.isArray(v)) {
    const array = `{${v.map((x) => `"${String(x).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
    return `'${array.replaceAll("'", "''")}'`;
  }
  return `'${String(v).replaceAll("'", "''")}'`;
};
const pk: Record<string, string[]> = { user_equipment: ["user_id", "equipment_id"] };

/** Wie PostgREST: als angemeldeter Nutzer, Upsert = insert … on conflict do update. */
function asUser(entries: readonly NewOutboxEntry[], extra: string[] = []): string {
  const sql = ["begin;", "set local role authenticated;", `set local request.jwt.claim.sub = '${USER}';`];
  for (const e of entries) {
    if (e.op === "upsert") {
      const cols = Object.keys(e.payload);
      const keys = pk[e.table] ?? ["id"];
      const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
      sql.push(
        `insert into public.${e.table} (${cols.join(", ")}) values (${cols.map((c) => lit(e.payload[c], c)).join(", ")}) ` +
          `on conflict (${keys.join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"};`,
      );
    } else {
      const match = Object.keys(e.payload).length ? e.payload : { id: e.rowId };
      sql.push(`delete from public.${e.table} where ${Object.entries(match).map(([k, v]) => `${k} = ${lit(v)}`).join(" and ")};`);
    }
  }
  return [...sql, ...extra, "commit;", ""].join("\n");
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("Ordner für die SQL-Dateien angeben");
  mkdirSync(out, { recursive: true });

  let sinkEntries: NewOutboxEntry[] = [];
  let clock = new Date("2026-11-06T12:26:00Z");
  const deps = { sink: (e: NewOutboxEntry) => sinkEntries.push(e), storage: memory, now: () => clock };
  const plans = createPlanStore(deps);
  const workout = createWorkoutStore(deps);
  const db = new GymDB("repair", { indexedDB: new IDBFactory(), IDBKeyRange });

  // ── Plan anlegen: nur Fragebogen und Ausstattung kommen an ──
  const assessment: AssessmentInput = {
    goal: "hypertrophy",
    experience: "intermediate",
    trainingAgeMonths: 24,
    daysPerWeek: 4,
    sessionDurationMin: 75,
    preferredSplit: null,
    priorityMuscles: ["side_delts"],
    equipment: [...EQUIPMENT_PRESETS.gym],
    limitations: "",
  };
  plans.getState().createPlan({ userId: USER, assessment, generated: generatePlan(assessment), weekdays: [1, 2, 4, 5] });
  const arrived = sinkEntries.filter((e) => e.table === "user_assessments" || e.table === "user_equipment");
  sinkEntries = [];

  // ── Training mit dem Plan (wartet in der Outbox) ──
  const plan = plans.getState().plan!;
  const day = plan.days[0];
  clock = new Date("2026-11-10T16:00:00Z");
  workout.getState().start({ userId: USER, planId: plan.id, planDayId: day.id, planWeek: 1 });
  for (const pe of day.exercises.slice(0, 2)) {
    const log = workout.getState().ensureExercise(pe.exerciseId, pe.id);
    for (let s = 0; s < 2; s++) workout.getState().logSet(log, { weightKg: 50, reps: pe.repsMax - 1, rir: 2 });
  }
  clock = new Date("2026-11-10T17:00:00Z");
  await completeWorkout({ db, workout, plans, sessionRpe: 8 });
  const stuck = sinkEntries;
  sinkEntries = [];
  await enqueueMany(db, stuck);

  // ── Abgleich: Server kennt keinen Plan ──
  let owner: string | null = USER;
  const ownerStorage: OwnerStorage = { get: () => owner, set: (v) => void (owner = v) };
  const remote: RemoteState = {
    profile: null,
    plan: null,
    assessment: null,
    equipmentIds: [],
    adaptations: [],
    sessions: [],
    measurements: [],
  };
  const result = await pullFromServer({
    db,
    plans,
    workout,
    settings: { setUnitSystem: () => {}, setEffortScale: () => {} },
    owner: ownerStorage,
    userId: USER,
    fetch: async () => remote,
  });
  if (!result.planRepublished) throw new Error("Plan wurde nicht neu eingereiht");
  if (sinkEntries.length > 0) throw new Error("Reparatur darf nicht hinten anhängen");
  const repaired = (await db.outbox.orderBy("seq").toArray()).map(({ table, op, rowId, payload }) => ({ table, op, rowId, payload }));

  const sessions = stuck.filter((e) => e.table === "workout_sessions");
  const logs = new Set(stuck.filter((e) => e.table === "exercise_logs").map((e) => e.rowId));
  const sets = new Set(stuck.filter((e) => e.table === "set_logs").map((e) => e.rowId));

  writeFileSync(join(out, "1-arrived.sql"), `insert into auth.users (id, email) values ('${USER}', 'repair@test.de') on conflict do nothing;\n${asUser(arrived)}`);
  writeFileSync(join(out, "2-stuck.sql"), asUser(stuck));
  writeFileSync(
    join(out, "3-repaired.sql"),
    asUser(repaired, [
      `do $$ begin
  if (select count(*) from public.training_plans where id = '${plan.id}' and status = 'active') <> 1 then raise exception 'Plan fehlt'; end if;
  if (select count(*) from public.plan_days where plan_id = '${plan.id}') <> ${plan.days.length} then raise exception 'Trainingstage fehlen'; end if;
  if (select count(*) from public.workout_sessions where id = '${sessions[0].rowId}' and plan_id = '${plan.id}' and status = 'completed') <> 1 then raise exception 'Training fehlt'; end if;
  if (select count(*) from public.exercise_logs where session_id = '${sessions[0].rowId}') <> ${logs.size} then raise exception 'Übungen fehlen'; end if;
  if (select count(*) from public.set_logs s join public.exercise_logs l on l.id = s.exercise_log_id where l.session_id = '${sessions[0].rowId}') <> ${sets.size} then raise exception 'Sätze fehlen'; end if;
  if (select next_day_index from public.training_plans where id = '${plan.id}') <> ${plans.getState().plan!.nextDayIndex} then raise exception 'Planstand veraltet'; end if;
  raise notice 'OK: Plan, % Tage, Training mit % Übungen und % Sätzen', ${plan.days.length}, ${logs.size}, ${sets.size};
end $$;`,
    ]),
  );
  console.log(
    JSON.stringify({ arrived: arrived.length, stuck: stuck.length, repaired: repaired.length, firstStuck: stuck[0].table, sessions: sessions.length }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
