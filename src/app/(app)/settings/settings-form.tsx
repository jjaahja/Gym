"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppUpdateCard } from "@/components/app-update";
import { ThemePicker } from "@/components/theme-picker";
import { clearLocalData } from "@/lib/account";
import { ReminderSettings } from "./reminder-settings";
import { buttonStyles, Card, Segmented } from "@/components/ui";
import type { EffortScale, UnitSystem } from "@/lib/db/enums";
import { getDb } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { getCurrentUserId, getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSettings } from "@/stores/settings";
import { AccountCard } from "./account-card";
import { SyncCard } from "./sync-card";

/** Anzeige-Einstellungen auch im Profil speichern (geräteübergreifend). */
async function syncProfile(patch: { unit_system?: UnitSystem; effort_scale?: EffortScale }) {
  const userId = await getCurrentUserId();
  if (userId) writeToOutbox({ table: "profiles", op: "upsert", rowId: userId, payload: { id: userId, ...patch } });
}

export function SettingsForm() {
  const { unitSystem, effortScale, loadTarget, sex, setUnitSystem, setEffortScale, setLoadTarget, setSex } = useSettings();
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (!supabase) return;
    // Direkt zählen – die Anzeige kann kurz nach dem Laden noch leer sein
    const open = await getDb().outbox.count();
    if (open > 0 && !window.confirm(`${open} Änderungen sind noch nicht synchronisiert und gehen verloren. Trotzdem abmelden?`)) {
      return;
    }
    setSigningOut(true);
    // Alle Daten des Kontos (auch Fotos, Notizen, Ernährung) gehören zum Konto → beim Abmelden vom Gerät entfernen
    await clearLocalData();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="space-y-4">
      <ThemePicker />
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
        <div>
          <Segmented
            label="Gewichtsvorschlag im Training"
            value={loadTarget}
            onChange={setLoadTarget}
            options={[
              { value: "failure_last_set", label: "Versagen im letzten Satz" },
              { value: "plan", label: "Plan-Ziel" },
            ]}
          />
          <p className="mt-2 text-sm text-muted">
            {loadTarget === "failure_last_set"
              ? "Das Gewicht wird aus deinen letzten Sätzen berechnet: frühe Sätze mit 1–2 Wiederholungen im Tank, der letzte bis zum Muskelversagen. Bei schweren Grundübungen (z. B. Kniebeuge, Kreuzheben, Bankdrücken) bleibt im letzten Satz 1 im Tank – sicherer, kaum weniger Effekt."
              : "Das Gewicht wird aus deinen letzten Sätzen berechnet, Ziel ist in jedem Satz der Bereich aus deinem Plan (z. B. 1–3 Wiederholungen im Tank)."}
          </p>
        </div>
        <div>
          <Segmented
            label="Geschlecht (für Startgewichte)"
            value={sex ?? "none"}
            onChange={(v) => setSex(v === "none" ? null : v)}
            options={[
              { value: "male", label: "Männlich" },
              { value: "female", label: "Weiblich" },
              { value: "none", label: "Keine Angabe" },
            ]}
          />
          <p className="mt-2 text-sm text-muted">
            Bei Übungen ohne Verlauf schätzt die App ein Startgewicht – zuerst aus ähnlichen Übungen, sonst aus Körpergewicht,
            Erfahrung und Geschlecht (Kraft im Oberkörper unterscheidet sich im Schnitt deutlich). Ohne Angabe schätzt sie
            vorsichtiger. Nach dem ersten Satz zählt nur deine echte Leistung. Nur auf diesem Gerät gespeichert.
          </p>
        </div>
      </Card>

      <ReminderSettings />

      <SyncCard />
      <AccountCard />

      {supabase && (
        <button type="button" className={`${buttonStyles.danger} w-full`} disabled={signingOut} onClick={signOut}>
          Abmelden
        </button>
      )}
      <AppUpdateCard />

      <p className="text-center text-sm">
        <Link href="/datenschutz" className="text-muted underline underline-offset-4">
          Datenschutz
        </Link>
      </p>
    </div>
  );
}
