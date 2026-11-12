import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, pillStyles } from "@/components/ui";
import { ProgressContent } from "./progress-content";

export const metadata: Metadata = { title: "Fortschritt" };

export default function ProgressPage() {
  return (
    <>
      <PageHeader
        title="Fortschritt"
        subtitle="Kraft, Volumen und Optik im Verlauf"
        action={
          <Link href="/progress/review" className={pillStyles}>
            Rückblick
          </Link>
        }
      />
      <ProgressContent />
    </>
  );
}
