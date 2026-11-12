"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles } from "@/components/ui";
import { deleteFeed, feedUrls, loadFeed, saveFeed, type FeedSettings } from "@/lib/calendar-feed";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";

const REMINDERS = [0, 15, 30, 60] as const;

/** Kalender-Abo: ein geheimer Link, den Apple/Google Kalender regelmäßig abrufen – Änderungen am Plan kommen von selbst. */
export function SubscriptionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [feed, setFeed] = useState<FeedSettings | null>(null);
  const [time, setTime] = useState("18:00");
  const [reminder, setReminder] = useState(30);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client = getSupabaseBrowserClient();
      const userId = await getCurrentUserId();
      if (!client || !userId) throw new Error("Nur mit Konto verfügbar");
      const current = await loadFeed(client, userId);
      if (cancelled) return;
      setFeed(current);
      if (current) {
        setTime(current.eventTime);
        setReminder(current.reminderMinutes);
      }
      setState("ready");
    })().catch((err) => {
      if (cancelled) return;
      setMessage(navigator.onLine ? String(err instanceof Error ? err.message : err) : "Für das Abo wird eine Internetverbindung gebraucht.");
      setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
    } catch (err) {
      setMessage(navigator.onLine ? `Fehler: ${err instanceof Error ? err.message : String(err)}` : "Keine Internetverbindung.");
    } finally {
      setBusy(false);
    }
  }

  const context = async () => {
    const client = getSupabaseBrowserClient();
    const userId = await getCurrentUserId();
    if (!client || !userId) throw new Error("Nicht angemeldet");
    return { client, userId };
  };

  const save = (rotate = false) =>
    run(async () => {
      const { client, userId } = await context();
      setFeed(await saveFeed(client, userId, { eventTime: time, reminderMinutes: reminder }, { current: feed, rotate }));
    }, rotate ? "Neuer Link erstellt – der alte funktioniert nicht mehr." : feed ? "Gespeichert – Kalender übernehmen das beim nächsten Abruf." : "Abo-Link erstellt.");

  const remove = () =>
    run(async () => {
      const { client, userId } = await context();
      await deleteFeed(client, userId);
      setFeed(null);
    }, "Abo beendet – der Link funktioniert nicht mehr. Entferne den Kalender auch in deiner Kalender-App.");

  const urls = feed ? feedUrls(window.location.origin, feed.token) : null;
  const changed = feed && (feed.eventTime !== time || feed.reminderMinutes !== reminder);

  return (
    <Sheet open={open} onClose={onClose} title="Kalender abonnieren">
      {state === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}
      {state === "error" && <p className="text-sm text-danger" role="alert">{message}</p>}
      {state === "ready" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Ein persönlicher Link für deine Kalender-App. Trainingstage, Deload-Woche und Auswertung erscheinen als Termine –
            und ändern sich automatisch mit deinem Plan.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Uhrzeit</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value || "18:00")}
                className="field block min-h-12"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Erinnerung</span>
              <select
                value={reminder}
                onChange={(e) => setReminder(Number(e.target.value))}
                className="field block min-h-12"
              >
                {REMINDERS.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "keine" : m === 60 ? "1 h vorher" : `${m} min vorher`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!feed ? (
            <button type="button" className={`${buttonStyles.primary} w-full`} disabled={busy} onClick={() => save()}>
              Abo-Link erstellen
            </button>
          ) : (
            <>
              {changed && (
                <button type="button" className={`${buttonStyles.secondary} w-full`} disabled={busy} onClick={() => save()}>
                  Uhrzeit und Erinnerung speichern
                </button>
              )}
              <div className="space-y-2">
                <a href={urls!.webcal} className={`${buttonStyles.primary} w-full`}>
                  In Apple Kalender abonnieren
                </a>
                <a href={urls!.google} target="_blank" rel="noreferrer" className={`${buttonStyles.secondary} w-full`}>
                  In Google Kalender abonnieren
                </a>
                <button
                  type="button"
                  className={`${buttonStyles.secondary} w-full`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(urls!.https);
                      setCopied(true);
                    } catch {
                      setMessage(urls!.https);
                    }
                  }}
                >
                  {copied ? "Link kopiert ✓" : "Link kopieren (Outlook u. a.)"}
                </button>
              </div>
              <p className="text-xs text-muted">
                Apple Kalender aktualisiert in dem Abstand, den du dort einstellst. Google Kalender ruft Abos selbst ab –
                Änderungen können dort einige Stunden dauern. Der Link ist geheim: Wer ihn kennt, sieht deinen Trainingsplan
                (sonst nichts).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-[0.75rem] bg-surface-2 text-sm font-medium text-accent"
                  disabled={busy}
                  onClick={() => window.confirm("Neuen Link erzeugen? Der bisherige funktioniert dann nicht mehr.") && save(true)}
                >
                  Neuen Link erzeugen
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-[0.75rem] bg-surface-2 text-sm font-medium text-danger"
                  disabled={busy}
                  onClick={() => window.confirm("Abo beenden? Der Link funktioniert dann nicht mehr.") && remove()}
                >
                  Abo beenden
                </button>
              </div>
            </>
          )}
          {message && (
            <p className="break-all text-sm text-muted" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
