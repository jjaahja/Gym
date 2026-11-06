// Prüft den Vertrag zwischen App und Datenbank: Ein realistischer Ablauf mit den echten Stores
// (Plan erstellen, zwei Trainings, Progression, Rückgängig, neuer Plan) erzeugt Outbox-Einträge.
// Diese werden als SQL ausgegeben und als angemeldeter Nutzer UNTER ROW LEVEL SECURITY ausgeführt –
// so wie PostgREST/Supabase es täte. Anschließend vergleicht SQL die Ergebnisse der DB-Views mit
// den Berechnungen der App (Wochenvolumen, „Letztes Mal“, e1RM).
//
// Aufruf (nach Migration + Seed):  npx tsx scripts/verify-sync-contract.ts | psql -v ON_ERROR_STOP=1 <db>
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "../src/data/catalog/equipment";
import { getExercise, muscleGroups } from "../src/lib/catalog";
import { GymDB } from "../src/lib/offline/db";
import { lastPerformance } from "../src/lib/offline/history";
import type { NewOutboxEntry } from "../src/lib/offline/outbox";
import { generatePlan } from "../src/lib/training/plan-generator";
import { estimateOneRepMax } from "../src/lib/training/progression";
import { muscleVolume } from "../src/lib/training/volume";
import { completeWorkout } from "../src/lib/workout/complete";
import { createPlanStore, type AssessmentInput } from "../src/stores/plan-store";
import { createWorkoutStore } from "../src/stores/workout-store";

const USER = "11111111-2222-4333-8444-555555555555";
const memory = (): StateStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

