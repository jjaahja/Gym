# Wochenplan, Kalender, Übungstausch & Videos

## Wochentage

- **Onboarding:** Nach „Tage pro Woche“ werden die Wochentage gewählt. Vorschlag: möglichst gleichmäßig verteilt
  (3 Tage → Mo/Mi/Fr, 4 Tage → Mo/Di/Do/Fr), damit jeder Muskel etwa 48 h Pause bekommt. „Weiter“ erst bei der
  richtigen Anzahl. Die Vorschau zeigt jeden Tag mit Wochentag.
- **Erholungshinweis** (`recoveryWarnings`): Liegen zwei Tage mit überwiegend denselben Hauptmuskeln (≥ 3) direkt
  hintereinander (auch So → Mo), erscheint ein Hinweis – z. B. Ganzkörper an Mo/Di/Mi, nicht aber Ober-/Unterkörper
  an Mo/Di/Do/Fr.
- **Ändern:** Plan-Übersicht → „Wochentage ändern“. Die Reihenfolge der Tage bleibt, nur die Wochentage ändern sich.
- **Speicherung:** `plan_days.weekday` (ISO 1–7), synchronisiert in beide Richtungen; ältere Pläne ohne Wochentage
  werden migriert und bitten in der Übersicht um die Auswahl.

## Plan-Übersicht (neu)

| Bereich | Inhalt |
|---|---|
| Wochenleiste | Mo–So mit Status: ✓ erledigt, Ring = geplant, gestrichelt = verpasst, leer = Ruhetag; heute markiert. Antippen wählt den Tag. |
| Tageskarte | **Heute:** Trainingsname, Dauer, Hauptmuskeln, Übungsvorschau, „Training starten“. **Verpasst** (diese Woche, nicht nachgeholt): „Jetzt nachholen“. **Ruhetag:** nächstes Training, optional „trotzdem trainieren“. **Erledigt:** Minuten, Sätze, Übungen. Standard ist heute, an Ruhetagen ein verpasstes Training der Woche. |
| Mesozyklus | Fortschritt in Wochen und Datum der Auswertung |
| Trainingstage | je Tag Wochentag, Dauer, Hauptmuskeln; aufklappbar mit allen Übungen |
| Diese Woche | erledigte von geplanten Trainings; aufklappbar: harte Sätze je Muskel |

## Kalender (`/calendar`)

- Monatsansicht (Mo–So): erledigte, geplante und verpasste Trainings, Deload-Woche hinterlegt, grüner Punkt am Tag
  der Mesozyklus-Auswertung. Ein verpasster Tag gilt als nachgeholt, wenn derselbe Trainingstag in derselben Woche
  erledigt wurde.
- Tagesdetails: erledigtes Training (Dauer, Sätze, Übungen) bzw. geplanter Tag mit Start/Nachholen.
- **Export in den Handy-Kalender** (`buildIcs`, RFC 5545): je Trainingstag ein wöchentlich wiederkehrender Termin
  zur gewählten Uhrzeit, mit Übungen in der Beschreibung, Link zur App und Erinnerung (keine/15/30/60 min).
  Funktioniert mit Apple Kalender, Google Kalender und Outlook – ohne Konto-Verknüpfung.

### Kalender-Abo (aktualisiert sich selbst)

- **Kalender → „Abonnieren – bleibt automatisch aktuell“:** erzeugt einen persönlichen, geheimen Link
  (`webcal://…/api/calendar/<token>.ics`, 256 Bit Zufall). Buttons für Apple Kalender (webcal) und Google Kalender,
  „Link kopieren“ für Outlook u. a. Uhrzeit und Erinnerung einstellbar; „Neuen Link erzeugen“ macht den alten
  ungültig; „Abo beenden“ löscht ihn.
- **Inhalt:** Trainingstermine je Wochentag (ab Planbeginn, mit Übungen), Deload-Woche und Mesozyklus-Auswertung als
  ganztägige Termine. Änderungen am Plan (Wochentage, Tausch, Deload) erscheinen beim nächsten Abruf: Apple Kalender
  im eingestellten Intervall, Google Kalender nach eigenem Zeitplan (oft einige Stunden).
- **Sicherheit:** Kalender-Apps senden keine Anmeldung. Die Route ist deshalb öffentlich, die Datenbankfunktion
  `calendar_feed(token)` (SECURITY DEFINER) gibt nur für einen gültigen Token den Trainingsplan dieses Nutzers heraus –
  nichts sonst. Tokens sind per Row Level Security nur für den Besitzer lesbar. Geprüft gegen Postgres (ungültige und
  unbekannte Tokens → nichts, ohne Anmeldung keine Tokens und keine Pläne sichtbar) und live gegen Supabase
  (Anlegen, Abruf, Uhrzeit ändern, Link erneuern → alter Link 404, Beenden → 404).

