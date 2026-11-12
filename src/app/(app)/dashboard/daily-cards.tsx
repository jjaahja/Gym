"use client";

import Link from "next/link";
import { useState } from "react";
import { HeartPulseIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Card } from "@/components/ui";
import { useHealthExtras } from "@/lib/health/extras";
import { addProtein, proteinStatus, saveNutrition } from "@/lib/nutrition";
import { getDb, type NutritionDay } from "@/lib/offline/db";
import { listMeasurements } from "@/lib/offline/measurements";
import { writeToOutbox } from "@/lib/offline/sink";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { assessRecovery, formatSleep } from "@/lib/recovery";
import { getCurrentUserId } from "@/lib/supabase/client";

// Tageskarten im Dashboard: Eiweiß (Ziel aus dem Körpergewicht) und Erholung (Schlaf, Ruhepuls aus Health Connect).

const syncOptions = async () => ({ userId: await getCurrentUserId(), sink: writeToOutbox });

export function ProteinCard({ today }: { today: string }) {
  const days = useLiveQuery<NutritionDay[]>(() => getDb().nutrition.toArray(), [], []);
  const measurements = useLiveQuery(() => listMeasurements(getDb()), [], []);
  const weight = [...measurements].reverse().find((m) => m.bodyWeightKg != null)?.bodyWeightKg ?? null;
  const status = proteinStatus(days, today, weight);
  const todayEntry = days.find((d) => d.day === today);
  const [editing, setEditing] = useState(false);
  const value = status.today ?? 0;
  const shown = value.toLocaleString("de-DE", { maximumFractionDigits: 0 });
  const fill = status.target ? Math.min(100, (value / status.target.max) * 100) : 0;
  const minMark = status.target ? (status.target.min / status.target.max) * 100 : 0;
  const reached = status.target != null && value >= status.target.min;

  const add = async (grams: number) => void (await addProtein(getDb(), today, grams, await syncOptions()));

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Eiweiß heute</h2>
        {status.target && (
          <span className="tabular text-sm text-muted">
            Ziel {status.target.min}–{status.target.max} g
          </span>
        )}
      </div>
      <button type="button" onClick={() => setEditing(true)} className="mt-1 block text-left" aria-label={`Eiweiß heute: ${shown} Gramm – ändern`}>
        <span className="tabular text-[2.125rem] font-bold leading-none">{shown}</span>
        <span className="ml-1 text-[1.0625rem] text-muted">g</span>
        {reached && <span className="ml-2 rounded-full bg-good/15 px-2 py-0.5 align-middle text-xs font-semibold text-good">Ziel erreicht</span>}
      </button>
      {status.target && (
        <div className="relative mt-3 h-2 rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${fill}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 rounded bg-fg/40" style={{ left: `${minMark}%` }} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Eiweiß hinzufügen">
        {[10, 20, 30].map((g) => (
          <button key={g} type="button" onClick={() => void add(g)} className="min-h-11 rounded-[0.75rem] bg-accent-soft text-[0.9375rem] font-semibold text-accent active:opacity-70">
            +{g} g
          </button>
        ))}
        <button type="button" onClick={() => setEditing(true)} className="min-h-11 rounded-[0.75rem] bg-surface-2 text-[0.9375rem] font-semibold active:opacity-70">
          …
        </button>
      </div>
      <p className="mt-2 text-[0.8125rem] text-muted">
        {status.daysLogged > 0
          ? `Ø 7 Tage: ${status.weekAverage} g${status.target ? ` · ${status.daysOnTarget} von ${status.daysLogged} Tagen im Ziel` : ""}`
          : "Tippe, was du gegessen hast – grob reicht."}
        {todayEntry?.source === "health_connect" && " · heute aus Health Connect"}
      </p>
      {!status.target && (
        <p className="mt-1 text-[0.8125rem] text-muted">
          Für dein Ziel fehlt dein Körpergewicht –{" "}
          <Link href="/progress" className="text-accent">
            unter Fortschritt → Körper eintragen
          </Link>
          .
        </p>
      )}
      {editing && <ProteinSheet today={today} current={value} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function ProteinSheet({ today, current, onClose }: { today: string; current: number; onClose: () => void }) {
  const [text, setText] = useState(current ? String(current).replace(".", ",") : "");
  const parsed = text.trim() === "" ? null : Number.parseFloat(text.replace(",", "."));
  const valid = parsed == null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000);
  async function save() {
    if (!valid) return;
    await saveNutrition(getDb(), today, { proteinG: parsed, source: "manual" }, await syncOptions());
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title="Eiweiß heute">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Gramm insgesamt</span>
          <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" className="field tabular text-lg" autoFocus />
        </label>
        <ul className="space-y-1 text-[0.8125rem] text-muted">
          <li>Faustwerte: 250 g Magerquark ≈ 30 g · 100 g Hähnchen ≈ 23 g · 3 Eier ≈ 20 g · 1 Messlöffel Whey ≈ 20–25 g</li>
          <li>
            Warum 1,6–2,2 g je kg? Ab etwa 1,6 g steigt der Muskelzuwachs im Mittel kaum weiter; bis 2,2 g sind praktisch alle
            abgedeckt (Morton et al. 2018, Meta-Analyse).
          </li>
        </ul>
        <button type="button" className={`${buttonStyles.primary} w-full`} disabled={!valid} onClick={save}>
          Speichern
        </button>
      </div>
    </Sheet>
  );
}

const LEVEL = {
  ok: { label: "Gut erholt", cls: "bg-good/15 text-good" },
  reduced: { label: "Eingeschränkt", cls: "bg-warning-bg text-warning-fg" },
  low: { label: "Wenig erholt", cls: "bg-warning-bg text-warning-fg" },
} as const;

/** Nur mit Daten aus Health Connect (Android-App 1.3, Schlaf oder Ruhepuls erlaubt). */
export function RecoveryCard({ today }: { today: string }) {
  const { sleep, restingHr } = useHealthExtras();
  const recovery = assessRecovery(sleep, restingHr, today);
  if (!recovery) return null;
  const level = LEVEL[recovery.level];
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <HeartPulseIcon className="size-5 text-accent" /> Erholung
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${level.cls}`}>{level.label}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        {recovery.sleep && (
          <div>
            <dt className="text-[0.8125rem] text-muted">Schlaf letzte Nacht</dt>
            <dd className="tabular text-[1.0625rem] font-semibold">{formatSleep(recovery.sleep.minutes)}</dd>
            {recovery.sleep.baseline != null && <dd className="tabular text-xs text-muted">Schnitt {formatSleep(recovery.sleep.baseline)}</dd>}
          </div>
        )}
        {recovery.restingHr && (
          <div>
            <dt className="text-[0.8125rem] text-muted">Ruhepuls</dt>
            <dd className="tabular text-[1.0625rem] font-semibold">{recovery.restingHr.bpm} /min</dd>
            <dd className="tabular text-xs text-muted">
              Schnitt {Math.round(recovery.restingHr.baseline)} ({recovery.restingHr.delta > 0 ? "+" : ""}
              {recovery.restingHr.delta.toLocaleString("de-DE")})
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-[0.9375rem]">{recovery.advice}</p>
      <p className="mt-1 text-xs text-muted">
        Hinweis, keine Diagnose. Schlafmangel senkt die Leistung im Mittel um etwa 8 %, vor allem abends (Craven et al. 2022,
        Meta-Analyse).
      </p>
    </Card>
  );
}
