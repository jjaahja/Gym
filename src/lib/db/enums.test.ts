import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DB_ENUMS } from "./enums";

// Liest alle `create type public.x as enum (...)` aus den Migrationen.
// Hinweis: Spätere `alter type ... add value`-Migrationen werden hier nicht erkannt –
// dann diesen Parser erweitern.
function parseSqlEnums(): Record<string, string[]> {
  const dir = join(process.cwd(), "supabase/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  const result: Record<string, string[]> = {};
  for (const match of sql.matchAll(/create type public\.(\w+) as enum \(([\s\S]*?)\);/g)) {
    result[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((v) => v[1]);
  }
  return result;
}

describe("DB_ENUMS ist synchron zum SQL-Schema", () => {
  const sqlEnums = parseSqlEnums();

  it("findet die Enums im SQL", () => {
    expect(Object.keys(sqlEnums).length).toBeGreaterThan(20);
  });

  it("enthält genau die Enums aus dem SQL", () => {
    expect(Object.keys(DB_ENUMS).sort()).toEqual(Object.keys(sqlEnums).sort());
  });

  it.each(Object.keys(sqlEnums))("%s hat dieselben Werte in derselben Reihenfolge", (name) => {
    expect([...DB_ENUMS[name as keyof typeof DB_ENUMS]]).toEqual(sqlEnums[name]);
  });
});
