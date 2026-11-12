import { describe, expect, it } from "vitest";
import type { OutboxEntry } from "@/lib/offline/db";
import { ageLabel, isPermanentError, syncProblem } from "./sync-health";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const entry = (seq: number, minutesAgo: number, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  seq,
  table: "set_logs",
  op: "upsert",
  rowId: `r${seq}`,
  payload: {},
  createdAt: NOW - minutesAgo * 60_000,
  attempts: 0,
  ...extra,
});

describe("Sync-Probleme", () => {
  it("frisch wartende Einträge sind kein Problem", () => {
    expect(syncProblem([], NOW)).toBeNull();
    expect(syncProblem([entry(1, 10), entry(2, 5)], NOW)).toBeNull();
  });

  it("hängt nach 3 Fehlversuchen des vordersten Eintrags", () => {
    const p = syncProblem([entry(2, 5), entry(1, 20, { table: "workout_sessions", attempts: 3, lastError: 'new row violates row-level security policy for table "workout_sessions"' })], NOW)!;
    expect(p).toMatchObject({ pending: 2, blocking: { seq: 1, label: "Training", attempts: 3 }, permanent: true });
  });

  it("hängt, wenn online seit 6 Stunden nichts übertragen wurde – offline nicht", () => {
    expect(syncProblem([entry(1, 7 * 60)], NOW)).toMatchObject({ permanent: false });
    expect(syncProblem([entry(1, 7 * 60)], NOW, false)).toBeNull();
  });

  it("Netzfehler sind nie dauerhaft", () => {
    expect(isPermanentError("TypeError: Failed to fetch")).toBe(false);
    expect(isPermanentError("JWT expired")).toBe(false);
    expect(isPermanentError('duplicate key value violates unique constraint "x"')).toBe(true);
    expect(isPermanentError(undefined)).toBe(false);
  });

  it("Alter lesbar", () => {
    expect(ageLabel(30 * 60_000)).toBe("seit wenigen Minuten");
    expect(ageLabel(3 * 3_600_000)).toBe("seit 3 Stunden");
    expect(ageLabel(26 * 3_600_000)).toBe("seit 1 Tag");
  });
});
