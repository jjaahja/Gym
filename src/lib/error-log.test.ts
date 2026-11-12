import { beforeEach, describe, expect, it } from "vitest";
import { buildReport, clearErrorLog, logError, readErrorLog } from "./error-log";

beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe("Fehlerprotokoll", () => {
  it("schreibt mit, fasst Wiederholungen zusammen, hält höchstens 30", () => {
    logError("error", "TypeError: x is undefined");
    logError("error", "TypeError: x is undefined");
    expect(readErrorLog()).toHaveLength(1);
    for (let i = 0; i < 40; i++) logError("promise", `Fehler ${i}`);
    expect(readErrorLog()).toHaveLength(30);
    expect(readErrorLog().at(-1)!.message).toBe("Fehler 39");
    clearErrorLog();
    expect(readErrorLog()).toEqual([]);
  });

  it("Bericht bleibt unter der Größengrenze und nutzt die eigene Beschreibung", () => {
    const errors = Array.from({ length: 30 }, (_, i) => ({ at: "2026-11-12T10:00:00Z", source: "error" as const, message: `${i} ${"x".repeat(390)}` }));
    const r = buildReport({ errors, sync: { pending: 3 }, appVersion: "1.3", userAgent: "UA", path: "/workout", note: "Sync hängt seit gestern" });
    expect(r.message).toBe("Sync hängt seit gestern");
    expect(new TextEncoder().encode(JSON.stringify(r.context)).length).toBeLessThanOrEqual(7000);
    expect(r.context.errors.at(-1)!.message.startsWith("29 ")).toBe(true);
  });
});
