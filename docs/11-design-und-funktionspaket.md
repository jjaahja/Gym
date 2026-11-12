# Apple-Design und Funktionspaket

## Design im Stil von iOS (`src/app/globals.css`, `src/components/ui.tsx`)

- **Flächen und Farben** wie die iOS-Systemfarben: gruppierter Hintergrund (hell `#F2F2F7`, dunkel `#000`), Karten
  ohne Rahmen mit leichtem Schatten, Trennlinien eingerückt, Label-Grau `#6E6E73` / `#98989F`.
- **Bausteine:** großer Titel (34 pt), gruppierte Listen (`List`, `ListRow`), Segmented Control mit heller „Kapsel“,
  iOS-Schalter (`Toggle`), Stepper (− Wert +), Sheets mit Griff, zentriertem Titel und „Fertig“, Tab-Leiste mit
  Unschärfe. Mehr als vier Optionen → Liste mit Häkchen statt Segmented Control.
- **Schrift:** auf Apple-Geräten die Systemschrift (SF Pro), sonst Inter.
- **Farbthemen** (Profil → Darstellung): Orange, Blau, Grün, Pink, Lila, Türkis; Erscheinungsbild System/Hell/Dunkel.
  Jede Akzentfarbe erfüllt WCAG 4,5:1 (hell mit weißer, dunkel mit schwarzer Schrift). Ein kleines Skript im `<head>`
  setzt Thema und Farbe vor dem ersten Zeichnen – kein Aufblitzen.

## Training

- **Schnell eintragen:** „↻ Wiederholen“ (letzten Satz noch einmal) und „+1 Wdh.“ (eine mehr, ein RIR weniger).
- **Bildschirm bleibt an** während des Trainings (Android: `FLAG_KEEP_SCREEN_ON`, Browser: Wake Lock).
- **Pausen-Benachrichtigung:** Ende der Satzpause als lokale Benachrichtigung – auch bei gesperrtem Bildschirm.
- **Notiz je Übung** (z. B. „Sitzhöhe 4“), im Training und auf der Übungsseite; synchronisiert (`exercise_notes`).
- **Aufwärmsätze:** Vorschlag aus dem Arbeitsgewicht (Grundübungen: Stange × 10, 50 % × 8, 70 % × 4, 85 % × 2;
  Isolation: 50 % × 10); Antippen trägt den Aufwärmsatz ein. **Scheibenrechner:** „Pro Seite: 20 + 5 · Stange 20 kg“.
- **Reihenfolge & Supersätze** (nur heute): verschieben, Übungen verbinden; Pause erst nach der letzten Übung der
  Gruppe, die App springt automatisch zur nächsten.

## Abgeschlossene Trainings, Rekorde, Übungsverlauf

- **Bearbeiten** (Kalender → „Bearbeiten“, `/training/[id]`): Sätze ändern oder löschen, Anstrengung (RPE) ändern,
  Training löschen. Fortschritt und Gewichtsvorschläge nutzen sofort die korrigierten Werte; bereits angewendete
  Plananpassungen werden nicht neu berechnet.
- **Rekorde:** bestes geschätztes 1RM (RIR-korrigiert) und schwerster Satz – als Kennzeichen am Satz und in der
  Zusammenfassung („Bankdrücken: geschätztes 1RM 87,5 kg (vorher 84)“). Erst ab dem zweiten Training einer Übung.
- **Übungsseite:** Verlauf mit 1RM-Kurve (bester Satz je Training), Bestwerten und den letzten Trainings.

## Plan selbst bearbeiten (`/plan/[dayId]`, `src/lib/training/plan-edit.ts`)

Plan → Trainingstag aufklappen → „Bearbeiten“.

- **Vorgabe je Übung:** Sätze (1–10), Wiederholungsbereich, RIR-Bereich (0–5), Pause (15 s – 10 min) und Technik im
  letzten Satz (Myo-Reps, Dropsatz, Rest-Pause, Teilwiederholungen in Dehnung) mit Kurzanleitung. Bei schweren
  Grundübungen rät die App von Intensitätstechniken ab. Mehr oder weniger Sätze zeigen sofort das neue Wochenvolumen
  der Zielmuskeln mit Richtwert.
- **Übung hinzufügen** (mit Ausstattung machbar, schon vorhandene ausgeblendet; Empfehlungen für Muskeln unter dem
  Richtwert), **tauschen** (passende Alternativen, dauerhaft), **entfernen** (mit Volumen-Warnung).
