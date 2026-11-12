"use client";

import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Stepper } from "@/components/ui";
import type { Exercise } from "@/lib/catalog";
import type { UnitSystem } from "@/lib/db/enums";
import { getDb } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { getCurrentUserId } from "@/lib/supabase/client";
import { actualRir, MIN_CALIBRATIONS, saveCalibration, validateCalibration, type RirBias } from "@/lib/training/rir-calibration";
import { fromDisplayWeight, toDisplayWeight, weightUnitLabel } from "@/lib/units";
import { workoutStore } from "@/stores/workout";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * RIR-Check im letzten Satz: erst schätzen, dann bis zum Versagen. Der Satz wird als Arbeitssatz mit RIR 0 eingetragen,
 * die Schätzung separat gespeichert (persönliche Abweichung für künftige Gewichtsvorschläge).
 */
export function RirCheckSheet({
  exercise,
  unit,
  defaultWeightKg,
  bias,
  onClose,
  ensureLog,
  onLogged,
}: {
  exercise: Exercise;
  unit: UnitSystem;
  defaultWeightKg: number | null;
  bias: RirBias | null;
  onClose: () => void;
  ensureLog: () => string;
  onLogged: () => void;
}) {
  const [weight, setWeight] = useState(defaultWeightKg != null ? String(toDisplayWeight(defaultWeightKg, unit)).replace(".", ",") : "");
  const [stopReps, setStopReps] = useState(10);
  const [predicted, setPredicted] = useState(2);
  const [failureReps, setFailureReps] = useState(12);
  const [result, setResult] = useState<{ actual: number; predicted: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const error = validateCalibration({ stopReps, predictedRir: predicted, failureReps });

  async function save() {
    if (error) return;
    const w = Number.parseFloat(weight.replace(",", "."));
    const weightKg = Number.isFinite(w) ? fromDisplayWeight(w, unit) : null;
    setSaving(true);
    try {
      workoutStore.getState().logSet(ensureLog(), { setType: "working", weightKg, reps: failureReps, rir: 0 });
      await saveCalibration(
        getDb(),
        { exerciseId: exercise.id, performedOn: today(), weightKg, stopReps, predictedRir: predicted, failureReps },
        { userId: await getCurrentUserId(), sink: writeToOutbox },
      );
      // Anzahl jetzt festhalten – „bias“ aktualisiert sich gleich live mit diesem Test
      setResult({ actual: actualRir({ stopReps, failureReps }), predicted, total: (bias?.count ?? 0) + 1 });
      onLogged();
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const diff = result.actual - result.predicted;
    return (
      <Sheet open onClose={onClose} title="RIR-Check">
        <div className="space-y-4 text-center">
          <p className="text-5xl font-bold tabular">{diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}</p>
          <p className="text-[1.0625rem]">
            Geschätzt: <strong>{result.predicted}</strong> im Tank · tatsächlich: <strong>{result.actual}</strong>
          </p>
          <p className="text-[0.9375rem] text-muted">
            {diff === 0
              ? "Punktgenau geschätzt."
              : diff > 0
                ? `Du hattest ${diff} Wdh. mehr im Tank als gedacht – das ist typisch: Im Mittel liegt die Schätzung um etwa eine Wiederholung zu niedrig.`
                : `Du warst näher am Versagen als gedacht (${Math.abs(diff)} Wdh.).`}
          </p>
          <p className="text-[0.8125rem] text-muted">
            {result.total >= MIN_CALIBRATIONS
              ? "Deine Gewichtsvorschläge berücksichtigen ab jetzt deine persönliche Abweichung."
              : `Noch ${MIN_CALIBRATIONS - result.total} ${MIN_CALIBRATIONS - result.total === 1 ? "Test" : "Tests"}, dann fließt deine Abweichung in die Gewichtsvorschläge ein.`}
          </p>
          <button type="button" className={`${buttonStyles.primary} w-full`} onClick={onClose}>
            Fertig
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="RIR-Check">
      <div className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-[0.9375rem]">
          <li>Mach den Satz wie gewohnt. Wo du normalerweise aufhören würdest: Wiederholungen merken und schätzen, wie viele noch gingen.</li>
          <li>Dann weiter bis zum Muskelversagen (saubere Technik, keine Wiederholung mehr möglich).</li>
        </ol>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Gewicht ({weightUnitLabel(unit)})</span>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="field tabular" aria-label="Gewicht" />
        </label>
        <div className="divide-y divide-border rounded-[1.125rem] bg-surface px-4 shadow-card">
          <Stepper label="Stopp nach" value={stopReps} min={1} max={50} onChange={(v) => { setStopReps(v); if (failureReps < v) setFailureReps(v); }} format={(v) => `${v} Wdh.`} />
          <Stepper label="Geschätzt im Tank" value={predicted} min={0} max={6} onChange={setPredicted} />
          <Stepper label="Bis Versagen" value={failureReps} min={1} max={60} onChange={setFailureReps} format={(v) => `${v} Wdh.`} />
        </div>
        {bias && (
          <p className="text-[0.8125rem] text-muted">
            Bisher ({bias.count} {bias.count === 1 ? "Test" : "Tests"}): im Schnitt {bias.mean > 0 ? "+" : ""}
            {bias.mean.toLocaleString("de-DE")} Wdh. {bias.mean >= 0 ? "mehr" : "weniger"} im Tank als geschätzt.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="button" className={`${buttonStyles.primary} w-full`} disabled={Boolean(error) || saving} onClick={save}>
          Satz eintragen ({failureReps} Wdh. bis Versagen)
        </button>
        <p className="text-[0.8125rem] text-muted">
          Nur bei Maschinen, Kabel und Isolationsübungen – dort ist Versagen sicher. Im Schnitt unterschätzen Trainierende die
          Wiederholungen im Tank um etwa eine (Halperin et al. 2022, Meta-Analyse).
        </p>
      </div>
    </Sheet>
  );
}
