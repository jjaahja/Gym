"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/sheet";
import { buttonStyles, List, ListRow, SectionLabel } from "@/components/ui";
import { deleteAccount } from "@/lib/account";
import { buildExport, setsCsv } from "@/lib/export";
import { saveFile } from "@/lib/native/device";
import { getDb } from "@/lib/offline/db";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { localDay } from "@/lib/training/schedule";
import { planStore } from "@/stores/plan";
import { useSettings } from "@/stores/settings";

/** Konto: E-Mail, Passwort, Datenexport, Konto löschen. Im Demo-Modus nur der Export. */
export function AccountCard() {
  const supabase = getSupabaseBrowserClient();
  const [user, setUser] = useState<{ email: string | null; createdAt: string | null } | null>(null);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => data.user && setUser({ email: data.user.email ?? null, createdAt: data.user.created_at ?? null }));
  }, [supabase]);

  async function exportData(kind: "json" | "csv") {
    setExporting(kind);
    setExportError(null);
    try {
      const db = getDb();
      const [sessions, measurements, notes, nutrition, photos, calibrations] = await Promise.all([
        db.sessions.orderBy("endedAt").toArray(),
        db.measurements.orderBy("measuredOn").toArray(),
        db.notes.toArray(),
        db.nutrition.toArray(),
        db.photos.toArray(),
        db.calibrations.toArray(),
      ]);
      const { plan, adaptations } = planStore.getState();
      const stamp = localDay(new Date());
      const dayNames = new Map((plan?.days ?? []).map((d) => [d.id, d.name]));
      const blob =
        kind === "json"
          ? new Blob(
              [
                JSON.stringify(
                  buildExport({
                    plan,
                    adaptations,
                    sessions,
                    measurements,
                    notes,
                    nutrition,
                    photos,
                    calibrations,
                    settings: (({ unitSystem, effortScale, loadTarget, weeklyGoal }) => ({ unitSystem, effortScale, loadTarget, weeklyGoal }))(useSettings.getState()),
                    email: user?.email ?? null,
                  }),
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            )
          : new Blob([setsCsv(sessions, (s) => (s.planDayId && dayNames.get(s.planDayId)) || "Training")], { type: "text/csv;charset=utf-8" });
      const ok = await saveFile(kind === "json" ? `gym-daten-${stamp}.json` : `gym-saetze-${stamp}.csv`, blob);
      if (!ok) setExportError("Speichern geht in dieser App-Version noch nicht – bitte auf 1.3 aktualisieren oder im Browser exportieren.");
    } catch {
      setExportError("Export fehlgeschlagen.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <section aria-labelledby="account">
      <SectionLabel>
        <span id="account">Konto & Daten</span>
      </SectionLabel>
      <List>
        {supabase && user?.email && (
          <ListRow
            title="E-Mail"
            detail={<span className="block max-w-[12rem] truncate text-[0.9375rem]">{user.email}</span>}
            subtitle={user.createdAt ? `Mitglied seit ${new Date(user.createdAt).toLocaleDateString("de-DE", { month: "long", year: "numeric" })}` : undefined}
          />
        )}
        {supabase && <ListRow href="/settings/password" title="Passwort ändern" />}
        <ListRow onClick={() => void exportData("json")} title={exporting === "json" ? "Exportiere …" : "Alle Daten exportieren"} detail="JSON" />
        <ListRow onClick={() => void exportData("csv")} title={exporting === "csv" ? "Exportiere …" : "Sätze als Tabelle"} detail="CSV" />
      </List>
      {exportError && (
        <p className="mt-2 px-4 text-sm text-danger" role="alert">
          {exportError}
        </p>
      )}
      <p className="mt-2 px-4 text-[0.8125rem] text-muted">
        Der Export enthält Plan, Trainings, Körpermaße, Notizen, Ernährung und RIR-Checks. Fotos speicherst du einzeln auf der{" "}
        <Link href="/progress/photos" className="text-accent">
          Fotoseite
        </Link>
        .
      </p>
      {supabase && user && (
        <List className="mt-4">
          <ListRow onClick={() => setDeleting(true)} title={<span className="text-danger">Konto löschen</span>} />
        </List>
      )}
      {deleting && <DeleteSheet onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const supabase = getSupabaseBrowserClient();
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirm.trim().toUpperCase() === "LÖSCHEN";

  async function run() {
    if (!supabase || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(supabase);
      router.replace("/login?deleted=1");
    } catch {
      setError("Löschen fehlgeschlagen. Prüfe deine Verbindung und versuch es erneut.");
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Konto löschen">
      <div className="space-y-4">
        <p className="text-[0.9375rem]">
          Dein Konto und alle Daten werden <strong>endgültig</strong> gelöscht: Plan, Trainings, Körpermaße, Notizen, Ernährung,
          RIR-Checks und Fortschrittsfotos – auf dem Server und auf diesem Gerät. Das lässt sich nicht rückgängig machen.
        </p>
        <p className="text-sm text-muted">Tipp: Exportiere vorher deine Daten. Einträge in Health Connect bleiben dort, bis du sie dort löschst.</p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Zur Bestätigung „LÖSCHEN“ eingeben</span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="characters" autoComplete="off" className="field" />
        </label>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button type="button" className={`${buttonStyles.danger} w-full`} disabled={!ready || busy} onClick={() => void run()}>
          {busy ? "Lösche …" : "Konto endgültig löschen"}
        </button>
      </div>
    </Sheet>
  );
}
