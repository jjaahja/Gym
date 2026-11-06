# Health Connect & Android-App

Gewicht und Körperfett kommen automatisch aus **Health Connect** in die Körpermaße – z. B. von der Withings-Waage
(Withings-App → Health Connect), Samsung Health, Garmin, Fitbit oder jeder anderen App, die dorthin schreibt.
Health Connect gibt es nur auf dem Android-Gerät, ohne Web-Schnittstelle. Deshalb gibt es die App zusätzlich als
Android-App.

## Android-App (Capacitor)

- **Hülle um die Web-App:** Die App lädt die veröffentlichte Version (`server.url` →
  `https://gym-alpha-flax.vercel.app`). Updates der App kommen also wie bisher ohne neue APK; eine neue APK ist nur
  nötig, wenn sich am nativen Teil etwas ändert.
- **Nativer Teil:** nur das Health-Connect-Plugin (`@capgo/capacitor-health`). Capacitor spielt die Brücke beim Laden
  der Seite ein (`window.Capacitor`); die Web-App erkennt daran die Android-App (`isAndroidApp`).
- **Berechtigungen** (`android/app/src/main/AndroidManifest.xml`): Internet, `READ_WEIGHT`, `READ_BODY_FAT` und
  `READ_HEALTH_DATA_HISTORY` (Messungen älter als 30 Tage beim ersten Abgleich). Das Plugin deklariert alle 45
  Datentypen (Schritte, Puls, Schlaf …, auch Schreibrechte) – die werden per `tools:node="remove"` entfernt, die APK
  fragt nur nach dem, was sie braucht.
- **Datenschutzerklärung:** `/datenschutz` (öffentlich, auch in den Einstellungen verlinkt). Health Connect zeigt sie
  unter „Datennutzung“ der App (`health_connect_privacy_policy_url`).
- **Ohne Netz beim ersten Start:** eigene Fehlerseite (`capacitor/www/offline.html`) mit „Erneut versuchen“. Danach
  übernimmt wie im Browser der Service Worker (Training funktioniert offline).
- Paket `de.jjaahja.gym`, minSdk 26 (Android 8), targetSdk 36, App-Icon und Startbild aus dem PWA-Icon.

### Bauen

```bash
npx cap sync android
cd android && ./gradlew assembleRelease   # braucht Android SDK (Plattform 36) und JDK 21
```

Signiert wird mit `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) – Schlüssel
und Datei liegen **nicht** im Repository. Ohne die Datei entsteht eine unsignierte APK. Eine Update-APK muss mit
demselben Schlüssel signiert sein; mit einem neuen Schlüssel die App einmal deinstallieren und neu installieren (die
Daten liegen im Konto und kommen beim Anmelden zurück).

### Installieren

1. APK aufs Handy laden und öffnen; einmalig „Installation aus dieser Quelle zulassen“ erlauben.
2. Anmelden wie im Browser (E-Mail und Passwort).
3. Fortschritt → Körper → **„Mit Health Connect verbinden“** → Gewicht und Körperfett erlauben.
4. In der Withings-App: Profil → Einstellungen → Health Connect → Gewicht/Körperzusammensetzung freigeben.
   (Bis Android 13 ist Health Connect eine eigene App aus dem Play Store; die Karte verlinkt sie.)

## Abgleich

| Regel | Umsetzung (`src/lib/health/health-connect.ts`) |
|---|---|
| Welche Daten | nur Gewicht (kg) und Körperfettanteil (%) |
| Zeitraum | erster Abgleich 90 Tage, danach ab dem letzten Abgleich mit 2 Tagen Überlappung (spät eingetragene Messungen) |
| Pro Tag | die letzte Messung des Tages (lokale Zeit) |
| Plausibilität | Gewicht 20–400 kg, Körperfett 2–70 % (wie die Datenbank); ein Anteil 0–1 wird in Prozent umgerechnet |
| Zusammenführen | nur Gewicht und Körperfett werden gesetzt; Taille, Arm, Schultern … und Notizen bleiben unverändert |
| Speichern | wie eine eigene Messung (`saveMeasurement`) → lokal + Outbox → Server, also auch auf allen anderen Geräten |
| Keine Änderung | kein Schreiben, keine Outbox-Einträge |
| Wann | beim Verbinden, beim Öffnen der App und bei Rückkehr in die App – höchstens stündlich – sowie „Jetzt abgleichen“ |
| Reihenfolge | automatisch erst nach dem ersten erfolgreichen Server-Abgleich: Ein frisch angemeldetes Gerät kennt sonst die Taillen-/Arm-Werte eines Tages noch nicht und würde sie beim Hochladen leeren |
| Abmelden | setzt den Abgleich zurück (anderes Konto beginnt wieder mit 90 Tagen) |

**Karte im Körper-Tab** (nur in der Android-App): Verbinden, Status („Verbunden · abgeglichen vor 5 Min.“), Ergebnis
(„3 Tage übernommen“ / „alles aktuell“), „Jetzt abgleichen“, „Berechtigungen“ (Health-Connect-Einstellungen),
„Abgleich beenden“. Abgelehnte Berechtigung → Hinweis und „Health Connect öffnen“; fehlendes/veraltetes Health Connect
→ Link zum Play Store.

## Verifiziert

- Unit-Tests: Tageswerte (letzte Messung, Rundung, Plausibilität, Anteil → Prozent), Zusammenführen (andere Maße und
  Notizen bleiben, nur Körperfett geliefert → Gewicht bleibt), Import (neue und bestehende Tage, Outbox nur bei
  Änderungen), stündliche Drosselung, Plugin-Aufrufe über den Capacitor-Proxy.
- **Gefundener Fehler:** Ein Capacitor-Plugin ist ein Proxy, der auch auf `then` antwortet. Aus einer async-Funktion
  zurückgegeben, bricht der Aufruf („Health.then() is not implemented on android“). Behoben (Plugin in ein Objekt
  verpackt) und mit einem Test abgesichert, der mit dem alten Code fehlschlägt.
- Browser (Pixel 7, hell/dunkel) mit simulierter Android-Brücke, 23 Prüfungen: keine Karte im normalen Browser,
  Verbinden fragt nur Gewicht/Körperfett mit Verlauf an, 90 Tage abgefragt, 3 Tage übernommen (letzte Messung des
  Tages, Taille bleibt), zweiter Abgleich „alles aktuell“ und nur 2 Tage, Verbindung bleibt nach Neuladen,
  Einstellungen öffnen, Beenden behält Messungen, Ablehnung liest nichts, Play-Store-Link, Datenschutzseite
  öffentlich und verlinkt; kein horizontales Scrollen, keine Konsolenfehler.
- APK: Signatur (APK Signature Scheme v2) geprüft, Manifest enthält nur die vier Berechtigungen oben, die
  Health-Connect-Einträge (Berechtigungsbegründung, Android-14-Datennutzung) und die Datenschutz-URL.
- Nicht getestet: echtes Gerät mit Health Connect (kein Android-Emulator in der Build-Umgebung).
