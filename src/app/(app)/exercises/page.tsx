import type { Metadata } from "next";
import { ComingSoon, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Übungen" };

export default function ExercisesPage() {
  return (
    <>
      <PageHeader title="Übungen" subtitle="Ausführung, Muskeln und Richtwerte" />
      <ComingSoon
        step={3}
        title="Übungs-Bibliothek"
        items={[
          "Suche und Filter nach Muskelgruppe, Equipment und Bewegungsmuster",
          "Detailseite mit Schritt-für-Schritt-Ausführung, typischen Fehlern und Medien",
          "Primär- und Sekundärmuskeln",
          "Richtwerte pro Übung: Wiederholungen, RIR, Pause, Pump-Finisher",
        ]}
      />
    </>
  );
}
