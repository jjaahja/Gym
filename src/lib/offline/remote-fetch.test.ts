import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fetchRemoteState } from "./remote";

// Minimaler Nachbau des Supabase-Query-Builders: protokolliert Aufrufe und liefert Daten je Tabelle.
type Call = { table: string; select?: string; filters: string[]; range?: [number, number]; single: boolean };

function fakeClient(data: Record<string, unknown[]>, failOn?: string) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [], single: false };
      calls.push(call);
      const result = () => {
        if (failOn === table) return { data: null, error: { message: `${table} kaputt` } };
        let rows = data[table] ?? [];
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        return { data: call.single ? (rows[0] ?? null) : rows, error: null };
      };
      const builder = {
        select: (s: string) => ((call.select = s), builder),
        eq: (col: string, v: unknown) => (call.filters.push(`${col}=${String(v)}`), builder),
        order: (col: string, opts?: { ascending?: boolean }) => (call.filters.push(`order:${col}:${opts?.ascending ?? true}`), builder),
        range: (from: number, to: number) => ((call.range = [from, to]), builder),
        maybeSingle: () => ((call.single = true), builder),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("fetchRemoteState", () => {
  it("lädt aktiven Plan mit Tagen/Übungen, abgeschlossene Trainings seitenweise und das Protokoll des Plans", async () => {
    const sessions = Array.from({ length: 1201 }, (_, i) => ({ id: `s${i}`, exercise_logs: [] }));
    const { client, calls } = fakeClient({
      profiles: [{ unit_system: "imperial", effort_scale: "rpe" }],
      training_plans: [{ id: "p1", assessment_id: "a1", plan_days: [] }],
      user_assessments: [{ id: "a1" }],
      user_equipment: [{ equipment_id: "e1" }, { equipment_id: "e2" }],
      plan_adaptations: [{ id: "x1" }],
      workout_sessions: sessions,
      body_measurements: [{ id: "m1" }],
    });
    const state = await fetchRemoteState(client, "u1");

    expect(state.sessions).toHaveLength(1201);
    expect(state.equipmentIds).toEqual(["e1", "e2"]);
    expect(state.profile).toEqual({ unit_system: "imperial", effort_scale: "rpe" });
    expect(state.assessment).toEqual({ id: "a1" });
    expect(state.adaptations).toEqual([{ id: "x1" }]);

    const sessionCalls = calls.filter((c) => c.table === "workout_sessions");
    expect(sessionCalls.map((c) => c.range)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
    expect(sessionCalls[0].filters).toContain("status=completed");
    expect(sessionCalls[0].select).toContain("exercise_logs(*, set_logs(*))");
    const planCall = calls.find((c) => c.table === "training_plans")!;
    expect(planCall).toMatchObject({ select: "*, plan_days(*, plan_exercises(*))", single: true });
    expect(planCall.filters).toContain("status=active");
    expect(calls.find((c) => c.table === "plan_adaptations")!.filters).toContain("plan_id=p1");
    expect(calls.find((c) => c.table === "profiles")!.filters).toContain("id=u1");
  });

  it("fragt ohne aktiven Plan kein Assessment/Protokoll ab", async () => {
    const { client, calls } = fakeClient({ training_plans: [] });
    const state = await fetchRemoteState(client, "u1");
    expect(state).toMatchObject({ plan: null, assessment: null, adaptations: [], sessions: [], measurements: [] });
    expect(calls.some((c) => c.table === "user_assessments" || c.table === "plan_adaptations")).toBe(false);
  });

  it("bricht bei einem Fehler ab, statt einen unvollständigen Stand zu liefern", async () => {
    const { client } = fakeClient({ training_plans: [] }, "body_measurements");
    await expect(fetchRemoteState(client, "u1")).rejects.toThrow("body_measurements kaputt");
  });
});
