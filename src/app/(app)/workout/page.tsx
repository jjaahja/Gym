import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { WorkoutScreen } from "./workout-screen";

export const metadata: Metadata = { title: "Training" };

export default function WorkoutPage() {
  return (
    <>
      <PageHeader title="Training" />
      <WorkoutScreen />
    </>
  );
}
