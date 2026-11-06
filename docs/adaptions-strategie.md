# Entscheidung: Wie sich der Plan anpasst

> Status: **entschieden und umgesetzt** (Vorgabe: „das, was wissenschaftlich am klügsten ist“)
> Code: [`src/lib/training/progression.ts`](../src/lib/training/progression.ts) · Daten: `plan_adaptations`,
> `exercise_progress`, `weekly_muscle_volume`, `exercise_feedback_summary`

## Grundsatz

Automatisch passiert, was **gut belegt ist und sich leicht rückgängig machen lässt**. Wo die Evidenz dünn ist oder
persönliche Vorlieben eine große Rolle spielen, macht die App einen **Vorschlag**, den du bestätigst. Jede Änderung
landet mit Begründung und auslösendem Richtwert in `plan_adaptations`. Automatische Änderungen erscheinen als
Hinweis mit **„Rückgängig“** (Status `reverted`).

| Anpassung | Modus | Warum |
|---|---|---|
| Gewicht & Wiederholungen | **automatisch** | Progressive Überlastung ist das Kernprinzip. Steigerung über Last oder Wiederholungen bringt vergleichbares Wachstum (Plotkin et al. 2022). |
| Gewichtsvorschlag von Satz zu Satz | **automatisch vorausgefüllt**, jederzeit überschreibbar | Steuerung über RIR/RPE ist starren Vorgaben mindestens ebenbürtig (Helms et al. 2018; Graham & Cleather 2021). |
| Volumen innerhalb der Richtwerte | **automatisch, nur am Ende eines Mesozyklus** | Mehr Volumen wirkt dosisabhängig mit abnehmendem Zusatznutzen (Schoenfeld et al. 2017; Pelland et al. 2026). Ein individuelles Volumen war einem Einheitsvolumen überlegen (Scarpelli et al. 2022). |
| Volumen über dem Richtwert-Maximum | **Vorschlag** mit Hinweis auf „Junk Volume“ | Ab hier überwiegt das Ermüdungsrisiko. |
| Übungswechsel | **Vorschlag** | Gezielte Variation hilft beim Wachstum einzelner Muskelregionen und bei der Motivation, zu häufige Wechsel bremsen (Kassiano et al. 2022; Baz-Valle et al. 2019). Die Übungswahl ist persönlich. |
| Deload (leichtere Woche) | **Vorschlag** | Eine Pausenwoche verbessert das Muskelwachstum nicht (Coleman et al. 2024). Sie dient dem Ermüdungsabbau und ist in der Praxis etwa alle 5–6 Wochen üblich (Rogerson et al. 2024). |
| Split / Trainingstage | **nur auf deinen Wunsch** (neues Assessment) | Hängt vom Alltag ab, nicht von Trainingsdaten. |

## Regeln im Detail

### 1. Gewicht & Wiederholungen (doppelte Progression) – `evaluateDoubleProgression`

- Innerhalb des Wiederholungsbereichs zuerst Wiederholungen steigern.
- Schaffen **alle Arbeitssätze das obere Ende**, steigt beim nächsten Mal die Last um
  `exercises.load_increment_kg`, und die Wiederholungen starten wieder unten.
- Liegt **schon der erste Arbeitssatz in zwei Einheiten hintereinander unter der unteren Grenze**, sinkt die Last um
  ein Inkrement.
- Sonst bleibt das zuletzt genutzte Gewicht das Zielgewicht.

### 2. Gewichtsvorschlag während des Trainings – `suggestNextSet`

- RIR **mindestens 2 über dem Ziel** → nächster Satz ein Inkrement schwerer.
- RIR **unter dem Ziel** oder **unter der unteren Wiederholungsgrenze** → ein Inkrement leichter.
- Aufwärm- und Technik-Sätze (Drop, Myo, …) werden ignoriert. Es bleibt ein Vorschlag, eingetragen wird, was du
  tatsächlich geschafft hast.

### 3. Volumen – Plan-Generator und `reviewVolume`

- **Start** (Plan-Generator):
  - Jeder Muskel startet am **unteren Ende** der Richtwert-Spanne. Für Anfänger sind das 6 Sätze pro Woche, für
    Fortgeschrittene 10.
  - **Prioritätsmuskeln** aus dem Onboarding starten bei 40 % der Spanne, also bei 14 von 10–20.
  - Erst bekommen alle Muskeln ihr Minimum, dann die Prioritäten mehr.
- **Innerhalb eines Mesozyklus** (5 Wochen) bleibt das Volumen konstant. Nur so ist Leistung vergleichbar.
- **Am Ende eines Mesozyklus**, je Muskelgruppe:
  - Leistung steigt und es gibt keine Warnsignale → **+20 %** (mindestens +1, höchstens +2 Sätze pro Woche),
    gedeckelt auf das Maximum.
  - Leistung sinkt, oder es treten Ermüdung bzw. Gelenkbeschwerden auf → **−20 %**, nicht unter das Minimum.
    Gelenkbeschwerden werden zuerst über die Übung gelöst (Wechselvorschlag); das Volumen sinkt deshalb nur, wenn es
    für die betroffene Übung keine Alternative gibt.
  - Unter dem Minimum → automatisch auf das Minimum anheben.
  - Über dem Maximum → nur **Vorschlag**, zu reduzieren.
  - Sonst bleibt das Volumen gleich.
