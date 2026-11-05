"use client";

import { useSyncExternalStore } from "react";
import { CloudOffIcon } from "./icons";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-warning-bg px-4 py-2 text-sm text-warning-fg">
      <CloudOffIcon className="size-4 shrink-0" />
      Offline – dein Training wird lokal gespeichert und später synchronisiert.
    </div>
  );
}
