import type { Metadata } from "next";
import { WorkoutScreen } from "./workout-screen";

export const metadata: Metadata = { title: "Training" };

export default function WorkoutPage() {
  return <WorkoutScreen />;
}
