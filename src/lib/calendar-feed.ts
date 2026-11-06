import type { SupabaseClient } from "@supabase/supabase-js";

// Kalender-Abo verwalten (nur mit Konto): geheimen Token erzeugen, Uhrzeit/Erinnerung speichern, Link erneuern.
// Gespeichert in public.calendar_feeds (Row Level Security: nur der eigene Eintrag).

export interface FeedSettings {
  token: string;
  /** HH:MM */
  eventTime: string;
  reminderMinutes: number;
}

/** 256 Bit Zufall, Base64url (43 Zeichen) – nicht erratbar. */
export function newToken(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function feedUrls(origin: string, token: string) {
  const https = `${origin}/api/calendar/${token}.ics`;
  const webcal = https.replace(/^https?:\/\//, "webcal://");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

interface Row {
  token: string;
  event_time: string;
  reminder_minutes: number;
}

const fromRow = (r: Row): FeedSettings => ({ token: r.token, eventTime: r.event_time.slice(0, 5), reminderMinutes: r.reminder_minutes });

export async function loadFeed(client: SupabaseClient, userId: string): Promise<FeedSettings | null> {
  const { data, error } = await client
    .from("calendar_feeds")
    .select("token, event_time, reminder_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as Row) : null;
}

/** Abo anlegen oder Einstellungen ändern; `rotate` erzeugt einen neuen Link (der alte funktioniert dann nicht mehr). */
export async function saveFeed(
  client: SupabaseClient,
  userId: string,
  settings: { eventTime: string; reminderMinutes: number },
  options: { current: FeedSettings | null; rotate?: boolean },
): Promise<FeedSettings> {
  const token = options.current && !options.rotate ? options.current.token : newToken();
  const { data, error } = await client
    .from("calendar_feeds")
    .upsert({ user_id: userId, token, event_time: settings.eventTime, reminder_minutes: settings.reminderMinutes })
    .select("token, event_time, reminder_minutes")
    .single();
  if (error) throw new Error(error.message);
  return fromRow(data as Row);
}

export async function deleteFeed(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from("calendar_feeds").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