## Zuverlässiges Speichern

Beim Live-Test fiel auf: Wurde die App direkt nach „Plan übernehmen“ neu geladen, kam nur ein Teil der ~60 Zeilen in
die Warteschlange (einzeln geschrieben, der Rest ging beim Neuladen verloren). Behoben:

- Alle Einträge einer Aktion werden gesammelt und in **einer** IndexedDB-Transaktion geschrieben (`enqueueMany`) –
  schnell und alles oder nichts.
- **Selbstreparatur:** Kennt der Server den Plan eines Geräts nicht, lädt der Abgleich ihn vollständig erneut hoch
  (`republish`, inkl. Anpassungsprotokoll) – und stellt ihn **vor** alle wartenden Einträge (`prependMany`), auch
  während eines Trainings. Veraltete wartende Einträge derselben Zeilen fallen dabei weg.

  *Fehler aus dem Live-Betrieb (11.11.):* „new row violates row-level security policy for table workout_sessions“.
  Ein Plan aus der Zeit vor der Bündelung war nur zum Teil angekommen (Fragebogen und Ausstattung ja, Plan nein).
  Die Zugriffsregel für Trainings verlangt einen eigenen Plan, also scheiterte jedes Training – und weil die Outbox
  strikt in Reihenfolge überträgt und die Reparatur nur lief, wenn nichts mehr ausstand, hing der Abgleich dauerhaft.
  Nachgestellt gegen Postgres mit den echten Zugriffsregeln (`scripts/verify-plan-repair.ts`): ohne Reparatur genau
  dieser Fehler, mit Reparatur kommen Plan, Training, Übungen und Sätze an.

## Übung im Training tauschen

- Jede Planübung hat im Tracker „Übung tauschen“. Vorschläge (`rankAlternatives`), beste zuerst:
  - Pflicht: mindestens ein gemeinsamer **Primärmuskel**, mit der Ausstattung und Erfahrung machbar, nicht schon im
    heutigen Training.
  - Bewertung: Überlappung der Zielmuskeln (Jaccard), gleiches Bewegungsmuster, gleiche Mechanik, Dehnungsfokus
    (Muskelaufbau), mitbeanspruchte Muskeln, persönlicher Pump (+) und Gelenkbeschwerden (−), ähnliche Ermüdung.
  - Jede Alternative mit Begründung („Gleiche Zielmuskeln: … · gleiche Bewegung · Dehnungsfokus“) und Muskel-Chips.
- **Nur heute:** Die Ersatzübung bekommt ihre eigene Vorgabe aus den Richtwerten (Wiederholungen, RIR, Pause), die
  Satzzahl bleibt. Die Planübung wird danach nicht gesteigert oder gesenkt (anderer Reiz, kein Vergleich).
- **Dauerhaft im Plan:** wie ein angenommener Wechselvorschlag – im Protokoll (`user_request`) und rückgängig machbar.
- Tausch nur, solange für die Übung noch kein Satz eingetragen ist (sonst würden Sätze verschiedener Übungen
  vermischt).

## Ausführungsvideos

- Für alle 65 Übungen ein Technikvideo (`src/data/catalog/videos.ts`), überwiegend kurze „How to“-Anleitungen
  etablierter Kanäle (u. a. ScottHermanFitness, Jeff Nippard, Renaissance Periodization, Squat University).
- **Geprüft:** Jede ID per YouTube-oEmbed – existiert, ist einbettbar, Titel passt zur Übung. Zwölf automatische
  Treffer wurden von Hand ersetzt (z. B. Schrägbank statt Flachbank, Kurzhantel statt Maschine).
- **Datenschutz:** Zwei-Klick-Lösung über `youtube-nocookie.com`. Vor dem Tippen wird nichts von YouTube geladen,
  auch kein Vorschaubild; die Zustimmung lässt sich pro Gerät merken.
- Zu sehen auf der Übungsseite und im Tracker („Ausführung“, mit den wichtigsten Hinweisen).
- `exercises.video_url` im Seed; ein Test stellt sicher, dass jede Übung ein gültiges Video hat.

## Machbarkeit: Kalender, Withings, Apple Health, Google Fit

