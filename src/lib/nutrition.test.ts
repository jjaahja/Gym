import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";
import { addProtein, importNutritionDays, proteinStatus, proteinTarget, saveNutrition } from "./nutrition";

const newDb = () => new GymDB(`nutrition-${Math.random()}`, { indexedDB: new IDBFactory(), IDBKeyRange });
const USER = "u1";

describe("Eiweiß", () => {
  it("Ziel 1,6–2,2 g je kg, auf 5 g gerundet", () => {
    expect(proteinTarget(80, 1.6)).toBe(130);
    expect(proteinTarget(80, 2.2)).toBe(175);
  });

  it("Schnelleintrag addiert und synchronisiert", async () => {
    const db = newDb();
    const entries: NewOutboxEntry[] = [];
    const opts = { userId: USER, sink: (e: NewOutboxEntry) => entries.push(e) };
    await addProtein(db, "2026-11-12", 30, opts);
    await addProtein(db, "2026-11-12", 25, opts);
    expect((await db.nutrition.get("2026-11-12"))?.proteinG).toBe(55);
    expect(entries.at(-1)!.payload).toMatchObject({ user_id: USER, day: "2026-11-12", protein_g: 55, source: "manual" });
    await addProtein(db, "2026-11-12", -100, opts);
    expect(await db.nutrition.get("2026-11-12")).toBeUndefined();
    expect(entries.at(-1)).toMatchObject({ op: "delete" });
  });

  it("Wochenschnitt und Tage im Ziel", () => {
    const d = (day: string, proteinG: number | null) => ({ day, proteinG, energyKcal: null, source: "manual" as const, updatedAt: "" });
    const s = proteinStatus([d("2026-11-05", 200), d("2026-11-06", 100), d("2026-11-10", 140), d("2026-11-12", 120)], "2026-11-12", 80);
    expect(s).toEqual({ today: 120, target: { min: 130, max: 175 }, weekAverage: 120, daysOnTarget: 1, daysLogged: 3 });
    expect(proteinStatus([], "2026-11-12", null).target).toBeNull();
  });

  it("übernimmt Health-Connect-Tage, lässt eigene Einträge stehen, schreibt Unverändertes nicht erneut", async () => {
    const db = newDb();
    const entries: NewOutboxEntry[] = [];
    const opts = { userId: USER, sink: (e: NewOutboxEntry) => entries.push(e) };
    await saveNutrition(db, "2026-11-11", { proteinG: 150 }, opts);
    entries.length = 0;
    const incoming = [
      { day: "2026-11-11", proteinG: 90, energyKcal: 2100 },
      { day: "2026-11-12", proteinG: 64.26, energyKcal: 1200.4 },
      { day: "2026-11-10", proteinG: null, energyKcal: null },
    ];
    expect(await importNutritionDays(db, incoming, opts)).toBe(1);
    expect((await db.nutrition.get("2026-11-11"))?.proteinG).toBe(150);
    expect(await db.nutrition.get("2026-11-12")).toMatchObject({ proteinG: 64.3, energyKcal: 1200, source: "health_connect" });
    expect(await importNutritionDays(db, incoming, opts)).toBe(0);
    expect(entries).toHaveLength(1);
  });
});
