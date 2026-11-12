"use client";

import { useMemo, useState } from "react";
import { buttonStyles, Card } from "@/components/ui";
import { getExercise, getExerciseById, getMuscle } from "@/lib/catalog";
import { getDb } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { buildMesocycleReview, type MesocycleReview } from "@/lib/training/mesocycle";
import type { AdaptationProposal, Trend } from "@/lib/training/progression";
import type { AdaptationRecord, StoredPlan, Suggestion } from "@/stores/plan-store";
import { planStore, usePlan } from "@/stores/plan";

// Mesozyklus-Auswertung, offene Vorschläge und Anpassungsprotokoll im Dashboard.

const shortName = (name: string) => name.replace(/ \(.*\)$/, "");
const TREND_LABEL: Record<Trend, { arrow: string; text: string }> = {
  up: { arrow: "▲", text: "steigend" },
  flat: { arrow: "●", text: "gleich" },
  down: { arrow: "▼", text: "sinkend" },
};

/** Überschrift eines Vorschlags: was sich ändert. */
export function proposalTitle(p: Pick<AdaptationProposal, "type" | "muscle" | "before" | "after">): string {
  switch (p.type) {
    case "swap_exercise": {
      const from = getExercise(String(p.before.exercise_slug))?.nameDe ?? "Übung";
      const to = getExercise(String(p.after.exercise_slug))?.nameDe ?? "Alternative";
      return `${from} → ${to}`;
    }
    case "deload":
      return "Leichtere Woche (Deload)";
    case "remove_exercise":
      return `${getExercise(String(p.before.exercise_slug))?.nameDe ?? "Übung"} aus dem Plan entfernt`;
    case "add_exercise":
      return `${getExercise(String(p.after.exercise_slug))?.nameDe ?? "Übung"} zum Plan hinzugefügt`;
    case "edit_exercise":
      return `${getExercise(String(p.before.exercise_slug))?.nameDe ?? "Übung"}: Vorgabe geändert`;
    case "add_set":
    case "remove_set": {
      const muscle = p.muscle ? shortName(getMuscle(p.muscle).nameDe) : "Volumen";
      const from = (p.before as { weekly_sets?: number }).weekly_sets;
      const to = (p.after as { weekly_sets?: number }).weekly_sets;
      const de = (n?: number) => (n == null ? "?" : n.toLocaleString("de-DE", { maximumFractionDigits: 1 }));
      return `${muscle}: ${de(from)} → ${de(to)} Sätze/Woche`;
    }
    default:
      return "Anpassung";
  }
}

// ─────────────────────────── Mesozyklus-Abschluss ───────────────────────────

export function MesocycleReviewCard({ plan, now }: { plan: StoredPlan; now: Date }) {
  const adaptations = usePlan((s) => s.adaptations);
  const sessions = useLiveQuery(() => allSessions(getDb()), [], null);
  const review = useMemo(
    () => (sessions ? buildMesocycleReview({ plan, sessions, now, adaptations }) : null),
    // Auswertung einmal je Plan-Stand und Historie; neue Vorschläge sollen die Liste nicht umsortieren
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.id, plan.cycleStartedAt, sessions, now],
  );
  if (!review || !sessions) return <Card className="h-40 animate-pulse">{null}</Card>;
  const trained = sessions.filter((s) => s.planId === plan.id && !s.deload && s.startedAt >= plan.cycleStartedAt).length;
  return <ReviewBody plan={plan} review={review} trained={trained} />;
}

