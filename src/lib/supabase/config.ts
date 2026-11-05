// NEXT_PUBLIC_* wird beim Build eingesetzt. Fehlen die Werte, läuft die App im
// Demo-Modus: keine Anmeldung, Training nur lokal, keine Synchronisierung.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isSupabaseConfigured = SUPABASE_URL !== "" && SUPABASE_PUBLISHABLE_KEY !== "";
