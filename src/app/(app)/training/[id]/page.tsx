import type { Metadata } from "next";
import { Suspense } from "react";
import { TrainingDetail } from "./training-detail";

export const metadata: Metadata = { title: "Training" };

// Trainings liegen lokal (IndexedDB) – die Seite lädt sie im Browser anhand der ID aus der Adresse.
export default function TrainingPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[1.125rem] bg-surface" />}>
      <TrainingDetail />
    </Suspense>
  );
}
