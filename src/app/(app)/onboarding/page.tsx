import type { Metadata } from "next";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Plan erstellen" };

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
