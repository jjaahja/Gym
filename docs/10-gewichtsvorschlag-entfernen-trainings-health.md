# Gewichtsvorschlag, Übung entfernen, Trainings in Health Connect

## Gewichtsvorschlag aus der bisherigen Leistung (`src/lib/training/load-suggestion.ts`)

Aus Gewicht, Wiederholungen und Wiederholungen im Tank (RIR) schätzt die App, wie viele Wiederholungen bis zum
Muskelversagen möglich wären (RIR-korrigiertes Epley, wie `set_logs.e1rm_kg`: 1RM = Gewicht × (1 + (Wdh. + RIR)/30)),
und rechnet daraus das Gewicht für das Ziel des nächsten Satzes.

| Einstellung (Profil → „Gewichtsvorschlag im Training“) | frühe Sätze | letzter Satz |
|---|---|---|
| **Versagen im letzten Satz** (Standard) | 1–2 im Tank | bis zum Versagen; schwere Grundübungen (Langhantel oder hohe Ermüdung, z. B. Kniebeuge, Kreuzheben, Bankdrücken) 1 im Tank |
| **Plan-Ziel** | RIR-Bereich des Plans | RIR-Bereich des Plans |

- **Grundlage:** vor dem ersten Satz der beste Satz vom letzten Mal, danach der jeweils letzte Satz von heute (enthält
  die Ermüdung der Einheit). Startgewicht ist das Zielgewicht des Plans (doppelte Progression) bzw. das letzte Gewicht.
- **Regel:** Landet das bisherige Gewicht beim Ziel-RIR im Wiederholungsbereich, bleibt es. Sonst wird das Gewicht für
  die Mitte des Bereichs berechnet und auf die kleinste Steigerung der Übung gerundet (z. B. 2,5 kg Langhantel, 2 kg
  Kurzhantel).
- **Anzeige:** über den Eingabefeldern „Ziel: 1–2 im Tank · ca. 11 Wdh. mit 60 kg“ bzw. „Letzter Satz: bis zum
  Versagen“; nach dem ersten Satz die Begründung („Letzter Satz: 60 kg × 11 (2 im Tank) → …“). Das Gewicht ist
  vorausgefüllt, die erwarteten Wiederholungen stehen als Platzhalter im Feld.
- **Nicht** in der Deload-Woche (Gewichte bleiben) und nicht bei Körpergewichtsübungen mit Zusatzlast oder Zeitübungen –
  dort gilt der bisherige Vorschlag.
- **Wissenschaft:** Für Muskelaufbau steigt der Effekt, je näher Sätze am Versagen enden (Robinson et al. 2024);
  Versagen in jedem Satz bringt bei gleichem Volumen kaum Zusatznutzen, aber deutlich mehr Ermüdung (Refalo et al.
  2023). Daher Versagen nur im letzten Satz.

## Gewichtsfeld

Das Feld zwischen − und + ist als Eingabefeld erkennbar (gestrichelter Rahmen, Stift-Symbol). Antippen markiert die
Zahl, man tippt direkt den neuen Wert (z. B. 62,5 oder 23,75) – unabhängig von der Schrittweite der Knöpfe.

## Übung im Training entfernen

- Jede Übung im Tracker hat „Entfernen“. Bereits eingetragene Sätze werden nach Bestätigung mitgelöscht (Server:
  `exercise_logs` löschen, `set_logs` folgen per Fremdschlüssel).
- **Nur heute:** Die Planübung wird für dieses Training ausgeblendet (`session.skipped`), der Plan bleibt.
- **Auch aus dem Plan:** Planübung wird gelöscht und im Anpassungsprotokoll festgehalten (neuer Typ
  `remove_exercise`, Migration `20261111000000_remove_exercise.sql`; `before_state` enthält Planübung und Trainingstag).
  „Rückgängig“ setzt sie an ihrer alten Position wieder ein.
- **Warnung:** Fällt ein Muskel der Übung danach unter den Wochen-Richtwert (z. B. Brust < 10 Sätze), zeigt der Dialog
  das vorher/nachher – mit dem Tipp, lieber zu tauschen.
- Spontan hinzugefügte Übungen: nur „Entfernen“.

## Trainings in Health Connect speichern (Android-App ab 1.1)

