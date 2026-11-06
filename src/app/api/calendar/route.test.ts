import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExercise } from "@/lib/catalog";
import { GET } from "./[token]/route";

const TOKEN = "a".repeat(43);
const call = (token: string) => GET(new Request(`https://gym.example/api/calendar/${token}`), { params: Promise.resolve({ token }) });

describe("Kalender-Abo-Route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projekt.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lehnt ungültige Tokens ab, ohne die Datenbank zu fragen", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("zu-kurz")).status).toBe(404);
    expect((await call("../../etc/passwd" + "a".repeat(40))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fragt calendar_feed mit dem Token (ohne .ics) und liefert eine Kalenderdatei", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        event_time: "07:30",
        reminder_minutes: 15,
        plan: {
          id: "plan-1", name: "Ganzkörper · Muskelaufbau & Optik", started_at: "2026-11-02T08:00:00+00:00",
          cycle_started_at: "2026-11-02T08:00:00+00:00", mesocycle_weeks: 5, deload_week_start: null,
          days: [{ id: "day-a", name: "Ganzkörper A", weekday: 1, exercises: [
            { exercise_id: getExercise("barbell-back-squat")!.id, sets: 3, reps_min: 6, reps_max: 12, rest_seconds: 120, last_set_technique: null },
          ] }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call(`${TOKEN}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(body).toContain("DTSTART:20261102T073000"); // erste Wiederholung ab Planbeginn
    expect(body).toContain("TRIGGER:-PT15M");
    expect(body).toContain("URL:https://gym.example/dashboard");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://projekt.supabase.co/rest/v1/rpc/calendar_feed");
    expect(JSON.parse(String(init.body))).toEqual({ p_token: TOKEN });
    expect((init.headers as Record<string, string>).apikey).toBe("sb_publishable_test");
  });

  it("unbekannter Token → 404; kein Plan → leerer, gültiger Kalender; Datenbankfehler → 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(null)));
    expect((await call(TOKEN)).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ event_time: "18:00", reminder_minutes: 0, plan: null })));
    const empty = await call(TOKEN);
    expect(empty.status).toBe(200);
    expect(await empty.text()).toMatch(/^BEGIN:VCALENDAR[\s\S]*END:VCALENDAR\r\n$/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("kaputt", { status: 500 })));
    expect((await call(TOKEN)).status).toBe(502);
  });
});
