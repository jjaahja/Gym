// Lese-Vertrag (Server → Gerät): Die Datenbank liefert die Zeilen so, wie PostgREST/Supabase es tut
// (row_to_json/json_agg unter RLS als angemeldeter Nutzer). Daraus muss die App denselben lokalen Stand
// wiederherstellen, den das schreibende Gerät hatte – Plan, Protokoll, Trainings, Körpermaße.
//
// Ablauf (nach Migration + Seed):
//   npx tsx scripts/verify-sync-contract.ts --state state.json | psql -v ON_ERROR_STOP=1 <db>
//   npx tsx scripts/verify-pull-contract.ts --sql | psql -qAt -v ON_ERROR_STOP=1 <db> > dump.json
//   npx tsx scripts/verify-pull-contract.ts state.json dump.json
import { readFileSync } from "node:fs";
import type { CompletedSession, Measurement } from "../src/lib/offline/db";
import { sameContent } from "../src/lib/offline/pull";
import {
  adaptationFromRemote,
  measurementFromRemote,
  planFromRemote,
  sessionFromRemote,
  type RemoteAdaptation,
  type RemoteAssessment,
  type RemoteMeasurement,
  type RemotePlan,
  type RemoteSession,
} from "../src/lib/offline/remote";
import type { AdaptationRecord, StoredPlan } from "../src/stores/plan-store";

const USER = "11111111-2222-4333-8444-555555555555";

const DUMP_SQL = `begin;
set local role authenticated;
set local request.jwt.claim.sub = '${USER}';
select json_build_object(
  'plans', coalesce((select json_agg(p) from (
    select t.*, coalesce((select json_agg(d) from (
      select pd.*, coalesce((select json_agg(pe) from public.plan_exercises pe where pe.plan_day_id = pd.id), '[]'::json) as plan_exercises
      from public.plan_days pd where pd.plan_id = t.id) d), '[]'::json) as plan_days
    from public.training_plans t) p), '[]'::json),
  'assessments', coalesce((select json_agg(a) from public.user_assessments a), '[]'::json),
  'equipment', coalesce((select json_agg(e.equipment_id) from public.user_equipment e), '[]'::json),
  'adaptations', coalesce((select json_agg(a) from public.plan_adaptations a), '[]'::json),
  'sessions', coalesce((select json_agg(s) from (
    select w.id, w.plan_id, w.plan_day_id, w.status, w.started_at, w.ended_at, w.session_rpe, w.is_deload,
      coalesce((select json_agg(l) from (
        select el.*, coalesce((select json_agg(sl) from public.set_logs sl where sl.exercise_log_id = el.id), '[]'::json) as set_logs
        from public.exercise_logs el where el.session_id = w.id) l), '[]'::json) as exercise_logs
    from public.workout_sessions w) s), '[]'::json),
  'measurements', coalesce((select json_agg(m) from public.body_measurements m), '[]'::json)
);
commit;`;

interface Dump {
  plans: RemotePlan[];
  assessments: RemoteAssessment[];
  equipment: string[];
  adaptations: RemoteAdaptation[];
  sessions: RemoteSession[];
  measurements: RemoteMeasurement[];
}

interface DeviceState {
  plans: { plan: StoredPlan; adaptations: AdaptationRecord[] }[];
  sessions: CompletedSession[];
  measurements: Measurement[];
}

const byId = <T extends { id: string }>(xs: readonly T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

function firstDifference(a: unknown, b: unknown, path = ""): string | null {
  if (sameContent(a, b)) return null;
  if (typeof a === "object" && typeof b === "object" && a && b) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: Gerät ${JSON.stringify(a)} ≠ Server ${JSON.stringify(b)}`;
}

function main() {
  if (process.argv[2] === "--sql") {
    console.log(DUMP_SQL);
    return;
  }
  const expected = JSON.parse(readFileSync(process.argv[2], "utf8")) as DeviceState;
  // psql -qAt gibt nur das JSON aus; json_agg trennt Elemente mit Zeilenumbrüchen
  const raw = readFileSync(process.argv[3], "utf8");
  const dump = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Dump;
  const errors: string[] = [];
  const compare = (label: string, device: unknown, server: unknown) => {
    const diff = firstDifference(device, server);
    if (diff) errors.push(`${label}${diff}`);
  };

  for (const { plan, adaptations } of expected.plans) {
    const row = dump.plans.find((p) => p.id === plan.id);
    const assessment = dump.assessments.find((a) => a.id === row?.assessment_id);
    if (!row || !assessment) {
      errors.push(`Plan ${plan.id} fehlt auf dem Server`);
      continue;
    }
    compare(`Plan „${plan.name}“ (${row.status})`, plan, planFromRemote(row, assessment, dump.equipment));
    compare(
      `Protokoll „${plan.name}“`,
      byId(adaptations),
      byId(dump.adaptations.filter((a) => a.plan_id === plan.id).flatMap((a) => adaptationFromRemote(a) ?? [])),
    );
  }
  compare("Trainings", byId(expected.sessions), byId(dump.sessions.flatMap((s) => sessionFromRemote(s) ?? [])));
  compare("Körpermaße", byId(expected.measurements), byId(dump.measurements.map(measurementFromRemote)));

  if (errors.length) {
    console.error(`Lese-Vertrag verletzt:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
  const adaptations = expected.plans.reduce((n, p) => n + p.adaptations.length, 0);
  console.log(
    `Lese-Vertrag OK: ${expected.plans.length} Pläne (aktiv + archiviert), ${adaptations} Anpassungen, ` +
      `${expected.sessions.length} Trainings, ${expected.measurements.length} Körpermaße aus Postgres-JSON identisch wiederhergestellt`,
  );
}

main();
