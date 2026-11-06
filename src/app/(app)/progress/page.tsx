import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { ProgressContent } from "./progress-content";

export const metadata: Metadata = { title: "Fortschritt" };

export default function ProgressPage() {
  return (
    <>
      <PageHeader title="Fortschritt" subtitle="Kraft, Volumen und Optik im Verlauf" />
      <ProgressContent />
    </>
  );
}
