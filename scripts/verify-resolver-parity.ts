// Gibt SQL aus, das prüft, ob die Datenbank-Funktionen resolve_exercise_guidelines() und
// resolve_muscle_guidelines() für ALLE Kombinationen dieselben Richtwerte wählen wie src/lib/science.
// Aufruf (nach Migration + Seed):  npx tsx scripts/verify-resolver-parity.ts | psql -v ON_ERROR_STOP=1 <db>
import { exercises, muscleGroups } from "../src/lib/catalog";
import { DB_ENUMS } from "../src/lib/db/enums";
import { EXERCISE_CATEGORIES, MUSCLE_CATEGORIES, resolveExerciseGuidelines, resolveMuscleGuidelines } from "../src/lib/science";

const rows: string[] = [];
const q = (v: string | null) => (v === null ? "null" : `'${v}'`);

for (const goal of DB_ENUMS.training_goal) {
  for (const level of DB_ENUMS.experience_level) {
    for (const e of exercises) {
      const r = resolveExerciseGuidelines(e, goal, level);
      for (const c of EXERCISE_CATEGORIES) rows.push(`('exercise','${e.id}','${goal}','${level}','${c}',${q(r[c]?.key ?? null)})`);
    }
    for (const m of muscleGroups) {
      const r = resolveMuscleGuidelines(m.slug, goal, level);
      for (const c of MUSCLE_CATEGORIES) rows.push(`('muscle','${m.id}','${goal}','${level}','${c}',${q(r[c]?.key ?? null)})`);
    }
  }
}

console.log(`
create temp table expected (kind text, target uuid, goal public.training_goal, experience public.experience_level,
  category public.guideline_category, key text);
insert into expected values
${rows.join(",\n")};

create temp table actual as
  select 'exercise'::text as kind, t.target, t.goal, t.experience, g.category, g.key
  from (select distinct target, goal, experience from expected where kind = 'exercise') t
  cross join lateral public.resolve_exercise_guidelines(t.target, t.goal, t.experience) g
  union all
  select 'muscle', t.target, t.goal, t.experience, g.category, g.key
  from (select distinct target, goal, experience from expected where kind = 'muscle') t
  cross join lateral public.resolve_muscle_guidelines(t.target, t.goal, t.experience) g;

do $$
declare checked int; mismatches int;
begin
  select count(*) into checked from expected;
  select count(*) into mismatches
  from expected e
  full join actual a using (kind, target, goal, experience, category)
  where e.key is distinct from a.key and not (e.key is null and a.key is null);
  if mismatches > 0 then
    raise exception 'Resolver-Parität verletzt: % von % Kombinationen weichen ab', mismatches, checked;
  end if;
  raise notice 'Resolver-Parität OK: % Kombinationen identisch (TypeScript = SQL)', checked;
end $$;
`);
