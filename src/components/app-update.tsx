"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { apkUrl, LEGACY_DOWNLOAD_URL } from "@/lib/app-update";
import { isAndroidApp } from "@/lib/health/health-connect";
import { useAppUpdate } from "@/lib/use-app-update";
import { buttonStyles, Card } from "./ui";

// Updates der Android-App: Prüfung beim Start, Hinweis oben, Karte im Profil.

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;

/** Prüft beim Start und bei Rückkehr in die App (höchstens alle 6 h, nach den Einstellungen sofort). */
export function AppUpdateCheck() {
  useEffect(() => {
    if (!isAndroidApp()) return;
    void useAppUpdate.getState().check();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void useAppUpdate.getState().check(useAppUpdate.getState().phase === "waiting-permission");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}

/** Hinweis oben in der App, wenn eine neue Version bereitsteht. */
export function UpdateBanner() {
  const { installed, latest, phase } = useAppUpdate();
  const available = useAppUpdate((s) => s.available());
  if (!available || !latest || installed?.kind === "browser" || phase === "installing") return null;
  return (
    <Link href="/settings#app-update" className="flex items-center justify-between gap-3 bg-accent-soft px-4 py-2 text-sm">
      <span>
        <strong>Neue App-Version {latest.versionName}</strong> verfügbar
      </span>
      <span className="font-semibold text-accent">Aktualisieren ›</span>
    </Link>
  );
}

const subscribeUa = () => () => {};
function useIsAndroidBrowser(): boolean {
  return useSyncExternalStore(
    subscribeUa,
    () => /Android/i.test(navigator.userAgent),
    () => false,
  );
}

export function AppUpdateCard() {
  const { installed, latest, checking, phase, progress, error } = useAppUpdate();
  const available = useAppUpdate((s) => s.available());
  const androidBrowser = useIsAndroidBrowser();

  useEffect(() => {
    void useAppUpdate.getState().check(true);
  }, []);

  if (!installed || !latest) return null;
  if (installed.kind === "browser" && !androidBrowser) return null;

  return (
    <Card>
      <div id="app-update" className="scroll-mt-20">
        <h2 className="font-semibold">{installed.kind === "browser" ? "Android-App" : "App-Version"}</h2>

        {installed.kind === "browser" && (
          <>
            <p className="mt-1 text-sm text-muted">
              Mit der App für Android (Version {latest.versionName}, {mb(latest.size)}) kannst du Gewicht und Körperfett aus Health
              Connect übernehmen und deine Trainings dort speichern. Updates installierst du danach direkt in der App.
            </p>
            <a href={apkUrl(latest, typeof window === "undefined" ? "https://localhost" : window.location.origin)} download className={`${buttonStyles.secondary} mt-3 w-full`}>
              App herunterladen
            </a>
          </>
        )}

        {installed.kind === "legacy" && (
          <>
            <p className="mt-1 text-sm text-muted">
              Deine App-Version kann sich noch nicht selbst aktualisieren. Lade einmalig Version {latest.versionName} – ab dann
              geht jedes Update direkt hier.
            </p>
            <Notes notes={latest.notes} />
            <a href={LEGACY_DOWNLOAD_URL(latest)} className={`${buttonStyles.primary} mt-3 w-full`}>
              Version {latest.versionName} im Browser laden
            </a>
            <p className="mt-2 text-xs text-muted">Danach die Datei öffnen und „Aktualisieren“ wählen. Deine Daten bleiben.</p>
          </>
        )}

        {installed.kind === "app" && (
          <>
            <p className="mt-1 text-sm text-muted">
              Installiert: {installed.versionName}
              {!available && " · aktuell"}
              {available && ` · neu: ${latest.versionName} (${mb(latest.size)})`}
            </p>

            {available && <Notes notes={latest.notes} />}

            {available && phase === "downloading" && progress && (
              <div className="mt-3" role="status">
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label="Download"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${progress.total > 0 ? Math.min(100, (progress.loaded / progress.total) * 100) : 5}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted">
                  Lade {mb(progress.loaded)} von {mb(progress.total || latest.size)} …
                </p>
              </div>
            )}

            {available && phase === "installing" && (
              <p className="mt-3 text-sm" role="status">
                Installation geöffnet – bestätige dort „Aktualisieren“. Die App startet danach neu.
              </p>
            )}

            {available && !installed.canInstall && phase !== "downloading" && (
              <div className="mt-3 space-y-2">
                <p className="text-sm">
                  Einmalig nötig: Erlaube der App, Updates zu installieren („Apps aus dieser Quelle installieren“). Danach geht es
                  hier automatisch weiter.
                </p>
                <button type="button" className={`${buttonStyles.primary} w-full`} onClick={() => void useAppUpdate.getState().allowInstall()}>
                  Installation erlauben
                </button>
              </div>
            )}

            {available && installed.canInstall && phase !== "downloading" && phase !== "installing" && (
              <button type="button" className={`${buttonStyles.primary} mt-3 w-full`} onClick={() => void useAppUpdate.getState().install()}>
                Jetzt aktualisieren
              </button>
            )}

            {error && phase === "error" && (
              <p className="mt-2 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            {!available && (
              <button
                type="button"
                className="mt-2 min-h-10 text-sm font-medium text-accent"
                disabled={checking}
                onClick={() => void useAppUpdate.getState().check(true)}
              >
                {checking ? "Suche …" : "Nach Updates suchen"}
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function Notes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {notes.map((n) => (
        <li key={n} className="flex gap-2">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
          {n}
        </li>
      ))}
    </ul>
  );
}
