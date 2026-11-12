"use client";

import { useEffect, useState } from "react";
import { HeartPulseIcon } from "@/components/icons";
import { buttonStyles, Card } from "@/components/ui";
import { availability, HEALTH_CONNECT_STORE_URL, isAndroidApp, openSettings, type Availability } from "@/lib/health/health-connect";
import { EXTRA_LABELS, EXTRA_TYPES, useHealthExtras } from "@/lib/health/extras";
import { useHealthSync } from "@/lib/health/use-health-sync";

// Nur in der Android-App: Gewicht und Körperfett aus Health Connect (z. B. Withings-Waage) übernehmen.

function since(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const date = new Date(iso);
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (new Date(now).toDateString() === date.toDateString()) return `heute, ${time}`;
  return `${date.toLocaleDateString("de-DE", { day: "numeric", month: "short" })}, ${time}`;
}

const days = (n: number) => (n === 1 ? "1 Tag" : `${n} Tage`);

export function HealthConnectCard() {
  // Server und Browser rendern beide nichts ("checking"/"web") – kein Hydration-Unterschied
  const [status, setStatus] = useState<Availability | "checking" | "web">(() => (isAndroidApp() ? "checking" : "web"));
  const { connected, lastSync, syncing, error, lastResult, denied } = useHealthSync();
  const available = status !== "web" && status !== "checking" && status.available;

  useEffect(() => {
    if (!isAndroidApp()) return;
    useHealthSync.getState().load();
    availability()
      .then(setStatus)
      .catch(() => setStatus({ available: false, reason: "Health Connect ist nicht erreichbar.", installable: false }));
  }, []);

  if (status === "web" || status === "checking") return null;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-accent">
          <HeartPulseIcon width={22} height={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Health Connect</h2>
          <p className="text-sm text-muted">
            {connected
              ? lastSync
                ? `Verbunden · abgeglichen ${since(lastSync)}`
                : "Verbunden"
              : "Gewicht und Körperfett deiner Waage (z. B. Withings) automatisch übernehmen."}
          </p>
        </div>
      </div>

      {!status.available ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm">{status.reason}</p>
          {status.installable && (
            <a href={HEALTH_CONNECT_STORE_URL} className={`${buttonStyles.secondary} w-full`}>
              Health Connect installieren
            </a>
          )}
        </div>
      ) : connected ? (
        <div className="mt-3 space-y-3">
          {lastResult && (
            <p className="text-sm text-muted" role="status">
              {lastResult.days === 0
                ? "Keine neuen Messungen gefunden."
                : lastResult.updated === 0
                  ? `${days(lastResult.days)} geprüft – alles aktuell.`
                  : `${days(lastResult.updated)} übernommen.`}
            </p>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={syncing}
              onClick={() => void useHealthSync.getState().sync()}
            >
              {syncing ? "Gleiche ab …" : "Jetzt abgleichen"}
            </button>
            <button type="button" className={buttonStyles.secondary} onClick={() => void openSettings()}>
              Berechtigungen
            </button>
          </div>
          <button
            type="button"
            className="min-h-10 w-full text-sm font-medium text-muted underline-offset-4 hover:underline"
            onClick={() => useHealthSync.getState().disconnect()}
          >
            Abgleich beenden
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <ul className="space-y-1 text-sm text-muted">
            <li>• Liest nur Gewicht und Körperfett – sonst nichts.</li>
            <li>• Pro Tag zählt die letzte Messung; Taille, Arm & Co. bleiben wie eingetragen.</li>
            <li>• Gleicht beim Öffnen der App automatisch ab (die letzten 90 Tage beim ersten Mal).</li>
          </ul>
          {denied && (
            <p className="text-sm text-danger" role="alert">
              Keine Berechtigung erteilt. Du kannst sie jederzeit in Health Connect erlauben.
            </p>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className={`${buttonStyles.primary} w-full`}
            disabled={syncing}
            onClick={() => void useHealthSync.getState().connect()}
          >
            {syncing ? "Gleiche ab …" : "Mit Health Connect verbinden"}
          </button>
          {denied && (
            <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => void openSettings()}>
              Health Connect öffnen
            </button>
          )}
        </div>
      )}
      {available && <WorkoutExport />}
      {available && <HealthExtras />}
    </Card>
  );
}

/** Trainings in Health Connect speichern (Einheit + Sätze + geschätzte Kalorien). */
function WorkoutExport() {
  const { writeSupported, writeEnabled, writtenCount, exporting, lastExport, writeError, caloriesDenied } = useHealthSync();
  if (writeSupported === null) return null;
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <div>
        <h3 className="font-semibold">Trainings speichern</h3>
        <p className="text-sm text-muted">
          {writeEnabled
            ? `Aktiv · ${writtenCount === 1 ? "1 Training" : `${writtenCount} Trainings`} übertragen`
            : "Jedes Training als Krafttraining in Health Connect – sichtbar z. B. in Google Fit oder Samsung Health."}
        </p>
      </div>

      {!writeSupported ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm">
          Dafür brauchst du die neue App-Version (1.1). Installiere sie einfach über die bisherige – deine Daten bleiben.
        </p>
      ) : writeEnabled ? (
        <>
          {exporting && <p className="text-sm text-muted">Übertrage …</p>}
          {lastExport && lastExport.written > 0 && (
            <p className="text-sm text-muted" role="status">
              {lastExport.written === 1 ? "1 Training" : `${lastExport.written} Trainings`} übertragen
              {lastExport.withoutCalories > 0 && " – ohne Kalorien: trag dein Körpergewicht ein, dann werden sie geschätzt"}.
            </p>
          )}
          {caloriesDenied && <p className="text-sm text-muted">Kalorien sind in Health Connect nicht erlaubt – es werden nur die Trainings gespeichert.</p>}
          {writeError && (
            <p className="text-sm text-danger" role="alert">
              {writeError}
            </p>
          )}
          <button
            type="button"
            className="min-h-10 w-full text-sm font-medium text-muted underline-offset-4 hover:underline"
            onClick={() => useHealthSync.getState().disableWrite()}
          >
            Speichern beenden
          </button>
        </>
      ) : (
        <>
          <ul className="space-y-1 text-sm text-muted">
            <li>• Je Training: Start, Ende, Name und jeder Satz mit Übung und Wiederholungen (Gewichte kennt Health Connect nicht).</li>
            <li>• Kalorien geschätzt aus Dauer, Körpergewicht und Intensität – grob, oft ±30–50 %.</li>
            <li>• Die Trainings der letzten 30 Tage werden nachgetragen, danach jedes neue automatisch.</li>
          </ul>
          {writeError && (
            <p className="text-sm text-danger" role="alert">
              {writeError}
            </p>
          )}
          <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => void useHealthSync.getState().enableWrite()}>
            Trainings in Health Connect speichern
          </button>
        </>
      )}
    </div>
  );
}

