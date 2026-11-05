import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent">404</p>
      <h1 className="mt-2 text-2xl font-bold">Seite nicht gefunden</h1>
      <p className="mt-2 text-muted">Diese Seite oder Übung gibt es nicht (mehr).</p>
      <div className="mt-6">
        <ButtonLink href="/exercises">Zu den Übungen</ButtonLink>
      </div>
    </main>
  );
}