- **Reihenfolge & Supersätze im Plan** (`plan_exercises.superset_group`): gelten für jedes Training dieses Tages; im
  Training lassen sie sich für einen Tag ändern.
- **Protokoll:** Hinzufügen und Vorgabe ändern landen unter „Anpassungen“ und sind rückgängig machbar
  (`adaptation_type` `add_exercise`, `edit_exercise`; Migration `20261112000001_plan_editing.sql`). Umsortieren
  wird nicht protokolliert – es ist jederzeit direkt änderbar.
- **Positionen ohne Konflikt:** Der Server verlangt (Tag, Position) eindeutig und prüft Zeile für Zeile. Beim
  Umsortieren vergibt die App deshalb Positionen, die keine bisherige belegt (abwechselnd ab 0 bzw. hinter dem
  Maximum) – so klappt die Übertragung einzeln wie gebündelt. Geprüft mit `scripts/verify-plan-edit.ts` gegen
  Postgres (inkl. Gegenprobe: mit Positionen 0…n scheitert derselbe Ablauf an `plan_exercises_plan_day_id_order_index_key`).

## Fortschrittsfotos (`/progress/photos`, `src/lib/photos.ts`)

Fortschritt → Körper → „Fortschrittsfotos“.

- **Aufnehmen:** Pose wählen (vorne, Seite, hinten), Hilfslinien für Kopf und Füße (gleicher Abstand), das letzte Foto
  derselben Pose halbtransparent als **Vorlage**, **Selbstauslöser** (3 oder 10 s) zum Abstellen des Handys. Hochformat
  3:4 wie in der Vorschau, Frontkamera gespiegelt wie ein Spiegel. Ohne Kamera(-Freigabe) oder für ältere Fotos:
  „Galerie“, Datum anpassbar.
- **Vergleich:** ältestes und neuestes Foto der Pose mit Schieberegler (links vorher, rechts nachher), beide frei
  wählbar, Zeitspanne und – wenn am selben Tag (± 3 Tage) gemessen – das Körpergewicht.
- **Speicher:** verkleinert auf höchstens 1600 px (JPEG, meist < 500 KB), lokal in IndexedDB. Mit Konto über die
  Outbox in den privaten Bucket `progress-photos` (Ordner `<user_id>/`, Zugriffsregeln nur für den Besitzer) und als
  Zeile in `progress_photos`. Reihenfolge: erst die Datei (Pseudo-Tabelle `photo_files`), dann die Zeile – andere
  Geräte sehen nie eine Zeile ohne Datei; beim Löschen umgekehrt. Andere Geräte laden die Datei erst beim Anzeigen.
- **Android:** Kamera-Berechtigung (`CAMERA`, ab APK 1.3); Capacitor reicht die Anfrage der Web-Ansicht weiter.

## Wissenschaft im Alltag

- **Myo-Reps & Co. geführt** (`src/lib/training/rir-calibration.ts`, `plan-edit.ts`): Nach dem letzten Arbeitssatz
  springt die Übung zum Technik-Satz – mit Kurzanleitung, kurzer Pause (Myo-Reps 15 s, Rest-Pause 20 s, Dropsatz 10 s)
  und passendem Gewicht (gleich; beim Dropsatz −25 %). Myo-Reps: Mini-Sätze à 3–5 Wdh., bis die Wiederholungen unter 3
  fallen oder nach 5 Mini-Sätzen.
- **RIR-Check:** Im letzten Satz einer Maschinen-, Kabel- oder Isolationsübung (keine Langhantel, keine hohe
  Gesamtermüdung): erst schätzen, dann bis zum Versagen. Tatsächlicher RIR = Wdh. bis Versagen − Wdh. beim Stopp.
  Ab 3 Tests rechnen die Gewichtsvorschläge mit der persönlichen Abweichung (Mittel der letzten 10, gerundet auf 0,5,
  begrenzt auf −1 … +2; RIR 0 bleibt 0). Tabelle `rir_calibrations` (Migration `20261112000002`). Beleg: Im Mittel
  unterschätzen Trainierende die Wiederholungen bis zum Versagen um ~0,95 (Halperin et al. 2022, DOI
  10.1007/s40279-021-01559-x).
- **Eiweiß:** Tageskarte im Plan, Ziel 1,6–2,2 g je kg (Morton et al. 2018, DOI 10.1136/bjsports-2017-097608) aus dem
  letzten Körpergewicht, Schnelleintrag (+10/20/30 g), Wochenschnitt. Mit App 1.3 aus Health Connect (z. B. aus einer
  Ernährungs-App); eigene Einträge haben Vorrang.
