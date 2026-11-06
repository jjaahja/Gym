"use client";

import { useState } from "react";
import { Card, Segmented } from "@/components/ui";
import { getDb, type CompletedSession, type Measurement } from "@/lib/offline/db";
import { allSessions } from "@/lib/offline/history";
import { listMeasurements } from "@/lib/offline/measurements";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { usePlan } from "@/stores/plan";
import { BodyTab } from "./body-tab";
import { PumpTab } from "./pump-tab";
import { StrengthTab } from "./strength-tab";
import { VolumeTab } from "./volume-tab";

type Tab = "strength" | "volume" | "body" | "pump";

const TABS: { value: Tab; label: string }[] = [
  { value: "strength", label: "Kraft" },
  { value: "volume", label: "Volumen" },
  { value: "body", label: "Körper" },
  { value: "pump", label: "Pump" },
];

export function ProgressContent() {
  const [tab, setTab] = useState<Tab>("strength");
  const plan = usePlan((s) => s.plan);
  const sessions = useLiveQuery<CompletedSession[] | null>(() => allSessions(getDb()), [], null);
  const measurements = useLiveQuery<Measurement[] | null>(() => listMeasurements(getDb()), [], null);

  return (
    <div className="space-y-4">
      <Segmented value={tab} onChange={setTab} options={TABS} />
      {sessions == null || measurements == null ? (
        <Card className="h-64 animate-pulse">{null}</Card>
      ) : tab === "strength" ? (
        <StrengthTab sessions={sessions} />
      ) : tab === "volume" ? (
        <VolumeTab sessions={sessions} plan={plan} />
      ) : tab === "body" ? (
        <BodyTab measurements={measurements} />
      ) : (
        <PumpTab sessions={sessions} plan={plan} />
      )}
    </div>
  );
}
