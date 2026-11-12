"use client";

import { useState, useSyncExternalStore } from "react";
import { Card, Toggle } from "@/components/ui";
import { isAndroidApp } from "@/lib/health/health-connect";
import { applyReminders, type ReminderResult } from "@/lib/reminders";
import { weekdayShort, type Weekday } from "@/lib/training/schedule";
import { usePlan } from "@/stores/plan";
import { useSettings } from "@/stores/settings";

const noop = () => () => {};

/** Erinnerung an Trainingstagen (lokale Benachrichtigung, nur Android-App). */
export function ReminderSettings() {
  // Server: false, Browser: echter Wert – ohne Hydrationsfehler
  const android = useSyncExternalStore(noop, isAndroidApp, () => false);
  const { reminders, setReminders } = useSettings();
  const plan = usePlan((s) => s.plan);
  const [result, setResult] = useState<ReminderResult | null>(null);
  const days = (plan?.days ?? [])
    .map((d) => d.weekday)
    .filter((w): w is Weekday => w != null)
    .sort((a, b) => a - b);

  async function update(next: { enabled: boolean; time: string }) {
    setReminders(next);
    setResult(await applyReminders(true));
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Erinnerung an Trainingstagen</h2>
          <p className="text-sm text-muted">
            {!android
              ? "In der Android-App erinnert dich eine Benachrichtigung an deine Trainingstage."
              : days.length === 0
                ? "Lege zuerst Wochentage im Plan fest."
                : `${days.map(weekdayShort).join(", ")} um ${reminders.time} Uhr`}
          </p>
        </div>
        {android && (
          <Toggle
            label="Erinnerung an Trainingstagen"
            checked={reminders.enabled}
            disabled={days.length === 0}
            onChange={(enabled) => void update({ ...reminders, enabled })}
          />
        )}
      </div>
      {android && reminders.enabled && (
        <label className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[0.9375rem]">Uhrzeit</span>
          <input
            type="time"
            value={reminders.time}
            onChange={(e) => e.target.value && void update({ ...reminders, time: e.target.value })}
            className="field w-auto min-w-28 text-center tabular"
          />
        </label>
      )}
      {result === "denied" && (
        <p className="mt-2 text-sm text-danger" role="alert">
          Benachrichtigungen sind nicht erlaubt – bitte in den Android-Einstellungen für die App erlauben.
        </p>
      )}
    </Card>
  );
}
