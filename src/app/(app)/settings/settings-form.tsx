"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonStyles, Card } from "@/components/ui";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import { getDb } from "@/lib/offline/db";
import { clearHistory } from "@/lib/offline/history";
import { writeToOutbox } from "@/lib/offline/sink";
import { syncNow, useSyncStatus } from "@/lib/offline/sync";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";
import { workoutStore } from "@/stores/workout";

/** Anzeige-Einstellungen auch im Profil speichern (geräteübergreifend). */
async function syncProfile(patch: { unit_system?: UnitSystem; effort_scale?: EffortScale }) {
  const userId = await getCurrentUserId();
  if (userId) writeToOutbox({ table: "profiles", op: "upsert", rowId: userId, payload: { id: userId, ...patch } });
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-lg text-sm font-semibold transition-colors ${
              value === option.value ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsForm() {
  const { unitSystem, effortScale, setUnitSystem, setEffortScale } = useSettings();
  const { pending, syncing, lastError, lastSyncedAt } = useSyncStatus();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (!supabase) return;
    if (pending > 0 && !window.confirm(`${pending} Änderungen sind noch nicht synchronisiert und gehen verloren. Trotzdem abmelden?`)) {
      return;
    }
    setSigningOut(true);
    // Lokale Trainingsdaten gehören zum Konto → beim Abmelden vom Gerät entfernen
    await getDb().outbox.clear();
    await clearHistory(getDb());
    workoutStore.setState({ session: null });
    planStore.getState().clear();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-5">
        <Segmented
          label="Gewichtseinheit"
          value={unitSystem}
          onChange={(v) => {
            setUnitSystem(v);
            void syncProfile({ unit_system: v });
          }}
          options={[
            { value: "metric", label: "kg" },
            { value: "imperial", label: "lb" },
          ]}
        />
        <div>
          <Segmented
            label="Anstrengung angeben als"
            value={effortScale}
            onChange={(v) => {
              setEffortScale(v);
              void syncProfile({ effort_scale: v });
            }}
            options={[
              { value: "rir", label: "RIR" },
              { value: "rpe", label: "RPE" },
            ]}
          />
          <p className="mt-2 text-sm text-muted">
            {effortScale === "rir"
              ? "RIR = Wiederholungen im Tank: Wie viele hättest du noch geschafft? RIR 2 heißt: 2 wären noch gegangen."
              : "RPE = gefühlte Anstrengung von 1–10. RPE 8 entspricht 2 Wiederholungen im Tank (RPE = 10 − RIR)."}
          </p>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Synchronisierung</h2>
        {supabase ? (
          <>
            <p className="mt-1 text-sm text-muted">
              {pending === 0 ? "Alles synchronisiert." : `${pending} Änderungen warten auf Netz.`}
              {lastSyncedAt && ` Zuletzt: ${new Date(lastSyncedAt).toLocaleTimeString("de-DE")}.`}
            </p>
            {lastError && <p className="mt-2 text-sm text-danger">Letzter Fehler: {lastError}</p>}
            <button
              type="button"
              className={`${buttonStyles.secondary} mt-3 w-full`}
              disabled={syncing || pending === 0}
              onClick={() => void syncNow()}
            >
              {syncing ? "Synchronisiere …" : "Jetzt synchronisieren"}
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Demo-Modus: Ohne Supabase-Projekt bleiben alle Daten auf diesem Gerät.
          </p>
        )}
      </Card>

      {supabase && (
        <button type="button" className={`${buttonStyles.danger} w-full`} disabled={signingOut} onClick={signOut}>
          Abmelden
        </button>
      )}
    </div>
  );
}
