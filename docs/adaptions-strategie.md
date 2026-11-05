# Entscheidung: Wie sich der Plan anpasst

> Status: **entschieden** (Vorgabe: „das, was wissenschaftlich am klügsten ist“)
> Umsetzung der Logik: Schritt 3 · Datenbasis: `plan_adaptations`, `exercise_progress`, `weekly_muscle_volume`,
> `exercise_feedback_summary`

## Grundsatz

Automatisch passiert, was **gut belegt ist und sich leicht rückgängig machen lässt**. Wo die Evidenz dünn ist oder
persönliche Vorlieben eine große Rolle spielen, macht die App einen **Vorschlag**, den du bestätigst. Jede Änderung
landet mit Begründung und Quelle in `plan_adaptations`. Automatische Änderungen erscheinen als Hinweis mit der Option
**„Rückgängig“** (Status `reverted`).

| Anpassung | Modus | Warum |
|---|---|---|
| Gewicht & Wiederholungen | **automatisch** | Progressive Überlastung ist das Kernprinzip. Steigerung über Last oder über Wiederholungen bringt vergleichbares Wachstum (Plotkin et al. 2022). |
| Gewichtsvorschlag von Satz zu Satz | **automatisch vorausgefüllt**, jederzeit überschreibbar | Steuerung über RIR/RPE ist starren Vorgaben mindestens ebenbürtig (Helms et al. 2018; Graham & Cleather 2021). |
| Volumen (Sätze pro Muskel) | **automatisch, nur am Ende eines Mesozyklus und nur innerhalb der Richtwerte** | Volumen wirkt dosisabhängig mit abnehmendem Zusatznutzen (Schoenfeld et al. 2017). Eine individuelle Steigerung um etwa 20 % war einem Standardvolumen überlegen (Scarpelli et al. 2022). |
| Volumen über dem Richtwert-Maximum | **Vorschlag** mit Hinweis auf „Junk Volume“ | Ab hier überwiegt das Risiko von Ermüdung den möglichen Nutzen. |
| Übungswechsel | **Vorschlag** | Gezielte Variation hilft beim Wachstum einzelner Muskelregionen und bei der Motivation (Kassiano et al. 2022; Baz-Valle et al. 2019). Zu häufige Wechsel machen den Fortschritt aber unmessbar. Die Übungswahl ist zudem sehr persönlich. |
| Deload (leichtere Woche) | **Vorschlag, nur bei Bedarf** | Eine Pausenwoche verbessert das Muskelwachstum nicht (Coleman et al. 2024). Sie dient nur dem Abbau von Ermüdung, deshalb gibt es keinen starren Zwangs-Deload. |
| Split / Trainingstage | **nur auf deinen Wunsch** (neues Assessment) | Hängt von deinem Alltag ab, nicht von Trainingsdaten. |

## Regeln im Detail

### 1. Gewicht & Wiederholungen (doppelte Progression)

- Innerhalb des Wiederholungsbereichs zuerst Wiederholungen steigern.
- Schaffen **alle Arbeitssätze das obere Ende bei höchstens Ziel-RIR**, steigt beim nächsten Mal die Last um
  `exercises.load_increment_kg`, und die Wiederholungen starten wieder unten.
- Wird die **untere Grenze in zwei Einheiten hintereinander** verfehlt, sinkt die Last um ein Inkrement.

### 2. Gewichtsvorschlag während des Trainings

- Meldest du nach einem Satz einen **RIR, der mindestens 2 über dem Ziel liegt**, wird für den nächsten Satz ein
  Inkrement mehr vorgeschlagen.
- Liegt der RIR **unter dem Ziel** oder verfehlst du die untere Wiederholungsgrenze, wird ein Inkrement weniger
  vorgeschlagen.
- Es bleibt ein Vorschlag: Das Feld ist vorausgefüllt, eingetragen wird, was du tatsächlich geschafft hast.

### 3. Volumen

