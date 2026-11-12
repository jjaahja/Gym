import type { SupabaseClient } from "@supabase/supabase-js";
import { clearErrorLog } from "@/lib/error-log";
import { useHealthExtras } from "@/lib/health/extras";
import { useHealthSync } from "@/lib/health/use-health-sync";
import { setReminders } from "@/lib/native/device";
import { getDb } from "@/lib/offline/db";
import { resetDeviceSync } from "@/lib/offline/device-sync";
import { PHOTO_BUCKET } from "@/lib/offline/outbox";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { workoutStore } from "@/stores/workout";

// Konto: alle Daten dieses Kontos vom Gerät entfernen (Abmelden) bzw. das Konto vollständig löschen.

const DEVICE_KEYS = ["gym-health-connect", "gym-health-connect-write", "gym-health-extras", "gym-reminders-applied"];

/** Alles, was zum Konto gehört, vom Gerät entfernen. Darstellung (Farbe, Einheit) bleibt. */
export async function clearLocalData(): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.outbox, db.sessions, db.measurements, db.notes, db.nutrition, db.photos, db.calibrations], async () => {
    await Promise.all([
      db.outbox.clear(),
      db.sessions.clear(),
      db.measurements.clear(),
      db.notes.clear(),
      db.nutrition.clear(),
      db.photos.clear(),
      db.calibrations.clear(),
    ]);
  });
  resetDeviceSync();
  useHealthSync.getState().disconnect();
  useHealthSync.getState().disableWrite();
  useSettings.getState().setReminders({ ...useSettings.getState().reminders, enabled: false });
  await setReminders([]).catch(() => false);
  for (const key of DEVICE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ohne Speicher nichts zu tun
    }
  }
  useHealthExtras.setState({ status: null, lastRead: null, sleep: [], restingHr: [] });
  clearErrorLog();
  workoutStore.setState({ session: null });
  planStore.getState().clear();
}

/** Alle Fotodateien im eigenen Ordner des privaten Speichers löschen (vor dem Konto – die Datenbank kann das nicht). */
export async function deletePhotoFiles(client: SupabaseClient, userId: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await client.storage.from(PHOTO_BUCKET).list(userId, { limit: 100 });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return removed;
    const { error: removeError } = await client.storage.from(PHOTO_BUCKET).remove(data.map((f) => `${userId}/${f.name}`));
    if (removeError) throw new Error(removeError.message);
    removed += data.length;
    if (data.length < 100) return removed;
  }
}

/** Konto endgültig löschen: Fotos, dann alle Daten (Datenbank kaskadiert), dann lokal abmelden. */
export async function deleteAccount(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Nicht angemeldet");
  await deletePhotoFiles(client, userId);
  const { error } = await client.rpc("delete_my_account");
  if (error) throw new Error(error.message);
  await client.auth.signOut({ scope: "local" });
  await clearLocalData();
}
