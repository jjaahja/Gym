import type { Metadata } from "next";
import { ComingSoon, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Fortschritt" };

export default function ProgressPage() {
  return (
    <>
      <PageHeader title="Fortschritt" subtitle="Kraft, Volumen und Optik im Verlauf" />
      <ComingSoon
        step={5}
        title="Charts"
        items={[
          "Kraftverlauf je Übung (geschätztes 1RM, Topgewicht)",
          "Harte Sätze pro Muskelgruppe und Woche im Vergleich zum Zielbereich",
          "Körpermaße: Oberarm, Schultern, Brust, Taille",
          "Deine Pump-Übungen",
        ]}
      />
    </>
  );
}
