"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { AppUpdateCheck } from "@/components/app-update";
import { isAndroidApp } from "@/lib/health/health-connect";
import { useHealthExtras } from "@/lib/health/extras";
import { useHealthSync } from "@/lib/health/use-health-sync";
import { watchReminders } from "@/lib/reminders";
import { installErrorCapture } from "@/lib/error-log";
import { getDb } from "@/lib/offline/db";
import { syncDevice } from "@/lib/offline/device-sync";
import { useSyncStatus } from "@/lib/offline/sync";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { workoutStore } from "@/stores/workout";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // Im Gym oft offline: gecachte Daten zeigen statt Fehler
            networkMode: "offlineFirst",
            retry: 2,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StoreHydration />
      <SyncManager />
      <HealthConnectSync />
      <ReminderSync />
      <ErrorCapture />
      <AppUpdateCheck />
      <ServiceWorkerRegistration />
      {children}
    </QueryClientProvider>
  );
}

/** Persistierte Stores erst nach dem ersten Render laden (vermeidet Hydration-Mismatch). */
function StoreHydration() {
  useEffect(() => {
    void workoutStore.persist.rehydrate();
    void planStore.persist.rehydrate();
    void useSettings.persist.rehydrate();
  }, []);
  return null;
}

/** Hält die Anzahl offener Änderungen aktuell und gleicht ab: beim Start, bei Netz, Fokus, alle 30 s und nach der Anmeldung. */
function SyncManager() {
  useEffect(() => {
    const subscription = liveQuery(() => getDb().outbox.count()).subscribe({
      next: (pending) => useSyncStatus.setState({ pending }),
      error: (err) => console.error("Outbox nicht lesbar", err),
    });

    const run = () => void syncDevice();
    // Nach der Anmeldung sofort den Stand vom Server holen (neues Gerät)
    const auth = getSupabaseBrowserClient()?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(() => void syncDevice({ force: true }), 0);
    });
    const onVisible = () => document.visibilityState === "visible" && run();

    run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(run, 30_000);

    return () => {
      subscription.unsubscribe();
      auth?.data.subscription.unsubscribe();
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, []);
  return null;
}

/** Android-App: Gewicht/Körperfett aus Health Connect nach dem ersten Server-Abgleich und bei Rückkehr in die App. */
function HealthConnectSync() {
  useEffect(() => {
    if (!isAndroidApp()) return;
    const health = useHealthSync.getState();
    health.load();
    // Ernährung, Schlaf, Ruhepuls (ab App 1.3; höchstens alle 30 Minuten)
    void useHealthExtras.getState().load().then(() => useHealthExtras.getState().refresh());
    const run = () => {
      void useHealthSync.getState().autoSync();
      void useHealthExtras.getState().refresh();
    };
    const unsubscribe = useSyncStatus.subscribe((s, prev) => s.firstPull === "done" && prev.firstPull !== "done" && run());
    const onVisible = () => document.visibilityState === "visible" && run();
    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}

function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.error("Service Worker nicht registriert", err));
  }, []);
  return null;
}

/** Android-App: Trainingserinnerungen aktuell halten (Uhrzeit, Schalter, Wochentage des Plans). */
function ReminderSync() {
  useEffect(() => {
    if (!isAndroidApp()) return;
    return watchReminders();
  }, []);
  return null;
}

/** Fehler lokal mitschreiben (gesendet wird nur auf Knopfdruck im Profil). */
function ErrorCapture() {
  useEffect(() => installErrorCapture(), []);
  return null;
}