- **Erholung:** Mit App 1.3 Schlaf und Ruhepuls aus Health Connect (Tageswerte, bleiben auf dem Gerät). Hinweis bei
  < 6 h Schlaf bzw. 90 min unter dem eigenen Schnitt (Median 14 Nächte) und bei Ruhepuls ≥ 5 Schläge über dem Schnitt
  (14 Tage). Schlafmangel senkt die Leistung im Mittel um 7,6 %, vor allem abends (Craven et al. 2022, DOI
  10.1007/s40279-022-01706-y). Der Ruhepuls ist ein Erfahrungswert – die App formuliert es als Hinweis, nicht als Regel.
- **Android:** `GymHealth` liest per `aggregateGroupByPeriod` (Schlaf von Mittag bis Mittag, damit eine Nacht nicht
  auf zwei Tage fällt); Berechtigungen `READ_NUTRITION`, `READ_SLEEP`, `READ_RESTING_HEART_RATE` ab APK 1.3.

## Motivation (`src/lib/motivation.ts`, `src/lib/reminders.ts`)

- **Wochenziel & Serie:** Ring in „Diese Woche“ (Trainings dieser Woche / Ziel). Ziel = Trainingstage im Plan oder
  eigener Wert (Ring antippen). Die Serie zählt Wochen in Folge mit erreichtem Ziel; die laufende Woche zählt, sobald
  das Ziel erreicht ist, und beendet die Serie nicht vor Sonntag. Daneben die beste Serie.
- **Monatsrückblick** (Fortschritt → „Rückblick“, in der ersten Woche eines Monats auch im Plan): Trainings, Zeit,
  harte Sätze und bewegte Last mit Vergleich zum Vormonat, neue Bestwerte (geschätztes 1RM gegenüber allem davor –
  auch innerhalb des Monats; das allererste Training ist nur Ausgangswert), meisttrainierte Muskeln, Körpergewicht
  und Eiweiß im Schnitt.
- **Erinnerungen** (Profil, Android-App): lokale Benachrichtigung an jedem Trainingstag des Plans zur gewählten
  Uhrzeit; wird bei Änderungen an Uhrzeit, Schalter oder Wochentagen automatisch neu geplant.

## Zuverlässigkeit & Konto

- **Hängende Synchronisierung sichtbar** (`src/lib/sync-health.ts`): Banner, sobald der vorderste Outbox-Eintrag 3-mal
  scheiterte oder online seit 6 Stunden nichts übertragen wurde. Im Profil: welche Daten hängen, Fehlermeldung,
  „Erneut versuchen“, Fehlerbericht senden und – nur bei dauerhaften Fehlern (Regelverstoß, ungültige Daten) und mit
  Bestätigung – „Hängende Änderung verwerfen“, damit alles dahinter wieder fließt. Netzfehler gelten nie als dauerhaft.
- **Fehlerberichte** (`src/lib/error-log.ts`): Fehler werden lokal mitgeschrieben (höchstens 30); gesendet wird nur auf
  Knopfdruck in `client_errors` (insert-only, ≤ 8 KB, ohne Trainingsdaten).
- **Konto & Daten** (Profil): E-Mail, Passwort ändern (`/settings/password`), „Passwort vergessen?“ im Login (Link über
  `/auth/callback?next=/settings/password`; die erlaubten Weiterleitungen `https://gym-alpha-flax.vercel.app/**` decken
  das ab), Export als JSON (alles außer Bilddateien) und CSV (alle Sätze, deutsches Format), Konto löschen
  (Fotos im Speicher, dann `delete_my_account()` – alle Tabellen kaskadieren – dann lokal alles entfernen).
- **Abmelden** entfernt jetzt alle Daten des Kontos vom Gerät (auch Notizen, Ernährung, Fotos, RIR-Checks,
  Health-Connect-Status, Erinnerungen).
- **Dateien in der Android-App** (ab 1.3): Export und „Foto speichern“ laufen über das Teilen-Menü (`GymDevice.shareFile`,
  FileProvider) – Web-Downloads funktionieren in der App-Ansicht nicht.
- **APK-Bereitstellung:** Die App lädt Updates von der eigenen Domain (`/downloads/version.json`, SHA-256 geprüft);
  GitHub (raw) bleibt nur der Weg für die alte Version 1.1. GitHub-Releases lassen sich mit den hier verfügbaren
  Werkzeugen nicht anlegen – nicht nötig, solange Vercel die Datei ausliefert.
