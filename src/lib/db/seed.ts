import { EXERCISE_VIDEOS } from "@/data/catalog/videos";
import { equipmentList, exercises, muscleGroups } from "@/lib/catalog";
import { catalogId } from "@/lib/db/stable-id";
import { guidelines, sources } from "@/lib/science";

// Erzeugt supabase/seed.sql aus dem TypeScript-Katalog (einzige Quelle der Wahrheit).
// Idempotent: kann beliebig oft ausgeführt werden (Upserts über die stabilen IDs).

type SqlValue = string | number | boolean | null | string[] | { raw: string };

function literal(value: SqlValue): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value.length === 0 ? "'{}'::text[]" : `array[${value.map((v) => literal(v)).join(", ")}]`;
  }
  if (typeof value === "object") return value.raw;
  return `'${value.replaceAll("'", "''")}'`;
}

const raw = (sql: string) => ({ raw: sql });

function upsert(table: string, columns: string[], rows: SqlValue[][], conflict = "id"): string {
  if (rows.length === 0) return "";
  const values = rows.map((row) => `  (${row.map(literal).join(", ")})`).join(",\n");
  const updates = columns
    .filter((c) => c !== conflict)
    .map((c) => `${c} = excluded.${c}`)
    .join(",\n  ");
  return `insert into public.${table} (${columns.join(", ")}) values\n${values}\non conflict (${conflict}) do update set\n  ${updates};\n`;
}

function insert(table: string, columns: string[], rows: SqlValue[][]): string {
  if (rows.length === 0) return "";
  const values = rows.map((row) => `  (${row.map(literal).join(", ")})`).join(",\n");
  return `insert into public.${table} (${columns.join(", ")}) values\n${values};\n`;
}

const idList = (ids: string[]) => `(${ids.map((id) => `'${id}'`).join(", ")})`;

export function buildSeedSql(): string {
  const exerciseIds = exercises.map((e) => e.id);
  const guidelineIds = guidelines.map((g) => g.id);
  const parts: string[] = [];

  parts.push(
    "-- AUTOMATISCH ERZEUGT aus src/data/ – nicht von Hand bearbeiten.",
    "-- Neu erzeugen: npm run db:seed",
    "-- Idempotent: Upserts über stabile UUIDs (UUIDv5 aus dem Slug, siehe src/lib/db/stable-id.ts).",
    "",
    "begin;",
    "",
    "-- Muskelgruppen",
    upsert(
      "muscle_groups",
      ["id", "slug", "name_de", "name_en", "region", "sort_order"],
      muscleGroups.map((m) => [m.id, m.slug, m.nameDe, m.nameEn, m.region, m.sortOrder]),
    ),
    "-- Equipment",
    upsert(
      "equipment",
      ["id", "slug", "name_de", "name_en"],
      equipmentList.map((e) => [e.id, e.slug, e.nameDe, e.nameEn]),
    ),
    "-- Übungen",
    upsert(
      "exercises",
      [
        "id", "slug", "name_de", "name_en", "description", "instructions", "common_mistakes", "cues",
        "mechanic", "movement_pattern", "laterality", "tracking_type", "difficulty", "resistance_profile",
        "systemic_fatigue", "load_increment_kg", "video_url",
      ],
      exercises.map((e) => [
        e.id, e.slug, e.nameDe, e.nameEn, e.description, e.instructions, e.commonMistakes, e.cues,
        e.mechanic, e.movementPattern, e.laterality, e.trackingType, e.difficulty, e.resistanceProfile,
        e.systemicFatigue, e.loadIncrementKg,
        EXERCISE_VIDEOS[e.slug] ? `https://www.youtube.com/watch?v=${EXERCISE_VIDEOS[e.slug].youtubeId}` : null,
      ]),
    ),
    "-- Muskel- und Equipment-Zuordnungen: neu aufbauen, damit entfernte Zuordnungen verschwinden",
    `delete from public.exercise_muscles where exercise_id in ${idList(exerciseIds)};`,
    insert(
      "exercise_muscles",
      ["exercise_id", "muscle_group_id", "role", "contribution"],
      exercises.flatMap((e) => e.muscles.map((m) => [e.id, catalogId("muscle", m.muscle), m.role, m.contribution])),
    ),
    `delete from public.exercise_equipment where exercise_id in ${idList(exerciseIds)};`,
    insert(
      "exercise_equipment",
      ["exercise_id", "equipment_id"],
      exercises.flatMap((e) => e.equipment.map((slug) => [e.id, catalogId("equipment", slug)])),
    ),
    "-- Wissenschaftliche Quellen",
    upsert(
      "scientific_sources",
      ["id", "citation", "title", "journal", "year", "doi", "source_type"],
      sources.map((s) => [s.id, s.citation, s.title, s.journal, s.year, s.doi, s.sourceType]),
    ),
    "-- Richtwerte",
    upsert(
      "scientific_guidelines",
      [
        "id", "key", "category", "scope_goal", "scope_experience", "scope_mechanic", "scope_muscle_group_id",
        "scope_movement_pattern", "scope_exercise_id", "min_value", "max_value", "unit", "title", "message",
        "rationale", "severity", "contexts", "evidence_grade", "priority", "is_active",
      ],
      guidelines.map((g) => [
        g.id, g.key, g.category, g.scope.goal ?? null, g.scope.experience ?? null, g.scope.mechanic ?? null,
        g.scope.muscle ? catalogId("muscle", g.scope.muscle) : null, g.scope.pattern ?? null,
        g.scope.exercise ? catalogId("exercise", g.scope.exercise) : null, g.min, g.max, g.unit, g.title,
        g.message, g.rationale, g.severity, raw(`'{${g.contexts.join(",")}}'::public.guideline_context[]`),
        g.evidenceGrade, g.priority, true,
      ]),
    ),
    "-- Richtwerte, die nicht mehr im Katalog stehen, deaktivieren (nicht löschen: Anpassungen verweisen darauf)",
    `update public.scientific_guidelines set is_active = false where id not in ${idList(guidelineIds)};`,
    "",
    `delete from public.guideline_sources where guideline_id in ${idList(guidelineIds)};`,
    insert(
      "guideline_sources",
      ["guideline_id", "source_id"],
      guidelines.flatMap((g) => g.sources.map((s) => [g.id, s.id])),
    ),
    "commit;",
    "",
  );

  return parts.join("\n");
}