async function main() {
  const entries: NewOutboxEntry[] = [];
  let clock = new Date("2026-11-03T16:00:00Z"); // Dienstag
  const deps = { sink: (e: NewOutboxEntry) => entries.push(e), storage: memory, now: () => clock };
  const plans = createPlanStore(deps);
  const workout = createWorkoutStore(deps);
  const db = new GymDB("contract", { indexedDB: new IDBFactory(), IDBKeyRange });

  const assessment: AssessmentInput = {
    goal: "hypertrophy",
    experience: "intermediate",
    trainingAgeMonths: 24,
    daysPerWeek: 4,
    sessionDurationMin: 75,
    preferredSplit: null,
    priorityMuscles: ["side_delts", "lats"],
    equipment: [...EQUIPMENT_PRESETS.gym],
    limitations: "Schulter rechts empfindlich – 'Überkopf' vorsichtig",
  };
  plans.getState().createPlan({ userId: USER, assessment, generated: generatePlan(assessment), timezone: "Europe/Berlin" });

  // ── Training 1 ──
  const plan = plans.getState().plan!;
  const day = plan.days[0];
  workout.getState().start({ userId: USER, planId: plan.id, planDayId: day.id });
  for (const [i, pe] of day.exercises.slice(0, 3).entries()) {
    const log = workout.getState().ensureExercise(pe.exerciseId, pe.id);
    if (i === 0) workout.getState().logSet(log, { setType: "warmup", weightKg: 30, reps: 10, rir: null });
    workout.getState().logSet(log, { weightKg: 60, reps: pe.repsMax - 1, rir: 2 });
    const toDelete = workout.getState().logSet(log, { weightKg: 60, reps: 3, rir: 0 });
    workout.getState().removeSet(log, toDelete); // löschen + neu nummerieren
    workout.getState().logSet(log, { weightKg: 60, reps: pe.repsMax - 2, rir: 1 });
    workout.getState().logSet(log, { weightKg: 60, reps: 6, rir: 5 }); // RIR 5 → kein harter Satz, kein e1RM
    if (i === 1) workout.getState().logSet(log, { setType: "dropset", weightKg: 45, reps: 8, rir: 0 });
    workout.getState().rateExercise(log, { pumpRating: i === 2 ? 3 : 1, jointDiscomfort: 0 });
  }
  const plank = workout.getState().addExercise(getExercise("plank")!.id);
  workout.getState().logSet(plank, { weightKg: null, reps: null, rir: null, durationSeconds: 45 });
  clock = new Date("2026-11-03T17:05:00Z");
  await completeWorkout({ db, workout, plans, sessionRpe: 8 });

  // ── Training 2 (gleicher Tag, alle Sätze oben → Steigerung) ──
  clock = new Date("2026-11-05T16:00:00Z"); // Donnerstag, gleiche Woche
  workout.getState().start({ userId: USER, planId: plan.id, planDayId: day.id });
  const first = day.exercises[0];
  const log2 = workout.getState().ensureExercise(first.exerciseId, first.id);
  for (let s = 0; s < first.sets; s++) workout.getState().logSet(log2, { weightKg: 60, reps: first.repsMax, rir: 1 });
  clock = new Date("2026-11-05T16:50:00Z");
  const result = await completeWorkout({ db, workout, plans, sessionRpe: 9 });
  if (result.adaptations.length !== 1) throw new Error(`Erwartet 1 Anpassung, erhalten ${result.adaptations.length}`);
  plans.getState().revertAdaptation(result.adaptations[0].id);

  // ── Verworfenes Training und neuer Plan (alter wird archiviert) ──
  workout.getState().start({ userId: USER });
  workout.getState().discard();
  clock = new Date("2026-11-06T08:00:00Z");
  plans.getState().createPlan({ userId: USER, assessment: { ...assessment, daysPerWeek: 3 }, generated: generatePlan({ ...assessment, daysPerWeek: 3 }) });

  // ── Erwartungen aus der App-Logik ──
  const sessions = await db.sessions.toArray();
  const volume = muscleVolume(sessions.flatMap((s) => s.exercises));
  const firstExerciseId = first.exerciseId;
  const last = await lastPerformance(db, firstExerciseId);
  const allSets = sessions.flatMap((s) => s.exercises.flatMap((e) => e.sets));

  // ── SQL ausgeben ──
  const sql: string[] = [];
  const lit = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return `'{${v.join(",")}}'`;
    if (typeof v === "object") return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
    return `'${String(v).replaceAll("'", "''")}'`;
  };
  const pk: Record<string, string[]> = { user_equipment: ["user_id", "equipment_id"] };

  sql.push(`insert into auth.users (id, email) values ('${USER}', 'contract@test.de') on conflict do nothing;`);
  sql.push("begin;", "set local role authenticated;", `set local request.jwt.claim.sub = '${USER}';`);
  for (const e of entries) {
    if (e.op === "upsert") {
      const cols = Object.keys(e.payload);
      const keys = pk[e.table] ?? ["id"];
      const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
      sql.push(
        `insert into public.${e.table} (${cols.join(", ")}) values (${cols.map((c) => lit(e.payload[c])).join(", ")}) ` +
          `on conflict (${keys.join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"};`,
      );
    } else {
      const match = Object.keys(e.payload).length ? e.payload : { id: e.rowId };
      sql.push(`delete from public.${e.table} where ${Object.entries(match).map(([k, v]) => `${k} = ${lit(v)}`).join(" and ")};`);
    }
  }

  // Erwartetes Wochenvolumen
  sql.push("create temp table expected_volume (muscle_group_id uuid, hard_sets numeric);");
  const rows = muscleGroups.filter((m) => volume.has(m.slug)).map((m) => `('${m.id}', ${volume.get(m.slug)!.total})`);
  sql.push(`insert into expected_volume values ${rows.join(", ")};`);
  sql.push("create temp table expected_e1rm (set_id uuid, e1rm numeric);");
  sql.push(`insert into expected_e1rm values ${allSets.map((s) => `('${s.id}', ${estimateOneRepMax(s) ?? "null"})`).join(", ")};`);

  sql.push(`do $$
declare n int; v record;
begin
  -- Wochenvolumen: View = App
  select count(*) into n from expected_volume e
    full join (select muscle_group_id, hard_sets from public.weekly_muscle_volume where week_start = '2026-11-02') a using (muscle_group_id)
    where abs(coalesce(e.hard_sets, -1) - coalesce(a.hard_sets, -2)) > 1e-9;
  if n > 0 then raise exception 'Wochenvolumen weicht in % Muskeln ab', n; end if;

  -- e1RM: generierte Spalte = App
  select count(*) into n from expected_e1rm e join public.set_logs s on s.id = e.set_id where e.e1rm is distinct from s.e1rm_kg;
  if n > 0 then raise exception 'e1RM weicht in % Sätzen ab', n; end if;

  -- Letztes Mal: View = App
  select count(*) into n from public.exercise_last_performance
    where exercise_id = '${firstExerciseId}' and session_id = '${last!.sessionId}'
      and jsonb_array_length(sets) = ${last!.sets.filter((s) => s.setType !== "warmup").length};
  if n <> 1 then raise exception 'exercise_last_performance passt nicht zur App'; end if;

  -- Status, Pläne, Anpassungen, Profil
  if (select count(*) from public.workout_sessions) <> 3 then raise exception 'Erwartet 3 Sessions'; end if;
  if (select count(*) from public.workout_sessions where status = 'abandoned') <> 1 then raise exception 'Verworfene Session fehlt'; end if;
  if (select session_rpe from public.workout_sessions where started_at = '2026-11-05T16:00:00Z') <> 9 then raise exception 'Session-RPE fehlt'; end if;
  if (select count(*) from public.training_plans where status = 'active') <> 1 then raise exception 'Genau ein aktiver Plan erwartet'; end if;
  if (select count(*) from public.training_plans where status = 'archived') <> 1 then raise exception 'Alter Plan nicht archiviert'; end if;
  if (select status from public.plan_adaptations) <> 'reverted' then raise exception 'Anpassung nicht rückgängig'; end if;
  if (select count(*) from public.user_equipment) <> ${assessment.equipment.length} then raise exception 'Equipment unvollständig'; end if;
  if (select count(*) from public.exercise_logs where pump_rating = 3) <> 1 then raise exception 'Pump-Bewertung fehlt'; end if;
  if (select duration_seconds from public.set_logs where duration_seconds is not null) <> 45 then raise exception 'Plank-Dauer fehlt'; end if;
  if (select onboarding_completed_at from public.profiles) is null then raise exception 'Onboarding nicht im Profil'; end if;
  if (select timezone from public.profiles) <> 'Europe/Berlin' then raise exception 'Zeitzone fehlt'; end if;

  for v in select count(*) as sessions, (select count(*) from public.set_logs) as sets, (select count(*) from public.plan_exercises) as plan_ex from public.workout_sessions loop
    raise notice 'Sync-Vertrag OK: ${entries.length} Outbox-Einträge unter RLS übernommen (% Sessions, % Sätze, % Planübungen); Volumen, e1RM und „Letztes Mal“ identisch zur App', v.sessions, v.sets, v.plan_ex;
  end loop;
end $$;`);
  sql.push("commit;");
  console.log(sql.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
