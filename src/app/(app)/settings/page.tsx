import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Profil" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Profil" />
      <SettingsForm />
    </>
  );
}
