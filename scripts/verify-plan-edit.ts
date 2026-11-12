// Prüft das Bearbeiten des Plans gegen das echte Schema: (Trainingstag, Position) ist eindeutig und wird Zeile für
// Zeile geprüft. Umsortieren, Hinzufügen, Entfernen, Tauschen und Rückgängigmachen dürfen in keinem Zwischenschritt
// eine Position doppelt belegen – weder einzeln übertragen noch gebündelt (ein Upsert mit mehreren Zeilen, wie die
// Outbox sendet). Am Ende muss der Server genau den Stand des Geräts haben.
//
// Erzeugt im angegebenen Ordner:
//   1-single.sql  – Nutzer A, jede Änderung als eigene Anweisung
//   2-batched.sql – Nutzer B, aufeinanderfolgende Upserts gebündelt (wie flushOutbox mit upsertMany)
// Aufruf (nach Migrationen + Seed): npx tsx scripts/verify-plan-edit.ts <ordner>, dann beide Dateien mit psql
// (ON_ERROR_STOP=1) als Superuser ausführen. Jede Datei endet mit Prüfungen, die bei Abweichung abbrechen.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StateStorage } from "zustand/middleware";
import { EQUIPMENT_PRESETS } from "../src/data/catalog/equipment";
import { getExercise } from "../src/lib/catalog";
import { nextBatch, type NewOutboxEntry } from "../src/lib/offline/outbox";
import type { OutboxEntry } from "../src/lib/offline/db";
import { generatePlan } from "../src/lib/training/plan-generator";
import { createPlanStore, type AssessmentInput, type StoredPlan } from "../src/stores/plan-store";

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

function upsert(table: string, rows: readonly Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0]);
  const keys = pk[table] ?? ["id"];
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  const values = rows.map((r) => `(${cols.map((c) => lit(r[c], c)).join(", ")})`).join(",\n  ");
  return (
    `insert into public.${table} (${cols.join(", ")}) values\n  ${values}\n` +
    `on conflict (${keys.join(", ")}) do ${updates.length ? `update set ${updates.join(", ")}` : "nothing"};`
  );
}

/** Wie PostgREST: als angemeldeter Nutzer; je Anweisung eine eigene Transaktion (wie je Anfrage). */
function asUser(user: string, entries: readonly NewOutboxEntry[], batched: boolean): string {
  const tx = (statement: string) =>
    ["begin;", "set local role authenticated;", `set local request.jwt.claim.sub = '${user}';`, statement, "commit;"].join("\n");
  const out: string[] = [];
  const queue = entries.map((e, i) => ({ ...e, seq: i, createdAt: 0, attempts: 0 }) as OutboxEntry);
  for (let i = 0; i < queue.length; ) {
    const batch = batched ? nextBatch(queue.slice(i)) : [queue[i]];
    const e = batch[0];
    if (e.op === "upsert") {
      // letzte Version je Zeile, wie flushOutbox
      const rows = new Map<string, Record<string, unknown>>();
      for (const b of batch) {
        rows.delete(b.rowId);
        rows.set(b.rowId, b.payload);
      }
      out.push(tx(upsert(e.table, [...rows.values()])));
    } else {
      const match = Object.keys(e.payload).length ? e.payload : { id: e.rowId };
      out.push(tx(`delete from public.${e.table} where ${Object.entries(match).map(([k, v]) => `${k} = ${lit(v)}`).join(" and ")};`));
    }
    i += batch.length;
  }
  return out.join("\n");
}

/** Bricht ab, wenn der Server-Stand eines Tages nicht dem des Geräts entspricht. */
function checks(plan: StoredPlan): string {
  return plan.days
    .map((day) => {
      const expected = day.exercises
        .map((e) => `${e.id}:${e.orderIndex}:${e.supersetGroup ?? "-"}:${e.sets}:${e.repsMin}-${e.repsMax}:${e.restSeconds}:${e.lastSetTechnique ?? "-"}:${e.exerciseId}`)
        .join(",");
      return `do $$ begin
  if (select coalesce(string_agg(id::text || ':' || order_index || ':' || coalesce(superset_group::text, '-') || ':' || target_sets || ':' ||
        target_reps_min || '-' || target_reps_max || ':' || rest_seconds || ':' || coalesce(last_set_technique::text, '-') || ':' || exercise_id,
        ',' order by order_index), '')
      from public.plan_exercises where plan_day_id = '${day.id}') is distinct from '${expected}' then
    raise exception 'Tag „${day.name}“ weicht vom Gerät ab';
  end if;
end $$;`;
    })
    .join("\n");
}

