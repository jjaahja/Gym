# Schritt 4 – Onboarding, Dashboard & Live-Tracker

> Status: **fertig, wartet auf Freigabe**

## Onboarding (`/onboarding`)

Sieben kurze Schritte, jeder mit dem passenden Richtwert samt Evidenzstufe und Quellen:

| Schritt | Abfrage | Wissenschaftlicher Hinweis |
|---|---|---|
| Ziel | Muskelaufbau & Optik (Standard), Maximalkraft, Kraftausdauer | Wiederholungsbereich des Ziels |
| Erfahrung | Einsteiger, Fortgeschritten, Erfahren | Wochenvolumen für diese Stufe |
| Zeit | Tage pro Woche, Minuten pro Einheit | Vorschau des Splits, Frequenz-Richtwert |
| Ausstattung | Vorlagen (Studio, Kurzhanteln, Minimal) und einzelne Geräte | – |
| Fokus | höchstens 3 Prioritätsmuskeln, Vorlagen („V-Form“, „Arme“ …) | Wie viel Extra-Volumen eine Priorität bringt |
| Feinschliff | Wunsch-Split, Einschränkungen | – |
| Vorschau | Kompletter Plan mit Volumenbalken je Muskel und Hinweisen | – |

„Übernehmen“ speichert den Plan. Ein bestehender Plan wird archiviert, die Historie bleibt erhalten.

## Dashboard (`/dashboard`)

- **Nächstes Training** mit Übungen, Sätzen, Wiederholungen und Zielgewicht. Mit „Training starten“ geht es
  direkt in den Tracker.
- **Woche X von 5** im aktuellen Mesozyklus
- **Diese Woche:**
  - harte Sätze je Muskel aus der lokalen Historie, gezählt mit denselben Regeln wie die SQL-View
  - Strich = geplant, markierter Bereich = Richtwert
- **Anpassungen:** automatische Gewichtssteigerungen mit Begründung und **Rückgängig**
- **Alle Trainingstage:** Details aufklappbar, jeder Tag lässt sich einzeln starten
- **Hinweise des Plan-Generators** und „Plan neu erstellen“

## Live-Tracker (`/workout`)

Pro Übung eine Karte. Die aktuelle ist aufgeklappt und bleibt offen, bis man selbst weitergeht.

| Element | Inhalt |
|---|---|
| Richtwerte inline | Wiederholungen, RIR (oder RPE, je nach Einstellung), Pause, Pump-Finisher. Unter „Warum?“ die Begründung mit Bewegungsumfang und Fokus, dazu der Link zur Ausführung. |
| Letztes Mal | Arbeitssätze der letzten Einheit mit dieser Übung (lokale Historie, auch offline) |
| Gewichtsfeld | Vorausgefüllt mit dem Vorschlag der Autoregulation, die Begründung steht darunter (z. B. „5 Wiederholungen im Tank – mehr als geplant“) |
| RIR/RPE | Ein Fingertipp (0–5+ bzw. RPE 10 bis ≤5) |
| Satzarten | Arbeitssatz, Aufwärmen, geplanter Finisher (Dropsatz, Myo-Reps, …) |
| Junk Volume | Warnung, sobald ein Muskel heute das Maximum pro Einheit erreicht |
| Pump & Gelenke | Bewertung 0–3. Pump hilft nur bei der Übungswahl, Gelenkbeschwerden führen zu Wechselvorschlägen. |
| Pausen-Timer | Startet automatisch mit dem Richtwert, +15 s oder „Weiter“, Vibration am Ende. Das Eingabefeld scrollt über den Timer. |
| Übung hinzufügen | Suche im Katalog, gefiltert nach der eigenen Ausstattung |
| Beenden | Übersicht der harten Sätze, Session-RPE (1–10), danach doppelte Progression mit „Fürs nächste Mal“ |

Gewichte werden in kg gespeichert und in kg oder lb angezeigt. Dezimalkomma und -punkt werden beide akzeptiert.
Körpergewichtsübungen haben ein optionales Zusatzgewicht, Zeitübungen (Plank) ein Sekundenfeld.

## Datenfluss

```
Onboarding ──► Plan-Store (localStorage) ──► Outbox ──► Supabase
Tracker ─────► Workout-Store (localStorage) ─┘
Beenden ─────► lokale Historie (IndexedDB) ──► „Letztes Mal“, Wochenvolumen, Progression
              └► Plan-Store: Zielgewicht, Anpassungsprotokoll, nächster Tag
```

- **Offline und Demo-Modus:** Alles funktioniert ohne Netz und ohne Konto. Mit Konto wird jede Änderung als
  vollständige Zeile in der richtigen Reihenfolge synchronisiert: alter Plan archiviert → Assessment → Equipment →
  Plan → Tage → Übungen → Profil.
- **Abmelden** löscht Plan, Training, Historie und Outbox vom Gerät.
- **Einstellungen** (kg/lb, RIR/RPE) werden zusätzlich im Profil gespeichert.

## Verifiziert

- **185 Unit-Tests** grün, Typecheck, Lint und Production-Build ohne Befund.
- **Sync-Vertrag gegen PostgreSQL** (`scripts/verify-sync-contract.ts`):
  - Ein realistischer Ablauf erzeugt 152 Outbox-Einträge: Plan, zwei Trainings, Aufwärm-, Dropsatz-, gelöschter
    und neu nummerierter Satz, Plank, Progression, Rückgängig, verworfenes Training, neuer Plan.
  - Alle 152 werden **als angemeldeter Nutzer unter Row Level Security** angenommen.
  - Wochenvolumen (View `weekly_muscle_volume`), e1RM (generierte Spalte) und „Letztes Mal“ (View
    `exercise_last_performance`) stimmen exakt mit der App-Berechnung überein.
  - Weitere Prüfungen: genau ein aktiver Plan, archivierter Vorgänger, Session-RPE, Profil mit Zeitzone und
    Onboarding-Datum.
- **Browser-Durchlauf** (iPhone-Emulation, Production-Build, 34 Prüfungen), komplett:
  - Onboarding mit allen Richtwert-Hinweisen bis zur Vorschau mit 12 Volumenbalken
  - Dashboard und Trainingsstart, Satz eintragen, Pausen-Timer
  - **offline weitertrainieren**, Gewichtsvorschlag nach RIR 5+ (+2,5 kg, begründet)
  - RIR-Auswahl wird nicht vom Timer verdeckt
  - Reload behält Sätze und Pump-Bewertung
  - Abschluss mit Session-RPE und automatischer Steigerung, danach Rückgängig
  - „Letztes Mal“ beim nächsten Training, Verwerfen
  - keine JS-Fehler

## Bekannte Grenzen

- ~~Kein Abgleich vom Server zum Gerät~~ – erledigt in [Schritt 6](06-geraete-abgleich.md).
- ~~Mesozyklus-Ende noch nicht in der Oberfläche~~ – erledigt in [Schritt 5](05-fortschritt-und-mesozyklus.md).
- **Pausen-Timer ohne Push-Benachrichtigung:** Er vibriert nur bei geöffneter App.
- **Erklärtexte nur in kg:** Begründungen zu Anpassungen nennen Gewichte in kg, auch wenn lb gewählt ist.
- **Keine Supersätze.**
