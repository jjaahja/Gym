import { buildIcs, scheduleFromFeed, type CalendarFeedRow } from "@/lib/calendar-export";

// Kalender-Abo: Kalender-Apps rufen diesen Link regelmäßig ab (ohne Anmeldung). Der geheime Token im Pfad
// entscheidet; die Datenbankfunktion calendar_feed gibt nur für einen gültigen Token den Plan heraus.

const TOKEN = /^[A-Za-z0-9_-]{43,64}$/;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/i, "");
  if (!TOKEN.test(token)) return text("Kalender nicht gefunden", 404);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return text("Kalender-Abo ist ohne Supabase nicht verfügbar", 503);

  const res = await fetch(`${url}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
    cache: "no-store",
  });
  if (!res.ok) return text("Kalender gerade nicht erreichbar", 502);
  const feed = (await res.json()) as CalendarFeedRow | null;
  if (!feed) return text("Kalender nicht gefunden", 404);

  const now = new Date();
  const schedule = scheduleFromFeed(feed);
  const ics = schedule
    ? buildIcs(schedule, {
        time: feed.event_time,
        reminderMinutes: feed.reminder_minutes,
        now,
        // stabile Termine: erste Wiederholung ab Planbeginn
        from: feed.plan?.started_at ? new Date(feed.plan.started_at) : now,
        appUrl: new URL(request.url).origin,
      })
    : "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gym//Trainingsplan//DE\r\nX-WR-CALNAME:Training\r\nEND:VCALENDAR\r\n";

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="training.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