function scenario(user: string, batched: boolean): string {
  let entries: NewOutboxEntry[] = [];
  let n = 0;
  const plans = createPlanStore({
    sink: (e) => entries.push(e),
    storage: memory,
    // feste, gültige UUIDs je Nutzer
    uuid: () => `${user.slice(0, 8)}-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
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
  const s = () => plans.getState();
  s().createPlan({ userId: user, assessment, generated: generatePlan(assessment), weekdays: [1, 2, 4, 5] });
  const day = () => s().plan!.days[0];
  const ids = () => day().exercises.map((e) => e.id);

  // 1. umkehren (jede neue Position war vorher von einer anderen Übung belegt → Konfliktfall ohne freie Positionen)
  s().arrangeDay(day().id, [...ids()].reverse(), [[ids().at(-1)!, ids().at(-2)!]]);
  // 2. Übung hinzufügen, nach vorn holen, Supersatz
  const slugs = new Set(day().exercises.map((e) => e.exerciseSlug));
  const extra = ["cable-lateral-raise", "dumbbell-lateral-raise", "face-pull", "cable-curl"].find((x) => !slugs.has(x) && getExercise(x))!;
  const added = s().addPlanExercise(day().id, extra, 2)!;
  s().arrangeDay(day().id, [added.id, ...ids().filter((i) => i !== added.id)], [[added.id, ids()[1]]]);
  // 3. Vorgabe ändern
  const edit = s().editPlanExercise(ids()[2], { sets: 4, repsMin: 10, repsMax: 15, restSeconds: 90, lastSetTechnique: "myo_reps" })!;
  // 4. entfernen, umsortieren (Positionen 0…n neu), Entfernen rückgängig (alte Position inzwischen belegt)
  const removed = s().removeExercise(ids()[3])!;
  s().arrangeDay(day().id, ids(), []);
  s().revertAdaptation(removed.id);
  // 5. tauschen und rückgängig, Vorgabe rückgängig, Hinzufügen rückgängig
  const target = day().exercises.find((e) => getExercise(e.exerciseSlug)?.slug === "barbell-bench-press") ?? day().exercises[0];
  const swap = s().swapExercise(target.id, target.exerciseSlug === "dumbbell-bench-press" ? "machine-chest-press" : "dumbbell-bench-press");
  if (swap) s().revertAdaptation(swap.id);
  s().revertAdaptation(edit.id);
  s().arrangeDay(day().id, [...ids()].reverse(), []);
  const addRecord = s().adaptations.find((a) => a.type === "add_exercise")!;
  s().revertAdaptation(addRecord.id);
  // 6. noch eine dauerhafte Änderung, damit der Endstand nicht dem Anfang gleicht
  s().editPlanExercise(ids()[0], { sets: 5 });

  const sql = [
    `insert into auth.users (id, email) values ('${user}', '${user.slice(0, 8)}@test.de') on conflict do nothing;`,
    asUser(user, entries, batched),
    checks(s().plan!),
    `do $$ begin
  if (select count(*) from public.plan_adaptations where plan_id = '${s().plan!.id}' and type in ('add_exercise', 'edit_exercise')) <> 3 then
    raise exception 'Protokoll unvollständig';
  end if;
end $$;`,
    `select '${batched ? "gebündelt" : "einzeln"}: ${entries.length} Einträge, Server = Gerät' as ok;`,
  ];
  entries = [];
  return sql.join("\n");
}

const out = process.argv[2];
if (!out) throw new Error("Ordner für die SQL-Dateien angeben");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "1-single.sql"), scenario("aaaaaaaa-1111-4111-8111-111111111111", false));
writeFileSync(join(out, "2-batched.sql"), scenario("bbbbbbbb-2222-4222-8222-222222222222", true));
console.log(`SQL geschrieben nach ${out}`);
