import type { Metadata } from "next";

export const metadata: Metadata = { title: "Datenschutz" };

// Öffentlich (ohne Anmeldung): Health Connect zeigt diese Seite, wenn man in den Android-Einstellungen
// nachsieht, wofür die App Gesundheitsdaten nutzt.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-2xl font-bold">Datenschutz</h1>
      <p className="text-muted">Stand: 11. November 2026</p>
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
        <li>Notizen zu Übungen und – falls du sie einträgst – Eiweiß und Kalorien pro Tag.</li>
        <li>
          Fortschrittsfotos, die du selbst aufnimmst oder auswählst (verkleinert auf höchstens 1600 Pixel, ohne
          Standortdaten).
        </li>
      </ul>

      <h2>Kamera und Fortschrittsfotos</h2>
      <ul>
        <li>
          Die Kamera wird nur geöffnet, wenn du unter Fortschritt → Körper → Fortschrittsfotos „Foto aufnehmen“ tippst –
          und erst nach deiner Freigabe. Es werden keine Videos gespeichert, nur das Foto, das du mit „Foto verwenden“
          bestätigst.
        </li>
        <li>
          Fotos liegen auf deinem Gerät und – mit Konto – in einem privaten Speicher (Supabase Storage, Frankfurt am
          Main), in einem Ordner, auf den per Zugriffsregel nur dein Konto zugreifen kann. Es gibt keine öffentlichen
          Links.
        </li>
        <li>Löschen: Foto antippen → „Foto löschen“ entfernt es auf allen Geräten und im Speicher.</li>
      </ul>

      <h2>Health Connect (Android-App)</h2>
      <ul>
        <li>
          Nur nach deiner ausdrücklichen Erlaubnis liest die App <strong>Gewicht</strong> und <strong>Körperfettanteil</strong>{" "}
          aus Health Connect – sonst keine Gesundheitsdaten.
        </li>
        <li>
          Nur wenn du es unter „Ernährung, Schlaf &amp; Ruhepuls“ erlaubst (App ab 1.3), liest die App Tageswerte zu
          Eiweiß und Kalorien, Schlafdauer und Ruhepuls. Eiweiß und Kalorien werden wie selbst eingetragen in deinem Konto
          gespeichert; Schlaf und Ruhepuls bleiben nur auf deinem Gerät und dienen dem Erholungshinweis.
        </li>
        <li>
          Nur wenn du „Trainings speichern“ einschaltest, schreibt die App deine Trainings in Health Connect: Start, Ende,
          Name des Trainingstags, je Satz die Übung und die Wiederholungen sowie geschätzte aktive Kalorien (aus Dauer,
          Körpergewicht und Intensität). Andere Apps, denen du in Health Connect Zugriff gibst, können diese Trainings
          sehen.
        </li>
        <li>
          Zweck: Die Werte erscheinen in deinen Körpermaßen und in den Fortschrittsdiagrammen (pro Tag die letzte
          Messung). Sie werden wie selbst eingetragene Maße in deinem Konto gespeichert, damit sie auf allen deinen
          Geräten verfügbar sind.
        </li>
        <li>Die Daten werden nicht an Dritte weitergegeben und nicht für Werbung oder Analysen genutzt.</li>
        <li>
          Widerruf: in der App unter Fortschritt → Körper → „Abgleich beenden“ bzw. „Speichern beenden“ und in den
          Health-Connect-Einstellungen deines Telefons. Übernommene Messungen kannst du in der App einzeln löschen,
          gespeicherte Trainings in Health Connect.
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

      <h2>Fehlerberichte</h2>
      <p>
        Fehler der App werden nur auf deinem Gerät mitgeschrieben. An den Betreiber gehen sie ausschließlich, wenn du im
        Profil „Fehlerbericht senden“ tippst – mit den letzten Fehlermeldungen, dem Sync-Status, App-Version und
        Browser-Kennung, ohne Trainingsdaten.
      </p>

      <h2>Export und Löschen</h2>
      <p>
        Unter Profil → „Konto &amp; Daten“ kannst du alle Daten exportieren (JSON, Sätze als CSV) und dein Konto selbst
        löschen. Dabei werden alle Daten auf dem Server – einschließlich der Fortschrittsfotos – und auf dem Gerät
        endgültig entfernt. Einzelne Trainings, Körpermaße und Fotos lassen sich jederzeit in der App löschen. Beim
        Abmelden werden alle Daten des Kontos vom Gerät entfernt.
      </p>
    </main>
  );
}
