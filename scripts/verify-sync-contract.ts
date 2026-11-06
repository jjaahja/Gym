// Prüft den Vertrag zwischen App und Datenbank: Ein realistischer Ablauf mit den echten Stores
// (Plan erstellen, zwei Trainings, Progression, Rückgängig, Mesozyklus-Abschluss mit Volumen/Übungswechsel/
// Deload, Deload-Training, Körpermaße, neuer Plan) erzeugt Outbox-Einträge.
// Diese werden als SQL ausgegeben und als angemeldeter Nutzer UNTER ROW LEVEL SECURITY ausgeführt –
// so wie PostgREST/Supabase es täte. Anschließend vergleicht SQL die Ergebnisse der DB-Views mit
// den Berechnungen der App (Wochenvolumen, „Letztes Mal“, e1RM).
//
// Aufruf (nach Migration + Seed):  npx tsx scripts/verify-sync-contract.ts [--state state.json] | psql -v ON_ERROR_STOP=1 <db>
// Mit --state wird zusätzlich der lokale Stand der Geräte gespeichert – Grundlage für scripts/verify-pull-contract.ts.
import { writeFileSync } from "node:fs";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "../src/data/catalog/equipment";
import { getExercise, muscleGroups } from "../src/lib/catalog";
import { GymDB } from "../src/lib/offline/db";
import { lastPerformance } from "../src/lib/offline/history";
import { deleteMeasurement, saveMeasurement, type MeasurementInput } from "../src/lib/offline/measurements";
import { planVolume } from "../src/lib/training/mesocycle";
import type { NewOutboxEntry } from "../src/lib/offline/outbox";
import { generatePlan } from "../src/lib/training/plan-generator";
import {
  buildSwapProposal,
  checkDeload,
  estimateOneRepMax,
  findReplacement,
  reviewVolume,
} from "../src/lib/training/progression";
import { muscleVolume } from "../src/lib/training/volume";
import { completeWorkout } from "../src/lib/workout/complete";
import { createPlanStore, deloadPrescription, type AssessmentInput } from "../src/stores/plan-store";
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

  // ── Mesozyklus-Abschluss nach 5 Wochen: Volumen (auto), Übungswechsel + Deload (angenommen), Volumen über Max (abgelehnt) ──
  clock = new Date("2026-12-08T07:00:00Z");
  const before = plans.getState().plan!;
  const chestSets = Math.round((planVolume(before.days).get("chest") ?? 0) * 10) / 10;
  const volumeUp = reviewVolume({ muscle: "chest", currentSets: chestSets, min: 10, max: 20, trend: "up", jointIssues: false, fatigue: false })!;
  const tooMuch = reviewVolume({ muscle: "side_delts", currentSets: 22, min: 10, max: 20, trend: "flat", jointIssues: false, fatigue: false })!;
  const swapTarget = before.days.flatMap((d) => d.exercises).find((e) => e.exerciseSlug === "barbell-bench-press")!;
  const current = getExercise(swapTarget.exerciseSlug)!;
  const replacement = findReplacement(current, {
    goal: before.goal,
    experience: before.experience,
    equipment: before.assessment.equipment,
    inPlan: new Set(before.days.flatMap((d) => d.exercises.map((e) => e.exerciseSlug))),
  })!;
  const deload = checkDeload(
    { weeksSinceLastDeload: 5, atMesocycleEnd: true, recentSessionRpe: [8, 9], regressingExercises: 0 },
    before.days.flatMap((d) => d.exercises.map((e) => ({ planExerciseId: e.id, sets: e.sets, rirMin: e.rirMin, rirMax: e.rirMax }))),
  )!;
  const review = plans.getState().completeMesocycle({
    volume: [volumeUp],
    accepted: [
      { proposal: buildSwapProposal(current, replacement, "stagnation"), planExerciseId: swapTarget.id },
      { proposal: deload, planExerciseId: null },
    ],
    rejected: [{ proposal: tooMuch, planExerciseId: null }],
  });
  if (review.length !== 4) throw new Error(`Erwartet 4 Protokolleinträge, erhalten ${review.length}`);
  const volumeRecord = review.find((r) => r.type === "add_set")!;

  // ── Training in der Deload-Woche ──
  clock = new Date("2026-12-08T16:00:00Z");
  const afterReview = plans.getState().plan!;
  const deloadDay = afterReview.days[1];
  workout.getState().start({ userId: USER, planId: afterReview.id, planDayId: deloadDay.id, planWeek: 1, deload: true });
  const deloadEx = deloadPrescription(deloadDay.exercises[0]);
  const deloadLog = workout.getState().ensureExercise(deloadEx.exerciseId, deloadEx.id);
  for (let s = 0; s < deloadEx.sets; s++) workout.getState().logSet(deloadLog, { weightKg: 80, reps: deloadEx.repsMin, rir: 4 });
  clock = new Date("2026-12-08T16:40:00Z");
  const deloadResult = await completeWorkout({ db, workout, plans, sessionRpe: 5 });
  if (deloadResult.adaptations.length !== 0) throw new Error("Deload-Training darf keine Laständerung erzeugen");

  // Volumenänderung zurücknehmen (Sätze zurück, Protokoll „reverted“)
  plans.getState().revertAdaptation(volumeRecord.id);
  const finalSets = new Map(plans.getState().plan!.days.flatMap((d) => d.exercises.map((e) => [e.id, e.sets] as const)));
  const swappedRow = plans.getState().plan!.days.flatMap((d) => d.exercises).find((e) => e.id === swapTarget.id)!;

  // ── Körpermaße: zwei Tage, Tag 1 überschreiben, einen Tag löschen ──
  let m = 0;
  const mOptions = { userId: USER, sink: deps.sink, uuid: () => `aaaaaaaa-0000-4000-8000-${String(++m).padStart(12, "0")}` };
  const empty: MeasurementInput = {
    measuredOn: "2026-11-02", bodyWeightKg: null, bodyFatPercent: null, shouldersCm: null, chestCm: null,
    waistCm: null, hipsCm: null, armCm: null, thighCm: null, calfCm: null, notes: null,
  };
  await saveMeasurement(db, { ...empty, bodyWeightKg: 82.456, waistCm: 84.04 }, mOptions);
  await saveMeasurement(db, { ...empty, bodyWeightKg: 82.3, waistCm: 83.9, armCm: 38.2, notes: "morgens" }, mOptions);
  const dropped = await saveMeasurement(db, { ...empty, measuredOn: "2026-11-09", bodyFatPercent: 14.5 }, mOptions);
  await deleteMeasurement(db, dropped.id, mOptions);
  await saveMeasurement(db, { ...empty, measuredOn: "2026-11-16", shouldersCm: 121.5, waistCm: 83.4 }, mOptions);

  // Stand des ersten Plans, bevor er archiviert wird (für den Lese-Vertrag)
  const firstPlan = structuredClone(plans.getState().plan!);
  const firstAdaptations = structuredClone(plans.getState().adaptations);

  // ── Verworfenes Training und neuer Plan (alter wird archiviert) ──
  workout.getState().start({ userId: USER });
  workout.getState().discard();
  clock = new Date("2026-12-09T08:00:00Z");
  plans.getState().createPlan({
    userId: USER,
    assessment: { ...assessment, daysPerWeek: 3 },
    generated: generatePlan({ ...assessment, daysPerWeek: 3 }),
    weekdays: [1, 3, 5],
  });

  // ── Erwartungen aus der App-Logik ──
  const sessions = await db.sessions.toArray();
  // Wochenvolumen der Woche ab 02.11. (die Deload-Einheit im Dezember liegt in einer anderen Woche)
  const volume = muscleVolume(
    sessions.filter((s) => s.startedAt >= "2026-11-02" && s.startedAt < "2026-11-09").flatMap((s) => s.exercises),
  );
  const firstExerciseId = first.exerciseId;
  const last = await lastPerformance(db, firstExerciseId);
  const allSets = sessions.flatMap((s) => s.exercises.flatMap((e) => e.sets));

  // ── SQL ausgeben ──
  const sql: string[] = [];
  const JSON_COLUMNS = new Set(["before_state", "after_state", "muscle_targets"]);
  const lit = (v: unknown, column = ""): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object" && (JSON_COLUMNS.has(column) || !Array.isArray(v))) return `'${JSON.stringify(v).replaceAll("'", "''")}'`;
    if (Array.isArray(v)) {
      // Postgres-Array-Literal: Elemente in Anführungszeichen (Hinweistexte enthalten Kommas)
      const array = `{${v.map((x) => `"${String(x).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
      return `'${array.replaceAll("'", "''")}'`;
    }
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
        `insert into public.${e.table} (${cols.join(", ")}) values (${cols.map((c) => lit(e.payload[c], c)).join(", ")}) ` +
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
  if (select count(*) from public.workout_sessions) <> 4 then raise exception 'Erwartet 4 Sessions'; end if;
  if (select count(*) from public.workout_sessions where status = 'abandoned') <> 1 then raise exception 'Verworfene Session fehlt'; end if;
  if (select session_rpe from public.workout_sessions where started_at = '2026-11-05T16:00:00Z') <> 9 then raise exception 'Session-RPE fehlt'; end if;
  if (select count(*) from public.training_plans where status = 'active') <> 1 then raise exception 'Genau ein aktiver Plan erwartet'; end if;
  if (select count(*) from public.training_plans where status = 'archived') <> 1 then raise exception 'Alter Plan nicht archiviert'; end if;
  if (select status from public.plan_adaptations where type = 'increase_load') <> 'reverted' then raise exception 'Laständerung nicht rückgängig'; end if;

  -- Mesozyklus-Abschluss: Protokoll, Übungswechsel, Satzzahlen nach dem Rückgängigmachen
  if (select count(*) from public.plan_adaptations) <> 5 then raise exception 'Erwartet 5 Anpassungen'; end if;
  if (select status from public.plan_adaptations where type = 'add_set') <> 'reverted' then raise exception 'Volumenänderung nicht rückgängig'; end if;
  if (select (before_state->'sets') is null from public.plan_adaptations where type = 'add_set') then raise exception 'Satzzahlen fehlen im Protokoll'; end if;
  if (select status from public.plan_adaptations where type = 'swap_exercise') <> 'accepted' then raise exception 'Übungswechsel fehlt'; end if;
  if (select status from public.plan_adaptations where type = 'deload') <> 'accepted' then raise exception 'Deload fehlt'; end if;
  if (select status || ':' || reason from public.plan_adaptations where type = 'remove_set') <> 'rejected:volume_above_max' then raise exception 'Abgelehnter Vorschlag fehlt'; end if;
  if (select count(*) from public.plan_adaptations where resolved_at is null) <> 0 then raise exception 'Entscheidungen ohne resolved_at'; end if;
  if (select exercise_id::text || ':' || coalesce(target_load_kg::text, 'null') from public.plan_exercises where id = '${swapTarget.id}')
     <> '${replacement.id}:null' then raise exception 'Ersatzübung nicht synchronisiert'; end if;
  if (select target_reps_min from public.plan_exercises where id = '${swapTarget.id}') <> ${swappedRow.repsMin} then raise exception 'Vorgabe der Ersatzübung falsch'; end if;
  select count(*) into n from public.plan_exercises pe
    join (values ${[...finalSets].map(([id, sets]) => `('${id}'::uuid, ${sets})`).join(", ")}) as app(id, sets) using (id)
    where pe.target_sets <> app.sets;
  if n > 0 then raise exception 'Satzzahlen weichen in % Planübungen ab', n; end if;

  -- Deload-Training
  if (select count(*) from public.workout_sessions where is_deload and plan_week = 1 and session_rpe = 5) <> 1 then raise exception 'Deload-Session falsch'; end if;
  if (select count(*) from public.set_logs s join public.exercise_logs l on l.id = s.exercise_log_id
      join public.workout_sessions w on w.id = l.session_id where w.is_deload) <> ${deloadEx.sets} then raise exception 'Deload-Sätze fehlen'; end if;

  -- Körpermaße: ein Eintrag je Tag, gerundet wie die Spalten, gelöschter Tag fehlt
  if (select count(*) from public.body_measurements) <> 2 then raise exception 'Erwartet 2 Messungen'; end if;
  if (select body_weight_kg::text || '/' || waist_cm::text || '/' || arm_cm::text || '/' || notes from public.body_measurements where measured_on = '2026-11-02')
     <> '82.30/83.9/38.2/morgens' then raise exception 'Messung nicht überschrieben'; end if;
  if (select count(*) from public.body_measurements where measured_on = '2026-11-09') <> 0 then raise exception 'Gelöschte Messung noch da'; end if;
  if (select count(*) from public.user_equipment) <> ${assessment.equipment.length} then raise exception 'Equipment unvollständig'; end if;
  if (select count(*) from public.exercise_logs where pump_rating = 3) <> 1 then raise exception 'Pump-Bewertung fehlt'; end if;
  if (select duration_seconds from public.set_logs where duration_seconds is not null) <> 45 then raise exception 'Plank-Dauer fehlt'; end if;
  if (select onboarding_completed_at from public.profiles) is null then raise exception 'Onboarding nicht im Profil'; end if;
  if (select timezone from public.profiles) <> 'Europe/Berlin' then raise exception 'Zeitzone fehlt'; end if;

  for v in select count(*) as sessions, (select count(*) from public.set_logs) as sets, (select count(*) from public.plan_exercises) as plan_ex,
      (select count(*) from public.plan_adaptations) as adaptations, (select count(*) from public.body_measurements) as measures from public.workout_sessions loop
    raise notice 'Sync-Vertrag OK: ${entries.length} Outbox-Einträge unter RLS übernommen (% Sessions, % Sätze, % Planübungen, % Anpassungen, % Messungen); Volumen, e1RM, „Letztes Mal“, Mesozyklus und Körpermaße identisch zur App', v.sessions, v.sets, v.plan_ex, v.adaptations, v.measures;
  end loop;
end $$;`);
  // Kalender-Abo: Nutzer legt seinen Link an (RLS), Kalender-App ruft ohne Anmeldung ab (anon)
  const FEED_TOKEN = "Kx7_contract-Token-0123456789abcdefghijklmnopq";
  sql.push(
    `insert into public.calendar_feeds (user_id, token, event_time, reminder_minutes) values ('${USER}', '${FEED_TOKEN}', '07:30', 15);`,
    "set local role anon;",
    "set local request.jwt.claim.sub = '';",
    `do $$
declare f jsonb;
begin
  f := public.calendar_feed('${FEED_TOKEN}');
  if f is null then raise exception 'Kalender-Abo: Feed fehlt'; end if;
  if f->>'event_time' <> '07:30' or (f->>'reminder_minutes')::int <> 15 then raise exception 'Kalender-Abo: Einstellungen falsch'; end if;
  if jsonb_array_length(f->'plan'->'days') <> 3 then raise exception 'Kalender-Abo: erwartet 3 Tage'; end if;
  if (select string_agg(d->>'weekday', ',' order by (d->>'weekday')::int) from jsonb_array_elements(f->'plan'->'days') d) <> '1,3,5' then
    raise exception 'Kalender-Abo: Wochentage falsch';
  end if;
  if (select count(*) from jsonb_array_elements(f->'plan'->'days') d, jsonb_array_elements(d->'exercises') e) = 0 then
    raise exception 'Kalender-Abo: Übungen fehlen';
  end if;
  if public.calendar_feed('kurz') is not null or public.calendar_feed(repeat('b', 43)) is not null or public.calendar_feed(null) is not null then
    raise exception 'Kalender-Abo: ungültiger Token liefert Daten';
  end if;
  if (select count(*) from public.calendar_feeds) <> 0 then raise exception 'Kalender-Abo: anon sieht Tokens'; end if;
  if (select count(*) from public.training_plans) <> 0 then raise exception 'Kalender-Abo: anon sieht Pläne'; end if;
  raise notice 'Kalender-Abo OK: Feed nur mit gültigem Token, % Tage mit Wochentagen, Tokens und Pläne für anon unsichtbar', jsonb_array_length(f->'plan'->'days');
end $$;`,
  );
  sql.push("commit;");
  console.log(sql.join("\n"));

  const stateIndex = process.argv.indexOf("--state");
  if (stateIndex > 0) {
    writeFileSync(
      process.argv[stateIndex + 1],
      JSON.stringify({
        userId: USER,
        plans: [
          { plan: firstPlan, adaptations: firstAdaptations },
          { plan: plans.getState().plan, adaptations: plans.getState().adaptations },
        ],
        sessions: await db.sessions.toArray(),
        measurements: await db.measurements.toArray(),
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