| Anbindung | Machbar? | Aufwand | Voraussetzungen |
|---|---|---|---|
| **Kalender – Export** | ✅ umgesetzt | – | – |
| **Kalender – Abo** (aktualisiert sich selbst) | ✅ umgesetzt | klein | keine neuen Konten. Persönlicher, geheimer Abo-Link (`webcal://…`), den die App aus dem Plan erzeugt. Apple Kalender: Aktualisierungsintervall einstellbar; Google Kalender aktualisiert Abos selbst, laut Erfahrungsberichten etwa alle 12–24 h, nicht einstellbar. |
| **Withings** (Waage) | ✅ ja | mittel | kostenlose Withings-Entwickler-App (Client-ID/Secret). OAuth 2.0, Daten über `getmeas` (Gewicht, Fettanteil, Fett-/Magermasse). Access-Token ca. 3 h, Refresh-Token ca. 12 Monate gültig → Server speichert Tokens und holt neue Messungen (auch per Withings-Benachrichtigung). Ergebnis: Körpermaße füllen sich automatisch. |
| **Apple Health** | ⚠️ nur mit nativer App | groß | HealthKit hat keine Web-Schnittstelle; eine Web-App/PWA kann es nicht lesen. Nötig: App-Hülle (z. B. Capacitor mit HealthKit-Plugin), Apple-Entwicklerprogramm (kostenpflichtig), Mac mit Xcode, Verteilung über TestFlight/App Store. Behelfe: Withings überträgt Waagendaten ohnehin auch an Apple Health – über die Withings-Anbindung kommen sie also auch zu uns; oder ein iOS-Kurzbefehl, der Werte aus Health per HTTPS an einen persönlichen App-Link schickt. |
| **Google Fit** | ❌ nicht sinnvoll | – | Google Fit-APIs nehmen seit Mai 2024 keine neuen Entwickler an und werden 2026 abgeschaltet. Nachfolger: **Health Connect** (nur auf dem Android-Gerät, braucht wie Apple Health eine native App) und die **Google Health API** (Cloud, Google-OAuth; Nachfolger der Fitbit-Schnittstelle, für Fitbit-/Google-Geräte). |
| **Health Connect** (Android) | ✅ umgesetzt | mittel | Android-App als Hülle (Capacitor) mit Health-Connect-Plugin; liest Gewicht und Körperfett, die z. B. die Withings-App dorthin schreibt – ohne Withings-Entwicklerkonto. Siehe [09](09-health-connect-android.md). |

**Umgesetzt:** das Kalender-Abo (siehe oben) und – statt der Withings-Schnittstelle – **Health Connect** über eine
Android-App ([09](09-health-connect-android.md)): Die Withings-App schreibt Waagendaten ohnehin nach Health Connect,
so kommen sie ohne eigenes Withings-Entwicklerkonto und ohne Server-Tokens in die Körpermaße. Für iPhone bliebe die
Withings-Schnittstelle (oder HealthKit mit nativer iOS-App).

Quellen (abgerufen am 06.11.2026):
[Google Fit Migration FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq),
[Google Fit](https://developers.google.com/fit),
[Google Health API – Datenzugriff](https://developers.google.com/health/migration/data-access),
[Google Health Newsletter](https://developers.google.com/health/newsletters),
[Withings API-Referenz](https://developer.withings.com/llms.md),
[Capacitor Health & Fitness](https://capacitorjs.com/docs/apis/health-fitness),
[capacitor-healthkit](https://www.github.com/perfood/capacitor-healthkit),
[Google-Kalender-Abo: Aktualisierung](https://usecarly.com/blog/google-calendar-ics-refresh-rate/),
[Abo-Kalender aktualisieren nicht sofort](https://nocal.app/help/ics-and-subscriptions/why-subscribed-calendars-dont-update-instantly).

## Verifiziert

- 258 Unit-Tests, u. a. Wochentage/Kalender (Status, Nachholen, Deload, Auswertung, Monatsraster), .ics-Export
  (Maskierung, Zeilenfaltung, Wiederholung, Erinnerung), Alternativen (Muskeln, Ausstattung, Erfahrung, Feedback),
  Tausch nur heute/dauerhaft inkl. Rückgängig, Videos im Katalog, Server-Abgleich mit Wochentagen.
- Browser (iPhone 13, hell/dunkel): Onboarding mit Wochentagen, Woche mit erledigten/verpassten Tagen, Nachholen,
  Ruhetag, Wochentage-Dialog, Kalender inkl. Export-Datei, Video erst nach Tippen (youtube-nocookie), Tausch mit
  Vorschlägen, Sperre nach eingetragenem Satz; kein horizontales Scrollen, keine Konsolenfehler.
- Supabase: Katalog mit 65 Video-Links aktualisiert.