/** Ernährung, Schlaf, Ruhepuls lesen (ab App 1.3) – für Eiweiß-Ziel und Erholungshinweis im Plan. */
function HealthExtras() {
  const { supported, status, reading, error, lastRead } = useHealthExtras();
  useEffect(() => {
    void useHealthExtras.getState().load();
  }, []);
  if (supported === null) return null;
  const granted = status ? EXTRA_TYPES.filter((t) => status[t]) : [];
  return (
    <section aria-labelledby="hc-extras" className="mt-4 space-y-3 border-t border-border pt-4">
      <div>
        <h3 id="hc-extras" className="font-semibold">Ernährung, Schlaf & Ruhepuls</h3>
        <p className="text-sm text-muted">Eiweiß aus deiner Ernährungs-App, Erholungshinweis aus Schlaf und Ruhepuls deiner Uhr.</p>
      </div>
      {!supported ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm">Dafür brauchst du die App-Version 1.3 – das Update findest du unter Profil.</p>
      ) : (
        <>
          {granted.length > 0 && (
            <ul className="space-y-1 text-sm">
              {EXTRA_TYPES.map((t) => (
                <li key={t} className="flex items-center justify-between">
                  <span>{EXTRA_LABELS[t]}</span>
                  <span className={status?.[t] ? "text-good" : "text-muted"}>{status?.[t] ? "erlaubt" : "nicht erlaubt"}</span>
                </li>
              ))}
            </ul>
          )}
          {granted.length === 0 && (
            <ul className="space-y-1 text-sm text-muted">
              <li>• Liest nur Tageswerte: Eiweiß und Kalorien, Schlafdauer, Ruhepuls.</li>
              <li>• Schlaf und Ruhepuls bleiben auf diesem Gerät; Eiweiß wird wie selbst eingetragen gespeichert.</li>
              <li>• Selbst eingetragenes Eiweiß hat immer Vorrang.</li>
            </ul>
          )}
          {lastRead && granted.length > 0 && <p className="text-xs text-muted">Zuletzt gelesen: {since(lastRead)}</p>}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {granted.length < EXTRA_TYPES.length ? (
            <button type="button" className={`${buttonStyles.secondary} w-full`} onClick={() => void useHealthExtras.getState().enable()}>
              {granted.length === 0 ? "Lesen erlauben" : "Weitere erlauben"}
            </button>
          ) : (
            <button type="button" className={`${buttonStyles.secondary} w-full`} disabled={reading} onClick={() => void useHealthExtras.getState().refresh(true)}>
              {reading ? "Lese …" : "Jetzt lesen"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
