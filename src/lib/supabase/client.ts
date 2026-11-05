import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

/** Browser-Client (Session in Cookies, damit der Proxy sie lesen kann). null im Demo-Modus. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

/** User-ID aus der lokal gespeicherten Session – funktioniert auch offline. */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
