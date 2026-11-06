import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = { title: "Kalender" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader title="Kalender" subtitle="Trainings, Ruhetage, Deload und Auswertung" />
      <CalendarView />
    </>
  );
}
