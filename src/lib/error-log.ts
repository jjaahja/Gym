import type { SupabaseClient } from "@supabase/supabase-js";

// Fehlerprotokoll: Fehler im Browser werden lokal mitgeschrieben (höchstens 30). Gesendet wird nur, wenn du im Profil
// „Fehlerbericht senden“ tippst – dann landen sie in „client_errors“ (nur schreibbar, lesen kann nur der Betreiber).

const KEY = "gym-error-log";
const MAX = 30;

export interface LoggedError {
  at: string;
  source: "error" | "promise" | "sync" | "app";
  message: string;
}

export function readErrorLog(): LoggedError[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function logError(source: LoggedError["source"], message: string, now = new Date()): void {
  const text = message.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return;
  const log = readErrorLog();
  // gleiche Meldung direkt hintereinander nur einmal
  if (log.at(-1)?.message === text) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...log, { at: now.toISOString(), source, message: text }].slice(-MAX)));
  } catch {
    // Speicher voll oder gesperrt – Protokoll ist optional
  }
}

export function clearErrorLog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // egal
  }
}

/** Globale Fehler mitschreiben. Liefert die Abmeldung. */
export function installErrorCapture(): () => void {
  const onError = (e: ErrorEvent) => logError("error", `${e.message}${e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : ""}`);
  const onRejection = (e: PromiseRejectionEvent) =>
    logError("promise", e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Bericht mit den letzten Fehlern und dem Sync-Zustand – keine Trainingsdaten. Höchstens 8 KB (Datenbankgrenze). */
export function buildReport(input: { errors: readonly LoggedError[]; sync: unknown; appVersion: string; userAgent: string; path: string; note?: string }) {
  let errors = input.errors.slice(-15);
  const make = () => ({
    message: (input.note?.trim() || errors.at(-1)?.message || "Fehlerbericht ohne Fehlermeldung").slice(0, 2000),
    app_version: input.appVersion.slice(0, 40),
    context: { errors, sync: input.sync, userAgent: input.userAgent.slice(0, 300), path: input.path.slice(0, 200) },
  });
  let report = make();
  while (errors.length > 0 && new TextEncoder().encode(JSON.stringify(report.context)).length > 7000) {
    errors = errors.slice(1);
    report = make();
  }
  return report;
}

export async function sendReport(client: SupabaseClient, report: ReturnType<typeof buildReport>): Promise<void> {
  // ohne Rückgabe: Die Tabelle ist für Nutzer nicht lesbar
  const { error } = await client.from("client_errors").insert(report);
  if (error) throw new Error(error.message);
}
