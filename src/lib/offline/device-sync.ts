import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { workoutStore } from "@/stores/workout";
import { getDb } from "./db";
import { localOwner, pullFromServer } from "./pull";
import { fetchRemoteState } from "./remote";
import { outboxIdle } from "./sink";
import { syncNow, useSyncStatus } from "./sync";

// Gesamter Abgleich eines Geräts: erst hochladen (Outbox), dann den Server-Stand holen.
// Holen höchstens alle 10 Minuten, außer erzwungen (Anmeldung, „Jetzt synchronisieren“).

const PULL_INTERVAL_MS = 10 * 60 * 1000;
let running: Promise<void> | null = null;

const settleFirstPull = (state: "done" | "skipped" | "failed") => {
  if (useSyncStatus.getState().firstPull === "pending") useSyncStatus.setState({ firstPull: state });
};

async function run(force: boolean): Promise<void> {
  try {
    await pushAndPull(force);
  } catch (err) {
    // z. B. Netzabbruch beim Prüfen der Anmeldung – das Dashboard darf nicht auf „Lade …“ hängen bleiben
    console.error("Abgleich fehlgeschlagen", err);
    settleFirstPull("failed");
  }
}

async function pushAndPull(force: boolean): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !navigator.onLine) return settleFirstPull("skipped");
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return settleFirstPull("skipped");

  await outboxIdle();
  await syncNow();

  const last = useSyncStatus.getState().lastPulledAt;
  if (!force && last && Date.now() - Date.parse(last) < PULL_INTERVAL_MS) return;

  useSyncStatus.setState({ pulling: true });
  try {
    await pullFromServer({
      db: getDb(),
      plans: planStore,
      workout: workoutStore,
      settings: useSettings.getState(),
      owner: localOwner,
      userId,
      fetch: () => fetchRemoteState(supabase, userId),
      settle: outboxIdle,
    });
    useSyncStatus.setState({ lastPulledAt: new Date().toISOString(), pullError: null });
    settleFirstPull("done");
  } catch (err) {
    useSyncStatus.setState({ pullError: err instanceof Error ? err.message : String(err) });
    settleFirstPull("failed");
  } finally {
    useSyncStatus.setState({ pulling: false });
  }
}

/** Hochladen und – wenn fällig oder erzwungen – den Server-Stand übernehmen. Läuft nie parallel. */
export function syncDevice(options: { force?: boolean } = {}): Promise<void> {
  const force = options.force ?? false;
  const previous = running ?? Promise.resolve();
  const next = (running ? previous.then(() => (force ? run(true) : undefined)) : run(force)).finally(() => {
    if (running === next) running = null;
  });
  running = next;
  return next;
}

/** Nach dem Abmelden: Status zurücksetzen, damit die nächste Anmeldung sofort abgleicht. */
export function resetDeviceSync(): void {
  useSyncStatus.setState({ lastPulledAt: null, pullError: null, firstPull: "pending" });
}