- Toleranz: Ein halber Satz unter dem Minimum gilt noch als erreicht (Zählgenauigkeit fraktionaler Sätze).
- **Umsetzung im Plan** (`distributeVolumeChange`): Die Satzänderung wird auf Übungen verteilt, die den Muskel
  direkt (primär) trainieren – immer auf die Übung mit den wenigsten Sätzen, bei Gleichstand zuerst Isolationsübungen.
  Je Übung bleiben es 2–5 Sätze. Vorher/Nachher-Satzzahlen stehen im Protokoll, „Rückgängig“ stellt sie wieder her.

### 4. Übungswechsel – `swapTrigger`, `findReplacement`

- **Ankerübungen** bleiben mindestens einen Mesozyklus lang im Plan, weil Kraftzuwächse übungsspezifisch sind.
- **Auslöser:**
  - **Gelenkbeschwerden ≥ 2** in den letzten zwei Einheiten → sofort ein Vorschlag.
  - **Stagnation** (kein neuer Bestwert über drei Einheiten) → Vorschlag zum Ende des Mesozyklus, **höchstens zwei**
    je Mesozyklus, zuerst Übungen mit schwachem Pump. Gezielt variieren statt alles auf einmal – sonst ist Fortschritt
    nicht mehr messbar (Richtwert `exercise_variation.planned`).
  - Ein abgelehnter Vorschlag kommt erst wieder, wenn **neue** Einheiten den Auslöser erneut zeigen.
- **Ersatzübung:**
  - Gleiches Bewegungsmuster und gleicher Primärmuskel. Gibt es keine, dann gleiche Mechanik und gleicher Muskel.
  - Mit deiner Ausstattung möglich, nicht als „vermeiden“ markiert und nicht schon im Plan.
  - Bevorzugt: Dehnungsfokus, guter persönlicher Pump, keine Gelenkbeschwerden.
- **Beim Annehmen** bekommt die neue Übung ihre eigene Vorgabe aus den Richtwerten (Wiederholungen, RIR, Pause),
  behält Satzzahl und Position und startet ohne Zielgewicht (wird im ersten Training ermittelt).

### 5. Deload – `checkDeload`, `buildDeloadWeek`

- **Auslöser:**
  - **Jederzeit:** Die Leistung sinkt bei mindestens zwei Übungen, und die Session-RPE der letzten zwei Einheiten
    liegt im Schnitt bei 9 oder höher.
  - **Am Ende eines Mesozyklus:** Seit mindestens 5 Wochen gab es keine leichtere Woche (Richtwert
    `deload.as_needed`, übliche Praxis alle 5–6 Wochen). Das ist ausdrücklich optional.
- **Inhalt:** etwa die Hälfte der Sätze, gleiche Übungen, RIR 3–4, keine Intensitätstechniken. Gewichte bleiben.
- **Ablauf:** Angenommen gilt die Deload-Woche 7 Tage. Der Tracker zeigt die reduzierte Vorgabe, Einheiten werden als
  `is_deload` gespeichert, es gibt **keine Laständerung**, und die Einheiten zählen nicht für Stagnation/Rückgang.
  Am Mesozyklus-Ende angenommen, beginnt der nächste Mesozyklus erst nach der Deload-Woche.

## Wie „Leistung“ gemessen wird

| Begriff | Definition |
|---|---|
| Leistung einer Übung | Bestes e1RM pro Einheit (`exercise_progress`). Bei mehr als 12 Wiederholungen ohne e1RM: Epley aus Topgewicht und durchschnittlichen Wiederholungen. |
| Stagnation | Kein neuer Bestwert (über +0,5 %) in den letzten drei Einheiten |
| Rückgang | Jüngste Einheit mindestens 5 % unter dem Schnitt der drei davor (Heuristik) |
| Trend im Mesozyklus | Schnitt der letzten zwei gegen die ersten zwei Einheiten: über +1 % steigend, unter −3 % fallend |
| Ermüdungssignal | Session-RPE ≥ 9 im Schnitt der letzten zwei Einheiten, Gelenkbeschwerden ≥ 2 |

Pump-Bewertungen fließen **nur in die Auswahl von Ersatzübungen** ein, nicht in Volumen- oder Lastentscheidungen.
Als Steuerungssignal ist der Pump nicht belegt.

## Quellen

Alle mit geprüfter DOI in [`src/data/science/sources.ts`](../src/data/science/sources.ts): Plotkin et al. 2022,
Helms et al. 2018, Graham & Cleather 2021, Schoenfeld et al. 2017, Pelland et al. 2026, Scarpelli et al. 2022,
Kassiano et al. 2022, Baz-Valle et al. 2019, Coleman et al. 2024, Rogerson et al. 2024.

## Ablauf im Mesozyklus

1. **Woche 1–5:** gleiches Volumen; nach jedem Training doppelte Progression (automatisch) und Prüfung auf
   Gelenkbeschwerden bzw. akute Ermüdung (→ Vorschlag im Dashboard: Annehmen/Ablehnen).
2. **Nach 5 Wochen** erscheint im Dashboard die Auswertung: Leistungstrend je Muskel, automatische
   Volumenänderungen innerhalb des Zielbereichs und die Vorschläge (Deload, Übungswechsel, Volumen über Maximum) zum
   Anhaken. „Neuen Mesozyklus starten“ wendet alles an; Nicht-Angehaktes wird als abgelehnt protokolliert.
3. Jede Änderung steht im Protokoll (`plan_adaptations`) und lässt sich rückgängig machen.

