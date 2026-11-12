"use client";

import { useEffect, useState } from "react";
import { useOnline } from "@/components/status-banners";
import { buttonStyles, Card } from "@/components/ui";
import { buildReport, readErrorLog, sendReport } from "@/lib/error-log";
import { getDb, type OutboxEntry } from "@/lib/offline/db";
import { syncDevice } from "@/lib/offline/device-sync";
import { useSyncStatus } from "@/lib/offline/sync";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ageLabel, syncProblem } from "@/lib/sync-health";

/** Status der Synchronisierung; hängt sie, mit Ursache, Fehlerbericht und – als letzter Ausweg – Verwerfen. */
export function SyncCard() {
  const { pending, syncing, lastError, lastSyncedAt, pulling, lastPulledAt, pullError } = useSyncStatus();
  const supabase = getSupabaseBrowserClient();
  const online = useOnline();
  const entries = useLiveQuery<OutboxEntry[]>(() => getDb().outbox.orderBy("seq").limit(200).toArray(), [], []);
  const now = useEntryClock(entries.length > 0);
  const problem = now == null ? null : syncProblem(entries, now, online);
  const [report, setReport] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [note, setNote] = useState("");

  async function send() {
    if (!supabase) return;
    setReport("sending");
    try {
      const appVersion = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ? "android" : "web";
      await sendReport(
        supabase,
        buildReport({ errors: readErrorLog(), sync: problem, appVersion, userAgent: navigator.userAgent, path: location.pathname, note }),
      );
      setReport("sent");
      setNote("");
    } catch {
      setReport("failed");
    }
  }

  async function discard() {
    const first = entries[0];
    if (!first?.seq) return;
    if (
      !window.confirm(
        `„${problem?.blocking?.label}“ wird nicht mehr übertragen und fehlt danach auf deinen anderen Geräten. Alles dahinter wird wieder synchronisiert. Verwerfen?`,
      )
    )
      return;
    await getDb().outbox.delete(first.seq);
    void syncDevice({ force: true });
  }

  return (
    <Card>
      <h2 id="sync" className="font-semibold">
        Synchronisierung
      </h2>
      {supabase ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {pending === null
              ? "Prüfe ausstehende Änderungen …"
              : pending === 0
                ? "Alles synchronisiert."
                : syncing
                  ? `${pending} Änderungen werden übertragen …`
                  : online
                    ? `${pending} Änderungen warten.`
                    : `${pending} Änderungen warten auf Netz.`}
            {lastSyncedAt && ` Zuletzt: ${new Date(lastSyncedAt).toLocaleTimeString("de-DE")}.`}
          </p>
          <p className="mt-1 text-sm text-muted">
            {lastPulledAt
              ? `Stand vom Server geladen: ${new Date(lastPulledAt).toLocaleTimeString("de-DE")}. Plan, Trainings und Körpermaße sind auf allen Geräten gleich.`
              : "Plan, Trainings und Körpermaße werden beim Start vom Server geladen."}
          </p>

          {problem && (
            <div className="mt-3 space-y-1 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="alert">
              <p className="font-semibold">
                Synchronisierung hängt {ageLabel(problem.oldestAgeMs)} · {problem.pending} {problem.pending === 1 ? "Änderung" : "Änderungen"} warten
              </p>
              {problem.blocking && (
                <p>
                  Hängt bei: {problem.blocking.label} ({problem.blocking.op === "delete" ? "löschen" : "speichern"}, {problem.blocking.attempts}{" "}
                  {problem.blocking.attempts === 1 ? "Versuch" : "Versuche"})
                </p>
              )}
              {problem.blocking?.error && <p className="break-words font-mono text-xs">{problem.blocking.error}</p>}
            </div>
          )}
          {!problem && lastError && <p className="mt-2 text-sm text-danger">Letzter Fehler beim Hochladen: {lastError}</p>}
          {pullError && <p className="mt-2 text-sm text-danger">Letzter Fehler beim Laden: {pullError}</p>}

          <button
            type="button"
            className={`${buttonStyles.secondary} mt-3 w-full`}
            disabled={syncing || pulling}
            onClick={() => void syncDevice({ force: true })}
          >
            {syncing || pulling ? "Synchronisiere …" : problem ? "Erneut versuchen" : "Jetzt synchronisieren"}
          </button>

          {problem && (
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Fehlerbericht an den Betreiber (optional mit Beschreibung)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 500))}
                  rows={2}
                  className="field min-h-16 py-2"
                  placeholder="Was hast du zuletzt gemacht?"
                />
              </label>
              <button type="button" className={`${buttonStyles.secondary} w-full`} disabled={report === "sending" || !online} onClick={() => void send()}>
                {report === "sending" ? "Sende …" : "Fehlerbericht senden"}
              </button>
              {report === "sent" && <p className="text-sm text-good" role="status">Danke – der Bericht ist angekommen.</p>}
              {report === "failed" && <p className="text-sm text-danger" role="alert">Senden fehlgeschlagen. Später erneut versuchen.</p>}
              <p className="text-xs text-muted">Enthält die letzten Fehlermeldungen der App und diesen Sync-Status – keine Trainingsdaten.</p>
              {problem.permanent && (
                <button type="button" className="min-h-10 w-full text-sm font-medium text-danger" onClick={() => void discard()}>
                  Hängende Änderung verwerfen
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">Demo-Modus: Ohne Supabase-Projekt bleiben alle Daten auf diesem Gerät.</p>
      )}
    </Card>
  );
}

/** Uhrzeit (ms) erst im Browser und nur, wenn es wartende Einträge gibt – minütlich aktualisiert. */
function useEntryClock(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active]);
  return active ? now : null;
}
