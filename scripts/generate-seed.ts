// Schreibt supabase/seed.sql aus dem TypeScript-Katalog. Aufruf: npm run db:seed
import { writeFileSync } from "node:fs";
import { buildSeedSql } from "../src/lib/db/seed";

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), buildSeedSql());
console.log("supabase/seed.sql aktualisiert");
