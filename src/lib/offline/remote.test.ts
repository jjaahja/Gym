import { describe, expect, it } from "vitest";
import { byId, deviceHistory, USER } from "@/test/device-history";
import { pgTimestamp } from "./fake-server";
import { adaptationFromRemote, measurementFromRemote, planFromRemote, sessionFromRemote } from "./remote";


describe("Server → Gerät (Round Trip)", () => {
  it("formatiert Zeitstempel wie Postgres", () => {
    expect(pgTimestamp("2026-11-03T16:00:00.000Z")).toBe("2026-11-03T16:00:00+00:00");
    expect(pgTimestamp("2026-12-08T07:00:00.120Z")).toBe("2026-12-08T07:00:00.12+00:00");
  });

  it("stellt den Plan exakt wieder her – inkl. Wechsel, Volumen, Deload, Trainingstag und Ausstattung", async () => {
    const { server, plans } = await deviceHistory();
    const remote = server.state(USER);
    const local = plans.getState().plan!;
    const restored = planFromRemote(remote.plan!, remote.assessment!, remote.equipmentIds);
    expect(restored).toEqual(local);
    // Stichproben, damit der Test nicht trivial besteht
    expect(restored.deloadWeekStart).toBe("2026-12-08T07:00:00.123Z");
    expect(restored.nextDayIndex).toBe(3);
    expect(restored.completedMesocycles).toBe(1);
    expect(restored.days.flatMap((d) => d.exercises).some((e) => e.exerciseSlug === "barbell-bench-press")).toBe(false);
  });

  it("stellt das Anpassungsprotokoll wieder her (auto, angenommen, abgelehnt, offen)", async () => {
    const { server, plans } = await deviceHistory();
    const restored = server.state(USER).adaptations.map(adaptationFromRemote);
    expect(restored.every((a) => a !== null)).toBe(true);
    expect(byId(restored as never[])).toEqual(byId(plans.getState().adaptations));
    expect(new Set(restored.map((a) => a!.status))).toEqual(new Set(["auto_applied", "accepted", "rejected", "suggested"]));
  });

  it("stellt Trainings und Körpermaße so wieder her, wie das Gerät sie gespeichert hat", async () => {
    const { server, db } = await deviceHistory();
    const remote = server.state(USER);
    const sessions = remote.sessions.map(sessionFromRemote);
    expect(byId(sessions as never[])).toEqual(byId(await db.sessions.toArray()));
    expect(sessions.every((s) => s!.exercises.every((e) => e.sets.some((x) => x.setType === "warmup")))).toBe(true);
    expect(byId(remote.measurements.map(measurementFromRemote))).toEqual(byId(await db.measurements.toArray()));
  });

  it("ignoriert laufende/verworfene Trainings und Übungen ohne erledigte Sätze", () => {
    const base = {
      id: "s1", plan_id: null, plan_day_id: null, started_at: "2026-11-03T16:00:00+00:00",
      ended_at: "2026-11-03T17:00:00+00:00", session_rpe: null, is_deload: false,
    };
    expect(sessionFromRemote({ ...base, status: "abandoned", exercise_logs: [] })).toBeNull();
    const session = sessionFromRemote({
      ...base,
      status: "completed",
      exercise_logs: [
        { id: "l1", exercise_id: "x", plan_exercise_id: null, order_index: 0, pump_rating: null, joint_discomfort: null, set_logs: [] },
      ],
    });
    expect(session).toMatchObject({ exercises: [], exerciseIds: [], endedAt: "2026-11-03T17:00:00.000Z" });
    expect(session).not.toHaveProperty("deload");
  });
});
