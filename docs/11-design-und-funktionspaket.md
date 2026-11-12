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
