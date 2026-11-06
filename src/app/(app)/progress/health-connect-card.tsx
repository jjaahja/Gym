"use client";

import { useEffect, useState } from "react";
import { HeartPulseIcon } from "@/components/icons";
import { buttonStyles, Card } from "@/components/ui";
import { availability, HEALTH_CONNECT_STORE_URL, isAndroidApp, openSettings, type Availability } from "@/lib/health/health-connect";
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
    </Card>
  );
}