function ReviewBody({ plan, review, trained }: { plan: StoredPlan; review: MesocycleReview; trained: number }) {
  const auto = review.volume.filter((p) => p.status === "auto_applied");
  const choices: Suggestion[] = [
    ...review.volume.filter((p) => p.status !== "auto_applied").map((proposal) => ({ proposal, planExerciseId: null })),
    ...(review.deload ? [{ proposal: review.deload, planExerciseId: null }] : []),
    ...review.swaps.map((s) => ({ proposal: s.proposal, planExerciseId: s.planExerciseId })),
  ];
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(new Set());
  const [done, setDone] = useState(false);
  const trends = Object.entries(review.trends).filter(([, t]) => t !== undefined) as [string, Trend][];

  function finish() {
    planStore.getState().completeMesocycle({
      volume: auto,
      accepted: choices.filter((_, i) => accepted.has(i)),
      rejected: choices.filter((_, i) => !accepted.has(i)),
    });
    setDone(true);
  }
  if (done) return null;

  return (
    <Card className="ring-1 ring-accent/50">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Auswertung</p>
      <h2 className="mt-0.5 text-xl font-bold">Mesozyklus {plan.completedMesocycles + 1} abgeschlossen</h2>
      <p className="text-sm text-muted">
        {plan.mesocycleWeeks} Wochen · {trained} {trained === 1 ? "Training" : "Trainings"}. Zeit, den Plan an deine Daten anzupassen.
      </p>

      {trends.length > 0 && trained > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium">Leistung je Muskel</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            {trends.map(([muscle, trend]) => (
              <li key={muscle} className="rounded-full bg-surface-2 px-2.5 py-1">
                {shortName(getMuscle(muscle as never).nameDe)}{" "}
                <span aria-hidden="true">{TREND_LABEL[trend].arrow}</span>
                <span className="sr-only">{TREND_LABEL[trend].text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">▲ steigend · ● gleich · ▼ sinkend (geschätztes 1RM, Anfang vs. Ende)</p>
        </div>
      )}

      {auto.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium">Wird angepasst</p>
          <ul className="mt-1 space-y-2">
            {auto.map((p) => (
              <li key={`${p.type}-${p.muscle}`} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <p className="font-semibold">{proposalTitle(p)}</p>
                <p className="text-muted">{p.explanation}</p>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Innerhalb deines Zielbereichs – lässt sich danach rückgängig machen.</p>
        </div>
      )}

      {choices.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Deine Entscheidung</legend>
          <ul className="mt-1 space-y-2">
            {choices.map((c, i) => (
              <li key={i}>
                <label className="flex cursor-pointer gap-3 rounded-[0.75rem] bg-surface-2 px-3 py-2 text-sm ring-1 ring-transparent has-[:checked]:ring-accent">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
                    checked={accepted.has(i)}
                    onChange={(e) => {
                      const next = new Set(accepted);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setAccepted(next);
                    }}
                  />
                  <span>
                    <span className="block font-semibold">{proposalTitle(c.proposal)}</span>
                    <span className="block text-muted">{c.proposal.explanation}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Angehakt = übernehmen. Nicht angehakte Vorschläge werden als abgelehnt gespeichert.</p>
        </fieldset>
      )}

      {auto.length === 0 && choices.length === 0 && (
        <p className="mt-3 text-sm">Alles im grünen Bereich – der Plan bleibt, wie er ist. Weiter mit doppelter Progression.</p>
      )}

      <button type="button" className={`${buttonStyles.primary} mt-4 w-full`} onClick={finish}>
        Neuen Mesozyklus starten
      </button>
    </Card>
  );
}

// ─────────────────────────── Offene Vorschläge ───────────────────────────

export function OpenSuggestions({ plan }: { plan: StoredPlan }) {
  const adaptations = usePlan((s) => s.adaptations);
  const open = adaptations.filter((a) => a.planId === plan.id && a.status === "suggested");
  if (open.length === 0) return null;
  return (
    <Card className="ring-1 ring-accent/50">
      <h2 className="text-lg font-semibold">{open.length === 1 ? "Vorschlag" : `${open.length} Vorschläge`} für deinen Plan</h2>
      <ul className="mt-2 divide-y divide-border">
        {open.map((a) => (
          <li key={a.id} className="py-3">
            <p className="font-semibold">{proposalTitle(a)}</p>
            <p className="text-sm text-muted">{a.explanation}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className={`${buttonStyles.primary} min-h-11`} onClick={() => planStore.getState().acceptSuggestion(a.id)}>
                Annehmen
              </button>
              <button type="button" className={`${buttonStyles.secondary} min-h-11`} onClick={() => planStore.getState().rejectSuggestion(a.id)}>
                Ablehnen
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─────────────────────────── Protokoll ───────────────────────────

const STATUS_LABELS: Record<AdaptationRecord["status"], string> = {
  auto_applied: "Automatisch angepasst",
  suggested: "Vorschlag",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  reverted: "Rückgängig gemacht",
};

export function AdaptationLog({ plan }: { plan: StoredPlan }) {
  const adaptations = usePlan((s) => s.adaptations);
  const [showAll, setShowAll] = useState(false);
  const resolved = adaptations.filter((a) => a.planId === plan.id && a.status !== "suggested");
  if (resolved.length === 0) return null;
  // Abgelehnte Vorschläge nur auf Wunsch – sonst verdrängen sie die tatsächlichen Änderungen
  const changes = resolved.filter((a) => a.status !== "rejected");
  const rejectedCount = resolved.length - changes.length;
  const visible = showAll ? resolved : changes.slice(0, 5);
  return (
    <Card>
      <h2 className="text-lg font-semibold">Anpassungen</h2>
      <ul className="mt-2 divide-y divide-border">
        {visible.map((a) => {
          const loadChange = a.type === "increase_load" || a.type === "decrease_load";
          const exercise = loadChange && a.planExerciseId
            ? plan.days.flatMap((d) => d.exercises).find((e) => e.id === a.planExerciseId)
            : null;
          return (
            <li key={a.id} className="py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{STATUS_LABELS[a.status]}</p>
              <p className="font-semibold">{exercise ? getExerciseById(exercise.exerciseId)?.nameDe : proposalTitle(a)}</p>
              <p className="text-sm text-muted">{a.explanation}</p>
              {(a.status === "auto_applied" || a.status === "accepted") && (
                <button
                  type="button"
                  className="mt-1 min-h-10 text-sm font-medium text-accent"
                  onClick={() => planStore.getState().revertAdaptation(a.id)}
                >
                  Rückgängig
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="mt-2 text-sm text-muted">Keine Änderungen am Plan.</p>}
      {resolved.length > visible.length || showAll ? (
        <button type="button" className="min-h-10 text-sm font-medium text-accent" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? "Weniger anzeigen"
            : `Alle ${resolved.length} anzeigen${rejectedCount > 0 ? ` (inkl. ${rejectedCount} abgelehnte Vorschläge)` : ""}`}
        </button>
      ) : null}
    </Card>
  );
}
