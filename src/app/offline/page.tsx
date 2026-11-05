import type { Metadata } from "next";
import { CloudOffIcon } from "@/components/icons";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Offline" };

// Wird vom Service Worker gezeigt, wenn eine Seite offline noch nie geladen wurde.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 text-center">
      <CloudOffIcon className="size-10 text-muted" />
      <h1 className="mt-4 text-2xl font-bold">Gerade offline</h1>
      <p className="mt-2 text-muted">
        Diese Seite ist noch nicht auf deinem Gerät gespeichert. Dein laufendes Training ist sicher und wird
        synchronisiert, sobald du wieder Netz hast.
      </p>
      <div className="mt-6">
        <ButtonLink href="/workout">Zum Training</ButtonLink>
      </div>
    </main>
  );
}
