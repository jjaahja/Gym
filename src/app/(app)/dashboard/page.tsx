import type { Metadata } from "next";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { ActiveWorkoutCard } from "./active-workout-card";

export const metadata: Metadata = { title: "Plan" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dein Plan" subtitle="Muskelaufbau & Optik" />
      <div className="space-y-4">
        <ActiveWorkoutCard />
        <Card>
          <h2 className="text-lg font-semibold">Noch kein Trainingsplan</h2>
          <p className="mt-1 text-sm text-muted">
            Beantworte ein paar Fragen zu Ziel, Erfahrung, Equipment und Zeit. Daraus entsteht ein Plan nach
            aktuellen sportwissenschaftlichen Richtwerten.
          </p>
          <div className="mt-4">
            <ButtonLink href="/onboarding">Plan erstellen</ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Diese Woche</h2>
          <p className="mt-1 text-sm text-muted">
            Sobald du trainierst, siehst du hier deine harten Sätze pro Muskelgruppe im Vergleich zum Zielbereich.
          </p>
        </Card>
      </div>
    </>
  );
}
