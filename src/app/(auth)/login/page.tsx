import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">Gym</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Trainieren nach Wissenschaft</h1>
        <p className="mt-2 text-muted">Planen, tracken und automatisch anpassen – für Muskelaufbau und Optik.</p>
      </div>
      {/* useSearchParams braucht unter Cache Components eine Suspense-Grenze */}
      <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-surface" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
