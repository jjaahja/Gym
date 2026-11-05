import type { Metadata } from "next";
import { ComingSoon, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Plan erstellen" };

export default function OnboardingPage() {
  return (
    <>
      <PageHeader title="Plan erstellen" subtitle="Ein paar Fragen, dann steht dein Plan." />
      <ComingSoon
        step={4}
        title="Fragebogen"
        items={[
          "Ziel (Standard: Muskelaufbau & Optik) und Erfahrungsstand",
          "Trainingstage pro Woche und Dauer pro Einheit",
          "Verfügbares Equipment",
          "Körperpartien mit optischer Priorität (z. B. Schultern, Arme)",
          "Einschränkungen und Übungen, die du meiden willst",
        ]}
      />
    </>
  );
}
