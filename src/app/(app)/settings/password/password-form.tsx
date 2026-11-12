"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonStyles, Card } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Neues Passwort setzen – aus dem Profil oder über den Link aus „Passwort vergessen“. */
export function PasswordForm() {
  const supabase = getSupabaseBrowserClient();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = repeat.length > 0 && repeat !== password;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || password.length < 8 || password !== repeat) return;
    setBusy(true);
    setState(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (!error) {
      setPassword("");
      setRepeat("");
      setState({ ok: true, text: "Passwort geändert." });
    } else {
      setState({
        ok: false,
        text:
          error.code === "same_password"
            ? "Das ist dein bisheriges Passwort – nimm ein anderes."
            : error.code === "weak_password"
              ? "Das Passwort ist zu schwach. Nimm mindestens 8 Zeichen."
              : error.code === "reauthentication_needed"
                ? "Bitte melde dich neu an und versuch es dann noch einmal."
                : "Das hat nicht geklappt. Bitte versuch es erneut.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <Link href="/settings" className="text-[1.0625rem] text-accent">
          ‹ Profil
        </Link>
        <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15]">Passwort</h1>
      </header>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Neues Passwort
            <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Wiederholen
            <input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} className="field mt-1" />
          </label>
          {(tooShort || mismatch) && (
            <p className="text-sm text-danger" role="alert">
              {tooShort ? "Mindestens 8 Zeichen." : "Die Passwörter stimmen nicht überein."}
            </p>
          )}
          {state && (
            <p className={`text-sm ${state.ok ? "text-good" : "text-danger"}`} role={state.ok ? "status" : "alert"}>
              {state.text}
            </p>
          )}
          <button type="submit" disabled={busy || !supabase || password.length < 8 || password !== repeat} className={`${buttonStyles.primary} w-full`}>
            {busy ? "Speichere …" : "Passwort speichern"}
          </button>
        </form>
      </Card>
    </div>
  );
}
