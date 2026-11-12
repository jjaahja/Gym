"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles, Card, SectionLabel } from "@/components/ui";
import { getExerciseById } from "@/lib/catalog";
import { SET_TYPE_LABELS } from "@/lib/labels";
import { getDb, type CompletedSet } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { getCurrentUserId } from "@/lib/supabase/client";
import { deleteCompletedSession, deleteCompletedSet, updateCompletedSet, updateSessionRpe } from "@/lib/workout/edit-session";
import { formatWeight, fromDisplayWeight, toDisplayWeight, weightUnitLabel } from "@/lib/units";
import { usePlan } from "@/stores/plan";
import { useSettings } from "@/stores/settings";

const opts = async () => ({ userId: await getCurrentUserId(), sink: writeToOutbox });
const parse = (raw: string) => {
  const n = Number.parseFloat(raw.replace(",", "."));
  return raw.trim() === "" ? null : Number.isFinite(n) ? n : NaN;
};

/** Abgeschlossenes Training ansehen und korrigieren (Sätze, Anstrengung) oder löschen. */
export function TrainingDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useLiveQuery(() => getDb().sessions.get(id), [id], null);
  const plan = usePlan((s) => s.plan);
  const unit = useSettings((s) => s.unitSystem);
  const [editing, setEditing] = useState<{ logId: string; set: CompletedSet; name: string } | null>(null);

  if (session === null) return <div className="h-64 animate-pulse rounded-[1.125rem] bg-surface" />;
  if (!session)
    return (
      <Card>
        <p className="font-semibold">Training nicht gefunden</p>
        <p className="mt-1 text-sm text-muted">Vielleicht wurde es gelöscht.</p>
        <Link href="/calendar" className={`${buttonStyles.secondary} mt-3 w-full`}>
          Zum Kalender
        </Link>
      </Card>
    );

  const name = plan?.days.find((d) => d.id === session.planDayId)?.name ?? "Freies Training";
  const minutes = Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000);
  const date = new Date(session.startedAt).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-5">
      <header>
        <Link href="/calendar" className="text-[1.0625rem] text-accent">
          ‹ Kalender
        </Link>
        <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15]">{name}</h1>
        <p className="text-[0.9375rem] text-muted">
          {date} · {minutes} min{session.deload ? " · Deload" : ""}
        </p>
      </header>

      <section>
        <SectionLabel>Anstrengung (Session-RPE)</SectionLabel>
        <Card>
          <div className="grid grid-cols-6 gap-1.5">
            {[5, 6, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={session.sessionRpe === v}
                onClick={async () => updateSessionRpe(getDb(), session.id, v, await opts())}
                className={`min-h-11 rounded-[0.625rem] font-semibold ${session.sessionRpe === v ? "bg-accent text-accent-fg" : "bg-surface-2"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </Card>
      </section>

      {session.exercises.map((e) => {
        const exercise = getExerciseById(e.exerciseId);
        let working = 0;
        return (
          <section key={e.logId}>
            <SectionLabel>
              {exercise ? (
                <Link href={`/exercises/${exercise.slug}`} className="normal-case">
                  {exercise.nameDe} ›
                </Link>
              ) : (
                "Übung"
              )}
            </SectionLabel>
            <ul className="overflow-hidden rounded-[1.125rem] bg-surface shadow-card">
              {[...e.sets]
                .sort((a, b) => a.setIndex - b.setIndex)
                .map((s, i) => {
                  if (s.setType === "working") working++;
                  return (
                    <li key={s.id} className={i > 0 ? "border-t border-border" : ""}>
                      <button
                        type="button"
                        onClick={() => setEditing({ logId: e.logId, set: s, name: exercise?.nameDe ?? "Übung" })}
                        className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
                      >
                        <span className="w-20 shrink-0 text-[0.8125rem] text-muted">
                          {s.setType === "working" ? `Satz ${working}` : SET_TYPE_LABELS[s.setType]}
                        </span>
                        <span className="tabular flex-1 text-[1.0625rem]">
                          {s.durationSeconds ? `${s.durationSeconds} s` : `${s.weightKg ? `${formatWeight(s.weightKg, unit)} × ` : ""}${s.reps} Wdh.`}
                          {s.rir != null && <span className="text-muted"> · RIR {s.rir}</span>}
                        </span>
                        <span aria-hidden="true" className="text-xl text-muted/60">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </section>
        );
      })}

      <p className="px-4 text-[0.8125rem] text-muted">
        Korrekturen fließen in Verlauf, Rekorde und künftige Gewichtsvorschläge ein. Die Laststeigerung nach dem Training wird nicht
        neu berechnet.
      </p>

      <button
        type="button"
        className={`${buttonStyles.danger} w-full`}
        onClick={async () => {
          if (!window.confirm("Training löschen? Alle Sätze dieses Trainings werden entfernt.")) return;
          await deleteCompletedSession(getDb(), session.id, await opts());
          router.replace("/calendar");
        }}
      >
        Training löschen
      </button>

      {editing && (
        <EditSetSheet
          key={editing.set.id}
          name={editing.name}
          set={editing.set}
          unit={unit}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await updateCompletedSet(getDb(), session.id, editing.logId, editing.set.id, patch, await opts());
            setEditing(null);
          }}
          onDelete={async () => {
            await deleteCompletedSet(getDb(), session.id, editing.logId, editing.set.id, await opts());
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function EditSetSheet({
  name,
  set,
  unit,
  onClose,
  onSave,
  onDelete,
}: {
  name: string;
  set: CompletedSet;
  unit: ReturnType<typeof useSettings.getState>["unitSystem"];
  onClose: () => void;
  onSave: (patch: { weightKg?: number | null; reps?: number | null; rir?: number | null; durationSeconds?: number | null }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const timed = set.durationSeconds != null && set.reps == null;
  const [weight, setWeight] = useState(set.weightKg != null ? String(toDisplayWeight(set.weightKg, unit)).replace(".", ",") : "");
  const [reps, setReps] = useState(String(timed ? set.durationSeconds : (set.reps ?? "")));
  const [rir, setRir] = useState(set.rir != null ? String(set.rir) : "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const w = parse(weight);
    const r = parse(reps);
    const x = parse(rir);
    if (Number.isNaN(w) || Number.isNaN(r) || Number.isNaN(x)) return setError("Bitte Zahlen eingeben");
    try {
      await onSave(
        timed
          ? { durationSeconds: r == null ? null : Math.round(r) }
          : { weightKg: w == null ? null : fromDisplayWeight(w, unit), reps: r == null ? null : Math.round(r), rir: x },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    }
  };

  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {!timed && (
            <label className="text-sm">
              <span className="text-muted">Gewicht ({weightUnitLabel(unit)})</span>
              <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="field tabular mt-1 text-center text-lg font-semibold" />
            </label>
          )}
          <label className="text-sm">
            <span className="text-muted">{timed ? "Sekunden" : "Wdh."}</span>
            <input value={reps} onChange={(e) => setReps(e.target.value)} inputMode="numeric" className="field tabular mt-1 text-center text-lg font-semibold" />
          </label>
          {!timed && (
            <label className="text-sm">
              <span className="text-muted">RIR</span>
              <input value={rir} onChange={(e) => setRir(e.target.value)} inputMode="decimal" className="field tabular mt-1 text-center text-lg font-semibold" />
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="button" className={`${buttonStyles.primary} w-full`} onClick={() => void save()}>
          Speichern
        </button>
        <button
          type="button"
          className={`${buttonStyles.danger} w-full`}
          onClick={() => {
            if (window.confirm("Diesen Satz löschen?")) void onDelete();
          }}
        >
          Satz löschen
        </button>
      </div>
    </Sheet>
  );
}
