import type { Metadata } from "next";

export const metadata: Metadata = { title: "Datenschutz" };

// Öffentlich (ohne Anmeldung): Health Connect zeigt diese Seite, wenn man in den Android-Einstellungen
// nachsieht, wofür die App Gesundheitsdaten nutzt.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-2xl font-bold">Datenschutz</h1>
      <p className="text-muted">Stand: 6. November 2026</p>
      <p>
        Diese App ist ein privat betriebener Trainingsplaner. Sie verarbeitet nur die Daten, die für Trainingsplan,
        Fortschritt und Abgleich zwischen deinen Geräten nötig sind. Es gibt keine Werbung, kein Tracking und keinen
        Verkauf von Daten.
      </p>

      <h2>Welche Daten</h2>
      <ul>
        <li>Konto: E-Mail-Adresse und Passwort (verschlüsselt gespeichert).</li>
        <li>Training: Fragebogen, Trainingsplan, Trainings mit Sätzen, Gewichten und Feedback.</li>
        <li>Körpermaße: Gewicht, Körperfett und Umfänge, die du einträgst oder aus Health Connect übernimmst.</li>
      </ul>

      <h2>Health Connect (Android-App)</h2>
      <ul>
        <li>
          Nur nach deiner ausdrücklichen Erlaubnis liest die App <strong>Gewicht</strong> und <strong>Körperfettanteil</strong>{" "}
          aus Health Connect – sonst keine Gesundheitsdaten. Die App schreibt nichts in Health Connect.
        </li>
        <li>
          Zweck: Die Werte erscheinen in deinen Körpermaßen und in den Fortschrittsdiagrammen (pro Tag die letzte
          Messung). Sie werden wie selbst eingetragene Maße in deinem Konto gespeichert, damit sie auf allen deinen
          Geräten verfügbar sind.
        </li>
        <li>Die Daten werden nicht an Dritte weitergegeben und nicht für Werbung oder Analysen genutzt.</li>
        <li>
          Widerruf: in der App unter Fortschritt → Körper → „Abgleich beenden“ und in den Health-Connect-Einstellungen
          deines Telefons. Übernommene Messungen kannst du in der App einzeln löschen.
        </li>
      </ul>

      <h2>Wo die Daten liegen</h2>
      <ul>
        <li>Auf deinem Gerät (für die Nutzung ohne Netz).</li>
        <li>
          In der Datenbank (Supabase, Rechenzentrum Frankfurt am Main). Jeder Datensatz ist per Zugriffsregel nur für
          dein Konto lesbar.
        </li>
        <li>Die Webseite wird über Vercel ausgeliefert; dabei fallen technisch nötige Server-Protokolle an (z. B. IP-Adresse).</li>
      </ul>

      <h2>Weitere Dienste</h2>
      <ul>
        <li>
          Technikvideos werden erst nach deinem Tippen von YouTube (youtube-nocookie.com) geladen. Erst dann erhält
          YouTube Daten wie deine IP-Adresse.
        </li>
        <li>
          Kalender-Abo: Wenn du es einrichtest, ruft deine Kalender-App über einen geheimen Link nur die Trainingstermine
          ab. Du kannst den Link jederzeit erneuern oder löschen.
        </li>
      </ul>

      <h2>Löschen</h2>
      <p>
        Körpermaße und Trainings lassen sich in der App löschen. Für die Löschung des gesamten Kontos genügt eine kurze
        Nachricht an den Betreiber.
      </p>
    </main>
  );
}
