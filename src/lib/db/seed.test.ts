import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSeedSql } from "./seed";

describe("supabase/seed.sql", () => {
  it("ist aktuell (sonst: npm run db:seed)", () => {
    const file = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
    expect(file).toBe(buildSeedSql());
  });
});