- Fortschritt → Körper → Health Connect → **„Trainings in Health Connect speichern“**: fragt die Berechtigungen
  „Training“ und „Aktive Kalorien“ an, trägt die Trainings der letzten 30 Tage nach und speichert danach jedes Training
  direkt nach dem Beenden (und beim Öffnen der App alles noch nicht Übertragene).
- **Inhalt je Training** (`src/lib/health/workout-export.ts`): Krafttraining (`EXERCISE_TYPE_STRENGTH_TRAINING`) mit
  Start, Ende, Name des Trainingstags und Notiz; je Satz ein Segment mit Übungstyp (z. B. Bankdrücken, Kniebeuge,
  Latzug; sonst „Gewichtheben“) und Wiederholungen. Gewichte kennt Health Connect für Sätze nicht.
  - Segmentzeiten: direkt nach dem Training aus den echten Satzzeiten (Satzende = Eintragen, Dauer ≈ 3,5 s je
    Wiederholung + 5 s); ältere Trainings ohne Satzzeiten gleichmäßig über die Einheit verteilt.
  - Lehnt Health Connect einen Segmenttyp ab, speichert das Plugin „anderes Training“, notfalls ohne Segmente.
- **Kalorien:** aktive Kalorien = (MET − 1) × Körpergewicht × Stunden; MET 3,5 („Resistance training, multiple
  exercises, 8–15 reps“, Code 02054), ab Session-RPE 8 MET 6,0 (Code 02050) – [2024 Adult Compendium of Physical
  Activities](https://pubmed.ncbi.nlm.nih.gov/38242596/), [Tabelle](https://pacompendium.com/conditioning-exercise).
  Körpergewicht: letzte Messung bis zum Trainingstag; ohne Gewicht keine Kalorien (Hinweis in der Karte). Grob, oft
  ±30–50 %.
- **Doppelt?** Nein: `clientRecordId` = `gym-session-<id>` – erneutes Senden aktualisiert in Health Connect.
- **Technik:** eigenes Capacitor-Plugin `GymHealth` (`android/app/src/main/java/de/jjaahja/gym/GymHealthPlugin.kt`,
  Kotlin, connect-client 1.1.0), weil `@capgo/capacitor-health` keine Trainings schreiben kann. Die App 1.0 hat es
  nicht – die Karte zeigt dann den Hinweis auf die neue Version.
- Neue Berechtigungen im Manifest: `WRITE_EXERCISE`, `WRITE_ACTIVE_CALORIES_BURNED`. APK 1.1 (versionCode 2) ist mit
  demselben Schlüssel signiert wie 1.0 und installiert sich als Update.

## Verifiziert

- Unit-Tests: Gewichtsvorschlag (Beibehalten im Bereich, schwerer/leichter, letzter Satz Versagen bzw. 1 im Tank,
  Plan-Ziel, Startgewicht aus doppelter Progression, Rundung), Entfernen (nur heute inkl. Outbox und freier Position,
  aus dem Plan mit Protokoll-Reihenfolge, Volumen und Rückgängig an alter Stelle, Warnung deterministisch),
  Health-Connect-Export (Segmenttypen für alle 66 Übungen, Kalorien, echte und verteilte Segmentzeiten, einmalige
  Übertragung, Abbruch bei Fehler, aus).
- Postgres mit echten Zugriffsregeln: Entfernen nur heute/aus dem Plan, Sätze gelöscht, Protokoll mit neuem Typ ohne
  Planübungs-Bezug, Rückgängig stellt die Planübung wieder her (75 Einträge als angemeldeter Nutzer).
- Browser (Pixel 7, hell/dunkel, simulierte Android-App), 28 Prüfungen: Einstellung, Gewichtsfeld (markiert beim
  Antippen, 62,5 tippbar), Vorschlag vor Satz 1 / nach Satz 1 / letzter Satz, Plan-Ziel, Entfernen nur heute und aus
  dem Plan mit Warnung, Plan ohne Übung, Protokoll und Rückgängig, Health Connect: Berechtigung, 2 Trainings mit Titel,
  Segmenten und Kalorien, App 1.0 zeigt Hinweis auf neue Version; kein horizontales Scrollen, keine Konsolenfehler.
- APK 1.1: Kotlin-Plugin kompiliert, Signatur wie 1.0, Berechtigungen geprüft. Nicht getestet: echtes Gerät.
