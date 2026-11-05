"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/offline/db";
import { syncNow, useSyncStatus } from "@/lib/offline/sync";
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
      <ServiceWorkerRegistration />
      {children}
    </QueryClientProvider>
  );
}

/** Persistierte Stores erst nach dem ersten Render laden (vermeidet Hydration-Mismatch). */
function StoreHydration() {
  useEffect(() => {
    void workoutStore.persist.rehydrate();
    void useSettings.persist.rehydrate();
  }, []);
  return null;
}

/** Hält die Anzahl offener Änderungen aktuell und synchronisiert bei Netz, Fokus und alle 30 s. */
function SyncManager() {
  useEffect(() => {
    const subscription = liveQuery(() => getDb().outbox.count()).subscribe({
      next: (pending) => useSyncStatus.setState({ pending }),
      error: (err) => console.error("Outbox nicht lesbar", err),
    });

    const run = () => void syncNow();
    const onVisible = () => document.visibilityState === "visible" && run();

    run();
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(run, 30_000);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
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
