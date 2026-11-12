"use client";

import { useState, type FormEvent } from "react";
import { LineChart, StatTile } from "@/components/charts";
import { CameraIcon } from "@/components/icons";
import { buttonStyles, Card, List, ListRow } from "@/components/ui";
import type { Measurement } from "@/lib/offline/db";
import { getDb } from "@/lib/offline/db";
import { deleteMeasurement, MEASURE_FIELDS, saveMeasurement, type MeasureKey, type MeasurementInput } from "@/lib/offline/measurements";
import { writeToOutbox } from "@/lib/offline/sink";
import { getCurrentUserId } from "@/lib/supabase/client";
import {
  fromDisplayLength,
  fromDisplayWeight,
  lengthUnitLabel,
  toDisplayLength,
  toDisplayWeight,
  weightUnitLabel,
} from "@/lib/units";
import { useSettings } from "@/stores/settings";
import { HealthConnectCard } from "./health-connect-card";
import { dayToMs, formatDate, formatDateMedium, formatDateShort, isoDay, num, signed } from "./format";

type Unit = ReturnType<typeof useSettings.getState>["unitSystem"];
type Field = (typeof MEASURE_FIELDS)[number];

const displayUnit = (f: Field, unit: Unit) => (f.unit === "kg" ? weightUnitLabel(unit) : f.unit === "cm" ? lengthUnitLabel(unit) : "%");
const toDisplay = (f: Field, value: number, unit: Unit) =>
  f.unit === "kg" ? toDisplayWeight(value, unit) : f.unit === "cm" ? toDisplayLength(value, unit) : value;
const fromDisplay = (f: Field, value: number, unit: Unit) =>
  f.unit === "kg" ? fromDisplayWeight(value, unit) : f.unit === "cm" ? fromDisplayLength(value, unit) : value;

/** Für die Optik: Taille runter, Arme/Schultern/Brust rauf ist gut. Körpergewicht ist neutral. */
const UP_IS_GOOD: Partial<Record<MeasureKey, boolean>> = {
  waistCm: false,
  hipsCm: false,
  bodyFatPercent: false,
  armCm: true,
  shouldersCm: true,
  chestCm: true,
  thighCm: true,
  calfCm: true,
};

const parse = (raw: string) => {
  const v = Number(raw.replace(",", "."));
  return raw.trim() === "" || !Number.isFinite(v) ? null : v;
};

