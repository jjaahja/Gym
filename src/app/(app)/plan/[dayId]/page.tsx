import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanDayEditor } from "./plan-day-editor";

export const metadata: Metadata = { title: "Trainingstag bearbeiten" };

// Der Plan liegt lokal (offline) – der Editor liest den Tag im Browser anhand der ID aus der Adresse.
export default function PlanDayPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[1.125rem] bg-surface" />}>
      <PlanDayEditor />
    </Suspense>
  );
}
