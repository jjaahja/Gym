# Schritt 5 – Fortschritt & Mesozyklus-Abschluss

Der Verlauf zeigt, ob das Training wirkt – und liefert die Daten, mit denen der Plan am Ende jedes Mesozyklus angepasst
wird. Alles läuft lokal (IndexedDB) und offline; mit Konto werden Körpermaße und Entscheidungen synchronisiert.

## Fortschritt (`/progress`)

Vier Bereiche, oben umschaltbar:

| Bereich | Inhalt | Warum so |
|---|---|---|
| **Kraft** | Übung wählen (Standard: häufigste Grundübung), Linie mit **geschätztem 1RM** oder Topgewicht je Einheit, Kennzahlen (aktuell mit Veränderung, Bestwert, Einheiten), Hinweis bei Stillstand/Rückgang | Das e1RM (Epley, mit RIR) macht Fortschritt über verschiedene Wiederholungszahlen vergleichbar – ohne Maximalversuch. Aufwärm- und Deload-Sätze zählen nicht. Ohne Zusatzgewicht: Ø Wiederholungen pro Satz. |
| **Volumen** | Muskel wählen (Prioritäten mit ★), **harte Sätze pro Woche** der letzten 8 Wochen als Säulen vor dem Richtwert-Band, Linie für das geplante Volumen; Ø der letzten 4 abgeschlossenen Wochen; Übersicht aller Muskeln; Warnung bei „Junk Volume“ | Volumen ist der wichtigste steuerbare Wachstumstreiber; gezählt wird wie in der View `weekly_muscle_volume` (RIR ≤ 4, Mitbeanspruchung 0,5, Technik-Segment 0,5). |
| **Körper** | Maße eintragen/bearbeiten (ein Eintrag pro Tag), Verlauf je Maß, Veränderung seit Beginn und über 4 Wochen, **Schulter-Taillen-Verhältnis**, Liste mit Löschen | Für das Ziel Optik sagen Umfänge mehr als das Körpergewicht. Taille runter ist gut, Arme/Schultern rauf ist gut – die Farben der Veränderung folgen dem. |
| **Pump** | Übungen nach Ø Pump-Bewertung, mit Gelenk-Warnung | Pump ist als Wachstumssignal nicht belegt, aber eine gute Entscheidungshilfe zwischen ähnlich guten Übungen – die App nutzt ihn bei Wechselvorschlägen. |

Einheiten: kg/lb und cm/in folgen der Einstellung im Profil; gespeichert wird immer metrisch, gerundet wie die
Datenbankspalten.

### Diagramme (`src/components/charts.tsx`)

Eigene SVG-Komponenten, keine Chart-Bibliothek (klein, offline, volle Kontrolle):

- **Eine Serie, eine Achse**, Titel benennt die Serie (keine Legende nötig); Band und Planlinie haben eine kleine Legende.
- Linie 2 px, Punkte ≥ 8 px mit 2-px-Ring in Flächenfarbe; Säulen ≤ 24 px, oben 4 px gerundet, unten eckig.
- Raster als Haarlinie, Achsenwerte rund (1/2/2,5/5 × 10ⁿ, `niceTicks`), Datumsbeschriftung ohne Überlappung.
- **Fadenkreuz + Tooltip** (Linie) bzw. Tooltip je Säule mit großer Trefferfläche; Touch funktioniert, vertikales
  Scrollen bleibt möglich.
- **Tastatur:** Diagramm fokussieren, ←/→ wandern durch die Werte, Pos1/Ende springen; Werte werden vorgelesen.
- **Tabellenansicht** für jedes Diagramm.
- Serienfarbe hell `#c2410c`, dunkel `#ea580c` – beide mit dem Dataviz-Validator gegen die jeweilige Fläche geprüft
  (Helligkeitsband, Sättigung, Kontrast ≥ 3:1). Texte nutzen nie die Serienfarbe.

## Mesozyklus-Abschluss (Dashboard)

Nach 5 Wochen zeigt das Dashboard die **Auswertung** (`buildMesocycleReview`):

1. **Leistung je Muskel** – Trend aus dem e1RM der Übungen (Anfang vs. Ende des Zyklus).
2. **Wird angepasst** – Volumenänderungen innerhalb des Zielbereichs (automatisch, ±20 %, 1–2 Sätze).
3. **Deine Entscheidung** – zum Anhaken: Deload-Woche, Übungswechsel (Gelenkbeschwerden; Stagnation höchstens zwei),
   Volumen über dem Maximum.
4. **„Neuen Mesozyklus starten“** wendet alles an. Nicht Angehaktes wird als abgelehnt gespeichert und erst bei neuen
   Daten wieder vorgeschlagen.