export function BodyTab({ measurements }: { measurements: readonly Measurement[] }) {
  const unit = useSettings((s) => s.unitSystem);
  const withData = MEASURE_FIELDS.filter((f) => measurements.some((m) => m[f.key] != null));
  const [selected, setSelected] = useState<MeasureKey | null>(null);
  const field = withData.find((f) => f.key === selected) ?? withData.find((f) => f.key === "waistCm") ?? withData[0];

  return (
    <div className="space-y-4">
      <List>
        <ListRow
          href="/progress/photos"
          icon={<CameraIcon className="size-[1.125rem]" />}
          title="Fortschrittsfotos"
          subtitle="Aufnehmen mit Vorlage, Vorher/Nachher vergleichen"
        />
      </List>
      <HealthConnectCard />
      <MeasurementForm measurements={measurements} unit={unit} />

      {field ? (
        <>
          <div className="-mx-4 overflow-x-auto px-4" role="group" aria-label="Maß wählen">
            <div className="flex w-max gap-2 pb-1">
              {withData.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={f.key === field.key}
                  onClick={() => setSelected(f.key)}
                  className={`min-h-10 whitespace-nowrap rounded-full px-3.5 text-sm font-medium ${
                    f.key === field.key ? "bg-accent text-accent-fg" : "bg-surface-2"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <FieldProgress field={field} measurements={measurements} unit={unit} />
          <ShapeRatio measurements={measurements} />
          <MeasurementList measurements={measurements} unit={unit} />
        </>
      ) : (
        <p className="text-sm text-muted">Trage deine ersten Maße ein – der Verlauf erscheint ab dem ersten Eintrag.</p>
      )}
    </div>
  );
}

function FieldProgress({ field, measurements, unit }: { field: Field; measurements: readonly Measurement[]; unit: Unit }) {
  const u = displayUnit(field, unit);
  const points = measurements.flatMap((m) => {
    const v = m[field.key];
    return v == null ? [] : [{ x: dayToMs(m.measuredOn), y: toDisplay(field, v, unit) }];
  });
  const first = points[0];
  const last = points.at(-1)!;
  const change = last.y - first.y;
  const fourWeeksAgo = last.x - 28 * 24 * 3600 * 1000;
  const baseline4 = [...points].reverse().find((p) => p.x <= fourWeeksAgo);
  const upGood = UP_IS_GOOD[field.key];
  const tone = (d: number) => (upGood === undefined || d === 0 ? "neutral" : (d > 0) === upGood ? "good" : "bad");
  const delta = (d: number, since: string) => ({
    text: since,
    direction: d > 0 ? ("up" as const) : d < 0 ? ("down" as const) : ("flat" as const),
    tone: tone(d) as "good" | "bad" | "neutral",
  });

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Aktuell" value={`${num(last.y)} ${u}`} hint={formatDateMedium(last.x)} />
        <StatTile
          label="Seit Beginn"
          value={`${signed(change)} ${u}`}
          delta={points.length > 1 ? delta(change, `seit ${formatDateMedium(first.x)}`) : undefined}
        />
        <StatTile
          label="4 Wochen"
          value={baseline4 ? `${signed(last.y - baseline4.y)} ${u}` : "–"}
          delta={baseline4 ? delta(last.y - baseline4.y, `seit ${formatDateMedium(baseline4.x)}`) : undefined}
          hint={baseline4 ? undefined : "noch zu wenig Daten"}
        />
      </div>
      <Card>
        <LineChart
          title={field.label}
          description={field.key === "bodyWeightKg" ? "Tagesschwankungen von 1–2 kg sind normal – auf den Trend achten." : undefined}
          points={points}
          formatValue={(v) => `${num(v)} ${u}`}
          formatTick={(v) => num(v)}
          formatDate={formatDate}
          formatDateShort={formatDateShort}
          valueLabel={`${field.label} (${u})`}
        />
      </Card>
    </>
  );
}

/** Schulter-Taillen-Verhältnis: zentrale Kennzahl der „V-Form“ für die Optik. */
function ShapeRatio({ measurements }: { measurements: readonly Measurement[] }) {
  const latest = [...measurements].reverse().find((m) => m.shouldersCm != null && m.waistCm != null);
  const first = measurements.find((m) => m.shouldersCm != null && m.waistCm != null);
  if (!latest || !first) return null;
  const ratio = latest.shouldersCm! / latest.waistCm!;
  const start = first.shouldersCm! / first.waistCm!;
  return (
    <Card>
      <p className="text-sm text-muted">Schultern : Taille</p>
      <p className="text-2xl font-semibold">{num(ratio, 2)}</p>
      {latest !== first && (
        <p className="text-sm text-muted">
          {signed(ratio - start, 2)} seit {formatDateMedium(dayToMs(first.measuredOn))}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        Breitere Schultern bei schmaler Taille prägen die V-Form. Steigt das Verhältnis, verbessert sich die Optik – auch wenn
        das Körpergewicht gleich bleibt. Schultern über die breiteste Stelle messen, Taille auf Nabelhöhe, entspannt ausatmen.
      </p>
    </Card>
  );
}

function emptyInput(day: string): MeasurementInput {
  return {
    measuredOn: day,
    bodyWeightKg: null,
    bodyFatPercent: null,
    shouldersCm: null,
    chestCm: null,
    waistCm: null,
    hipsCm: null,
    armCm: null,
    thighCm: null,
    calfCm: null,
    notes: null,
  };
}

function MeasurementForm({ measurements, unit }: { measurements: readonly Measurement[]; unit: Unit }) {
  const [day, setDay] = useState(() => isoDay(new Date()));
  const existing = measurements.find((m) => m.measuredOn === day);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Leere Eingabe zeigt den gespeicherten Wert des Tages (Bearbeiten statt doppelt anlegen)
  const shown = (f: Field) =>
    values[f.key] ?? (existing?.[f.key] != null ? String(toDisplay(f, existing[f.key]!, unit)).replace(".", ",") : "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const input = emptyInput(day);
    for (const f of MEASURE_FIELDS) {
      const raw = shown(f);
      const v = parse(raw);
      if (raw.trim() !== "" && v == null) {
        setError(`${f.label}: bitte eine Zahl eingeben`);
        return;
      }
      input[f.key] = v == null ? null : fromDisplay(f, v, unit);
    }
    input.notes = (notes ?? existing?.notes ?? "").trim() || null;
    setSaving(true);
    try {
      await saveMeasurement(getDb(), input, { userId: await getCurrentUserId(), sink: writeToOutbox });
      setValues({});
      setNotes(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof RangeError ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">{existing ? "Messung bearbeiten" : "Messung eintragen"}</h2>
          <label className="text-sm">
            <span className="sr-only">Datum</span>
            <input
              type="date"
              value={day}
              max={isoDay(new Date())}
              onChange={(e) => {
                setDay(e.target.value);
                setValues({});
                setNotes(null);
                setSaved(false);
              }}
              className="field min-h-11 w-auto px-2"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          Morgens nüchtern, gleiche Uhrzeit, alle 1–2 Wochen. Oberarm angespannt an der dicksten Stelle. Nur ausfüllen, was
          du misst.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {MEASURE_FIELDS.map((f) => (
            <label key={f.key} className="block min-w-0">
              <span className="mb-1 block truncate text-sm">
                {f.label} <span className="text-muted">({displayUnit(f, unit)})</span>
              </span>
              <input
                inputMode="decimal"
                autoComplete="off"
                value={shown(f)}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                  setSaved(false);
                  setError(null);
                }}
                className="tabular field block min-h-12"
              />
            </label>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-sm">Notiz</span>
          <input
            value={notes ?? existing?.notes ?? ""}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            className="field block min-h-12"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        {saved && !error && (
          <p role="status" className="mt-3 text-sm text-muted">
            Gespeichert.
          </p>
        )}
        <button type="submit" className={`${buttonStyles.primary} mt-4 w-full`} disabled={saving}>
          Speichern
        </button>
      </form>
    </Card>
  );
}

function MeasurementList({ measurements, unit }: { measurements: readonly Measurement[]; unit: Unit }) {
  const [open, setOpen] = useState(false);
  const rows = [...measurements].reverse();
  return (
    <Card>
      <button type="button" className="flex min-h-10 w-full items-center justify-between text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="font-semibold">Alle Einträge ({rows.length})</span>
        <span aria-hidden="true" className="text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                <p className="font-medium">{formatDate(dayToMs(m.measuredOn))}</p>
                <p className="tabular text-muted">
                  {MEASURE_FIELDS.filter((f) => m[f.key] != null)
                    .map((f) => `${f.label} ${num(toDisplay(f, m[f.key]!, unit))} ${displayUnit(f, unit)}`)
                    .join(" · ")}
                </p>
                {m.notes && <p className="text-muted">{m.notes}</p>}
              </div>
              <button
                type="button"
                className="min-h-10 shrink-0 px-2 text-sm font-medium text-danger"
                onClick={async () => {
                  if (!window.confirm(`Messung vom ${formatDate(dayToMs(m.measuredOn))} löschen?`)) return;
                  await deleteMeasurement(getDb(), m.id, { userId: await getCurrentUserId(), sink: writeToOutbox });
                }}
              >
                Löschen
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
