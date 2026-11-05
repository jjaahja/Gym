"use client";

import Link from "next/link";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonStyles } from "@/components/ui";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

function authErrorMessage(error: AuthError): string {
  if (isAuthRetryableFetchError(error)) return "Keine Verbindung zum Server. Prüfe dein Netz und versuch es erneut.";
  switch (error.code) {
    case "invalid_credentials":
      return "E-Mail oder Passwort stimmt nicht.";
    case "email_not_confirmed":
      return "Bitte bestätige zuerst deine E-Mail-Adresse.";
    case "user_already_exists":
      return "Für diese E-Mail gibt es schon ein Konto. Melde dich an.";
    case "weak_password":
      return "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Zu viele Versuche. Warte kurz und probier es dann noch einmal.";
    default:
      return "Das hat nicht geklappt. Bitte versuch es erneut.";
  }
}

const inputClass =
  "mt-1 block min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export function LoginForm() {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "Anmeldung fehlgeschlagen." : null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!supabase) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm">
          Es ist noch kein Supabase-Projekt verbunden. Trag <code>NEXT_PUBLIC_SUPABASE_URL</code> und{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env.local</code> ein, um Konten zu aktivieren.
        </p>
        <Link href="/dashboard" className={`${buttonStyles.primary} mt-4 w-full`}>
          Im Demo-Modus ansehen
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(authErrorMessage(error));
      } else {
        router.replace(next);
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
      });
      if (error) {
        setError(authErrorMessage(error));
      } else if (data.session) {
        router.replace("/onboarding");
      } else {
        setNotice("Fast geschafft: Bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben.");
      }
    }
    setBusy(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`min-h-11 rounded-lg text-sm font-semibold ${mode === m ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {m === "signin" ? "Anmelden" : "Registrieren"}
          </button>
        ))}
      </div>

      <label className="block text-sm font-medium">
        E-Mail
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </label>

      <label className="block text-sm font-medium">
        Passwort
        <input
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="text-sm">{notice}</p>}

      <button type="submit" disabled={busy} className={`${buttonStyles.primary} w-full`}>
        {busy ? "Einen Moment …" : mode === "signin" ? "Anmelden" : "Konto erstellen"}
      </button>
    </form>
  );
}
