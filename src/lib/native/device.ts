import { isAndroidApp } from "@/lib/health/health-connect";

// Gerätefunktionen: Benachrichtigungen (Pausenende, Trainings-Erinnerungen) und Bildschirm anlassen.
// In der Android-App nativ (ab 1.3), im Browser so weit möglich über Web-APIs.

const REST_ID = 4201;
const REMINDER_BASE = 4300;
const ASKED_KEY = "gym-notify-asked";

type LocalNotificationsPlugin = typeof import("@capacitor/local-notifications").LocalNotifications;
interface GymDevicePlugin {
  keepAwake(options: { enabled: boolean }): Promise<void>;
  /** ab App 1.3 */
  shareFile(options: { name: string; mime: string; data: string }): Promise<void>;
}

// Plugins als Objekt zurückgeben – ein Proxy direkt aus einer async-Funktion würde als Promise behandelt
async function native(): Promise<{ notifications: LocalNotificationsPlugin | null; device: GymDevicePlugin | null }> {
  if (!isAndroidApp()) return { notifications: null, device: null };
  const [{ Capacitor, registerPlugin }, { LocalNotifications }] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/local-notifications"),
  ]);
  device ??= registerPlugin<GymDevicePlugin>("GymDevice");
  return {
    notifications: Capacitor.isPluginAvailable("LocalNotifications") ? LocalNotifications : null,
    device: Capacitor.isPluginAvailable("GymDevice") ? device : null,
  };
}
let device: GymDevicePlugin | null = null;

let channels = false;
async function ready(n: LocalNotificationsPlugin) {
  if (channels) return;
  channels = true;
  await n.createChannel({ id: "rest", name: "Pausen-Timer", description: "Wenn die Satzpause vorbei ist", importance: 5, vibration: true, visibility: 1 });
  await n.createChannel({ id: "reminders", name: "Trainings-Erinnerungen", description: "An Trainingstagen", importance: 3 });
}

/** Erlaubnis für Benachrichtigungen – fragt höchstens einmal von selbst (danach nur über die Einstellungen). */
export async function ensureNotifications(force = false): Promise<boolean> {
  const { notifications } = await native();
  if (!notifications) return false;
  const current = await notifications.checkPermissions();
  if (current.display === "granted") return true;
  try {
    if (!force && localStorage.getItem(ASKED_KEY)) return false;
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // ohne Speicher trotzdem fragen
  }
  return (await notifications.requestPermissions()).display === "granted";
}

export async function notificationsAllowed(): Promise<boolean | null> {
  const { notifications } = await native();
  if (!notifications) return null;
  return (await notifications.checkPermissions()).display === "granted";
}

/** Benachrichtigung zum Pausenende (auch bei ausgeschaltetem Bildschirm). Ersetzt eine vorherige. */
export async function scheduleRestEnd(at: number, body: string): Promise<void> {
  const { notifications } = await native();
  if (!notifications || (await notifications.checkPermissions()).display !== "granted") return;
  await ready(notifications);
  await notifications.cancel({ notifications: [{ id: REST_ID }] });
  if (at <= Date.now() + 1000) return;
  await notifications.schedule({
    notifications: [
      { id: REST_ID, title: "Pause vorbei", body, channelId: "rest", schedule: { at: new Date(at), allowWhileIdle: true } },
    ],
  });
}

export async function cancelRestEnd(): Promise<void> {
  const { notifications } = await native();
  await notifications?.cancel({ notifications: [{ id: REST_ID }] });
}

export interface ReminderSlot {
  /** ISO-Wochentag 1 = Mo … 7 = So */
  weekday: number;
  hour: number;
  minute: number;
  title: string;
  body: string;
}

/** Wöchentliche Erinnerungen ersetzen (Capacitor zählt Wochentage ab Sonntag = 1). */
export async function setReminders(slots: readonly ReminderSlot[]): Promise<boolean> {
  const { notifications } = await native();
  if (!notifications) return false;
  await notifications.cancel({ notifications: Array.from({ length: 7 }, (_, i) => ({ id: REMINDER_BASE + i })) });
  if (slots.length === 0) return true;
  if (!(await ensureNotifications(true))) return false;
  await ready(notifications);
  await notifications.schedule({
    notifications: slots.map((s, i) => ({
      id: REMINDER_BASE + i,
      title: s.title,
      body: s.body,
      channelId: "reminders",
      schedule: { on: { weekday: (s.weekday % 7) + 1, hour: s.hour, minute: s.minute }, allowWhileIdle: true },
    })),
  });
  return true;
}

let wakeLock: { release(): Promise<void> } | null = null;

/** Bildschirm während des Trainings anlassen. */
export async function keepAwake(enabled: boolean): Promise<void> {
  const { device: plugin } = await native();
  if (plugin) {
    await plugin.keepAwake({ enabled });
    return;
  }
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  try {
    if (enabled && !wakeLock && nav.wakeLock && document.visibilityState === "visible") wakeLock = await nav.wakeLock.request("screen");
    if (!enabled && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null; // z. B. Energiesparmodus – kein Problem
  }
}
/** Nach Rückkehr in den Tab neu anfordern (der Browser gibt die Sperre beim Verlassen frei). */
export function resetWakeLock() {
  wakeLock = null;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Datei speichern bzw. teilen: In der Android-App über das Teilen-Menü (Web-Downloads gehen dort nicht),
 * im Browser als Download. Liefert false, wenn die App-Version das noch nicht kann.
 */
export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  if (isAndroidApp()) {
    const { device: plugin } = await native();
    try {
      if (!plugin) return false;
      await plugin.shareFile({ name, mime: blob.type || "application/octet-stream", data: await toBase64(blob) });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
