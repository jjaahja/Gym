import { isAndroidApp } from "@/lib/health/health-connect";
import { reminderSlots } from "@/lib/motivation";
import { setReminders } from "@/lib/native/device";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";

// Erinnerung an Trainingstagen (Android-App): wöchentliche lokale Benachrichtigung je fest geplantem Tag.
// Neu geplant, sobald sich Uhrzeit, Schalter oder die Wochentage des Plans ändern.

const APPLIED_KEY = "gym-reminders-applied";

export type ReminderResult = "ok" | "off" | "denied" | "unsupported" | "no-days";

function wanted() {
  const { reminders } = useSettings.getState();
  const plan = planStore.getState().plan;
  const slots = reminders.enabled && plan ? reminderSlots(plan.days, reminders.time) : [];
  return { enabled: reminders.enabled, slots, key: JSON.stringify(slots) };
}

/** Erinnerungen planen (oder entfernen). force: auch wenn sich nichts geändert hat (z. B. nach Erlaubnis). */
export async function applyReminders(force = false): Promise<ReminderResult> {
  if (!isAndroidApp()) return "unsupported";
  const { enabled, slots, key } = wanted();
  let applied: string | null = null;
  try {
    applied = localStorage.getItem(APPLIED_KEY);
  } catch {
    // ohne Speicher: immer neu planen
  }
  if (!force && applied === key) return enabled ? (slots.length ? "ok" : "no-days") : "off";
  const ok = await setReminders(slots);
  if (!ok) return slots.length ? "denied" : "unsupported";
  try {
    localStorage.setItem(APPLIED_KEY, key);
  } catch {
    // beim nächsten Start erneut
  }
  return enabled ? (slots.length ? "ok" : "no-days") : "off";
}

/** Bei Änderungen an Einstellung oder Plan neu planen. Liefert die Abmeldung. */
export function watchReminders(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void applyReminders(), 500);
  };
  schedule();
  const a = useSettings.subscribe((s, prev) => s.reminders !== prev.reminders && schedule());
  const b = planStore.subscribe((s, prev) => s.plan !== prev.plan && schedule());
  return () => {
    clearTimeout(timer);
    a();
    b();
  };
}