Nach jedem Training prüft die App zusätzlich Gelenkbeschwerden (sofortiger Wechselvorschlag) und akute Ermüdung
(Leistung sinkt bei ≥ 2 Übungen und Session-RPE ≥ 9 → Deload-Vorschlag). Offene Vorschläge stehen im Dashboard mit
**Annehmen/Ablehnen**. Alle Änderungen – auch angenommene Wechsel und Deloads – lassen sich im Protokoll rückgängig
machen.

### Deload-Woche

- 7 Tage ab Annahme; das Dashboard zeigt das Enddatum, „Nächstes Training“ die reduzierte Vorgabe.
- Tracker: etwa halbe Sätze, RIR 3–4, keine Intensitätstechniken, Hinweis oben; Gewichte bleiben.
- Gespeichert als `workout_sessions.is_deload = true` (neue Migration) mit `plan_week`.
- Keine Laständerung, kein Einfluss auf Stagnation/Rückgang; im Kraftverlauf ausgeblendet, im Wochenvolumen gezählt.
- Am Mesozyklus-Ende angenommen, beginnt der nächste Zyklus nach der Deload-Woche.

Details der Regeln: [Adaptions-Strategie](adaptions-strategie.md).

## Wichtige Dateien

| Datei | Inhalt |
|---|---|
| `src/lib/training/analytics.ts` | Verläufe aus der lokalen Historie: Leistung je Einheit, Wochenvolumen je Muskel, Pump/Gelenk-Feedback |
| `src/lib/training/mesocycle.ts` | Planvolumen, Verteilung von Satzänderungen, Mesozyklus-Auswertung, Prüfung nach dem Training |
| `src/lib/offline/measurements.ts` | Körpermaße: Validierung wie die CHECK-Constraints, ein Eintrag pro Tag, Outbox |
| `src/stores/plan-store.ts` | `completeMesocycle`, `addSuggestion`, `acceptSuggestion`, `rejectSuggestion`, erweitertes `revertAdaptation`, `mesocyclePosition` (Woche, fällig, Deload), Persistenz v2 mit Migration |
| `src/components/charts.tsx`, `src/lib/chart-scale.ts` | Linien-/Säulendiagramm, Kennzahl, Achsen-Hilfen |
| `src/app/(app)/progress/*` | Fortschrittsseite |
| `src/app/(app)/dashboard/plan-review.tsx` | Auswertung, offene Vorschläge, Protokoll |
| `supabase/migrations/20261106000000_deload_sessions.sql` | `workout_sessions.is_deload` |

## Verifiziert

- **Unit-Tests:** 214 (u. a. Verläufe, Körpermaße, Achsen, Volumenverteilung, Auswertung, Gelenk-/Stagnations-/
  Ermüdungsregeln inkl. „abgelehnt → erst bei neuen Daten“, Store-Aktionen mit Rückgängig, Persistenz-Migration v1→v2,
  Deload-Training).
- **Sync-Vertrag gegen PostgreSQL 16 unter RLS:** 172 Outbox-Einträge, darunter Mesozyklus-Abschluss (Volumen
  automatisch und zurückgenommen, Übungswechsel und Deload angenommen, Volumenvorschlag abgelehnt), Deload-Training
  (`is_deload`, `plan_week`) und Körpermaße (überschreiben, löschen, Rundung). Ergebnis in der DB = App.
- **Resolver-Parität:** 5.724 Kombinationen TypeScript = SQL.
- **Browser (iPhone 13, hell und dunkel):** Fortschritt ohne Daten → 5 Wochen Historie → Auswertung mit
  automatischen Änderungen und Auswahl → Deload aktiv in Dashboard und Tracker → Kraft (Hover, Tastatur, Tabelle,
  Umschalten) → Volumen (Tooltip, Muskelwechsel) → Körper (Speichern, Bearbeiten, Validierung) → Pump → Deload
  rückgängig. Kein horizontales Scrollen, keine Konsolenfehler.

## Bekannte Grenzen

- ~~Kein Abgleich vom Server zum Gerät~~ – erledigt in [Schritt 6](06-geraete-abgleich.md).
- **Der Trend je Muskel** beruht auf dem e1RM der Übungen mit diesem Primärmuskel; Körpergewichtsübungen
  ohne Zusatzlast fließen nicht ein.
- **Kein Zeitraumfilter:** Volumen zeigt fest 8 Wochen, Kraft und Körper den gesamten Verlauf.
- **Pausen-Timer ohne Push, Erklärtexte in kg, keine Supersätze** (unverändert).