- **Start:** Anfänger am unteren Ende der Spanne (ca. 6–10 Sätze pro Muskel und Woche), Fortgeschrittene bei ca.
  10–12. **Prioritätsmuskeln** (Optik-Fokus aus dem Onboarding) starten höher, die übrigen Muskeln eher am unteren
  Ende.
- **Innerhalb eines Mesozyklus bleibt das Volumen konstant.** Nur so lässt sich Leistung sauber vergleichen.
- **Am Ende eines Mesozyklus**, je Muskelgruppe:
  - Leistung steigt, keine Gelenkbeschwerden, Volumen unter dem Maximum → **+20 %** (mindestens +1, höchstens
    +2 Sätze pro Woche), Prioritätsmuskeln zuerst.
  - Leistung sinkt oder Ermüdungs- bzw. Gelenksignale treten auf → **−20 %**.
  - Sonst bleibt das Volumen gleich.

### 4. Übungswechsel

- **Ankerübungen** bleiben mindestens einen Mesozyklus lang im Plan, weil Kraftzuwächse übungsspezifisch sind.
- **Auslöser für einen Vorschlag:**
  - **Gelenkbeschwerden** (Bewertung ≥ 2) in zwei Einheiten → sofort
  - **Stagnation** über drei Einheiten trotz Lastanpassung → zum Ende des Mesozyklus
  - **Optional:** Pro Mesozyklus 1–2 Isolationsübungen tauschen, für Abwechslung
- **Ersatzübung:** gleiches Bewegungsmuster und gleicher Primärmuskel, mit deinem Equipment möglich, nicht als
  „vermeiden“ markiert. Bevorzugt werden Übungen mit Dehnungsfokus und gutem persönlichem Pump.

### 5. Deload

- **Auslöser:**
  - Die Leistung sinkt bei mehreren Übungen über zwei Einheiten, und die Session-RPE ist hoch.
  - Oder etwa 8 Wochen ohne leichtere Woche vergehen. Das entspricht der üblichen Praxis (Bell et al. 2023), ist
    aber nur Expertenmeinung.
- **Inhalt:** etwa die Hälfte der Sätze, gleiche Übungen, RIR 3–4.

## Wie „Leistung“ gemessen wird

| Begriff | Definition |
|---|---|
| Leistung einer Übung | Bestes e1RM pro Einheit (`exercise_progress`). Bei hohen Wiederholungszahlen ohne e1RM: Wiederholungen bei gleicher Last. |
| Stagnation | Kein neuer Bestwert über drei Einheiten |
| Rückgang | Etwa 5 % unter dem Schnitt der letzten drei Einheiten (Heuristik) |
| Ermüdungssignal | Session-RPE ≥ 9 in mehreren Einheiten, Gelenkbeschwerden ≥ 2 |

Pump-Bewertungen fließen **nur in die Auswahl von Ersatzübungen** ein, nicht in Volumen- oder Lastentscheidungen.
Als Steuerungssignal ist der Pump nicht belegt.

## Quellen (DOIs folgen beim Seeding in Schritt 3)

- Plotkin et al. 2022: Progression über Last vs. Wiederholungen (PeerJ)
- Helms et al. 2018: RPE- vs. Prozent-basierte Belastung (Frontiers in Physiology)
- Graham & Cleather 2021: RIR-Autoregulation vs. feste Lasten (J Strength Cond Res)
- Schoenfeld, Ogborn & Krieger 2017: Dosis-Wirkung des Trainingsvolumens (J Sports Sci)
- Scarpelli et al. 2022: Individualisiertes Volumen (J Strength Cond Res)
- Kassiano et al. 2022: Übungsvariation, systematischer Review (J Strength Cond Res)
- Baz-Valle et al. 2019: Übungsvariation und Motivation (PLoS One)
- Coleman et al. 2024: Effekt einer Deload-Woche (PeerJ)
- Bell et al. 2023: Deload-Praxis im Kraft- und Physiquesport (Umfrage)
