# Schritt 3 – Übungskatalog, Richtwerte & Plan-Logik

> Status: **fertig, wartet auf Freigabe**

## Was dazugekommen ist

| Baustein | Ort | Umfang |
|---|---|---|
| Übungskatalog | `src/data/catalog/` | 65 Übungen, 17 Muskelgruppen, 17 Equipment-Typen |
| Studienquellen | `src/data/science/sources.ts` | 35 Quellen, 34 mit per Websuche geprüfter DOI |
| Richtwerte | `src/data/science/guidelines.ts` | 41 Regeln mit Geltungsbereich, Evidenzstufe und Quellen |
| Resolver | `src/lib/science/` | identisch zur SQL-Funktion (für 5.724 Kombinationen geprüft) |
| Datenbank-Seed | `supabase/seed.sql` | wird aus TypeScript erzeugt, idempotent |
| Plan-Generator | `src/lib/training/plan-generator.ts` | Fragebogen → kompletter Plan |
| Progression & Anpassung | `src/lib/training/progression.ts` | Regeln aus [adaptions-strategie.md](adaptions-strategie.md) |
| Übungs-Bibliothek | `/exercises`, `/exercises/[slug]` | Suche, Muskelfilter, Detailseiten mit Richtwerten und Quellen |

## Eine Quelle der Wahrheit

Katalog und Richtwerte stehen **nur** in TypeScript. Daraus entstehen:

- die App-Daten (offline verfügbar, Detailseiten werden beim Build statisch erzeugt) und
- `supabase/seed.sql` für die Datenbank: `npm run db:seed`. Ein Test schlägt fehl, wenn die Datei veraltet ist.

IDs sind **UUIDv5 aus dem Slug** (`src/lib/db/stable-id.ts`, gegen Pythons Referenzimplementierung getestet). App und
Datenbank kennen dadurch dieselbe ID, ohne sich abzustimmen. Folge: Slugs nie umbenennen.

Datenbank befüllen: Migration einspielen, dann `supabase/seed.sql` ausführen (`supabase db reset` macht beides lokal).
Der Seed lässt sich gefahrlos mehrfach ausführen.

## Übungskatalog

Jede Übung hat:
- deutsche Ausführung Schritt für Schritt, typische Fehler, kurze Cues
- Haupt- und mitbeanspruchte Muskeln
- nur das **zwingend nötige** Equipment
- Schwierigkeit, Gesamtermüdung (1–5), kleinste Laststeigerung
- das **Widerstandsprofil**: Wo ist die Übung am schwersten? Übungen mit Last in gedehnter Position werden für
  Muskelaufbau bevorzugt (Maeo et al. 2021, 2023; Pedrosa et al. 2022).

Konventionen:
- **Kurzhanteln:** Gewicht pro Hantel.
- **Körpergewichtsübungen:** Gewicht = Zusatzlast.
- **Mitbeanspruchte Muskeln** zählen 0,5 Sätze (Pelland et al. 2026).

Tests stellen sicher, dass jeder gezielt trainierte Muskel im Studio, mit Kurzhanteln und mit Minimal-Ausstattung
(Klimmzugstange und Band) mindestens eine Übung hat.

Platzhalter: Bilder, Videos und GIFs fehlen noch. Die Felder `image_url`, `video_url` und `gif_url` sind vorbereitet.

## Richtwerte und Quellen

Jede DOI wurde am 05.11.2026 per Websuche gegen Verlags-, PubMed- oder Repository-Einträge geprüft. Bei einer Quelle
(Schoenfeld & Contreras 2014, „The Muscle Pump“) waren die Angaben widersprüchlich. Sie steht deshalb ohne DOI im
Katalog.

Die Recherche hat zwei Korrekturen ergeben:
- **ACSM 2026:** Das ACSM hat 2026 ein neues Positionspapier veröffentlicht, das das von 2009 ersetzt. Es bestätigt
  ≥ 10 Sätze pro Woche für Muskelaufbau und ist als Quelle aufgenommen. Das Papier von 2009 bleibt für Einsteiger-
  und Kraftausdauer-Empfehlungen drin.
- **Deload-Umfrage:** Sie stammt von **Rogerson et al. 2024** (nicht „Bell 2023“). Üblich ist dort eine leichtere
  Woche alle 5–6 Wochen. Die Strategie-Doku ist korrigiert.

Die Richtwerte decken ab:
- **Pro Übung:** Wiederholungen, RIR, Pause, Tempo, Bewegungsumfang, Fokus, Pump-Finisher, Progression,
  Autoregulation
- **Pro Muskel:** Wochenvolumen, Sätze pro Einheit, Frequenz
- **Pro Plan:** Volumensteigerung, Übungswechsel, Deload

Drei Tests sichern die Richtwerte ab:
- Für jede Übung × Ziel × Erfahrungsstufe gibt es Wiederholungen, Pause, RIR, Technik-Regel und Progression.
- Nie haben zwei passende Regeln denselben Rang. Sonst wäre die SQL-Funktion nicht eindeutig.
- `scripts/verify-resolver-parity.ts` prüft gegen PostgreSQL, dass die App und `resolve_*_guidelines()` in allen
  **5.724 Kombinationen** dieselbe Regel wählen.

## Plan-Generator

Eingabe = Onboarding: Ziel, Erfahrung, Tage pro Woche, Minuten pro Einheit, Wunsch-Split, Prioritätsmuskeln,
Equipment, gemiedene und bevorzugte Übungen.

1. **Split:**
   - 1–3 Tage: Ganzkörper (A/B/C)
   - 4 Tage: Oberkörper/Unterkörper
   - 5 Tage: Oberkörper/Unterkörper + Push/Pull/Beine
   - 6 Tage: Push/Pull/Beine ×2
   - Ab 7 Tagen nutzt der Plan 6 Tage und weist auf den Ruhetag hin.
2. **Übungen pro Slot** aus Vorlagen (Bewegungsmuster + Zielmuskel). Bewertet werden:
   - Favoriten
   - Dehnungsfokus
   - Stabilität (Maschinen und Kabel lassen sich sicher bis nah ans Versagen fahren)
   - Ermüdung
   - Belastbarkeit: Für Fortgeschrittene keine Beinübungen, die durch Kurzhanteln begrenzt sind
   - Abwechslung zwischen A- und B-Tagen (Kassiano et al. 2022)
   - Bänder nur, wenn nichts anderes da ist
3. **Volumen** nach den Richtwerten:
   - Erst bringt jeder Muskel sein Minimum, dann bekommen Prioritätsmuskeln 40 % mehr Spanne.
   - Sätze werden dorthin verteilt, wo sie **pro Minute am meisten fehlendes Volumen** decken, mitbeanspruchte
     Muskeln eingeschlossen.
   - Grenzen: Wochenmaximum, Maximum pro Einheit und das Zeitbudget.
4. **Vorgaben pro Übung** aus den Richtwerten: Wiederholungen, RIR, Pause (untere Grenze des Richtwerts, länger
   ist erlaubt).
5. **Pump-Finisher:**
   - Nur bei Muskelaufbau, nicht für Einsteiger, nur an Isolationsübungen außer Bauch, höchstens 2 pro Tag.
   - Dropsatz an Maschine oder Kabel, Teilwiederholungen in der Dehnung bei Übungen mit Dehnungsfokus, sonst
     Myo-Reps.
   - Ein Technik-Segment zählt 0,5 Sätze.
6. **Hinweise:** wenn Zeit oder Ausstattung nicht fürs Mindestvolumen reichen, wenn ein Muskel nur an einem Tag
   trainiert wird oder wenn eine Einheit das Zeitbudget sprengt.

Zeitmodell (Schätzung):
- 6 min Aufwärmen
- 1 min Rüstzeit pro Übung
- 40 s Arbeit pro Satz, einseitige Übungen doppelt
- dazu die Pause

### Beispiel: Fortgeschritten, 4 Tage à 75 min, Studio, Priorität Schultern + Latissimus

**Oberkörper A** (ca. 68 min): Latziehen 2 · Rudern am Kabel 3 · Dips 4 · Seitheben am Kabel 3 ·
Kurzhantel-Pullover 3 + Teilwiederholungen in Dehnung · Seitheben (Kurzhantel) 4 + Myo-Reps · Schrägbank-Curls 3 ·
Face Pulls 3

**Unterkörper A** (ca. 52 min): Beinpresse 2 · Rumänisches Kreuzheben 2 · Bulgarische Kniebeuge 2 ·
Rückenstrecken 2 · Wadenheben an der Beinpresse 5 + Dropsatz · Beinstrecker 2 + Dropsatz · Kabel-Crunches 2

**Oberkörper B** (ca. 74 min): Klimmzug 2 · Bankdrücken 3 · Brustgestütztes Rudern 2 · Kurzhantel-Bankdrücken 2 ·
Seitheben am Kabel 3 · Kurzhantel-Pullover 3 · Seitheben (Kurzhantel) 4 + Myo-Reps · Skull Crusher 3 · Kabel-Curls 3 ·
Reverse Butterfly 3

**Unterkörper B** (ca. 48 min): Kniebeuge 2 · Rumänisches Kreuzheben (Kurzhantel) 2 · Ausfallschritte 2 ·
Wadenheben stehend 5 + Dropsatz · Beinbeuger sitzend 3 + Dropsatz · Kabel-Crunches 2

Grundübungen: 6–12 Wdh., RIR 1–3 (Hüftbeugen und Kniebeugen 2–3), 120 s Pause. Isolationsübungen: 10–20 Wdh., RIR
0–2, 60 s Pause.

| Muskel | Geplant (Sätze/Woche) | Richtwert |
|---|---|---|
| Seitliche Schulter ★ | 15 | 10–20 |
| Latissimus ★ | 14,5 | 10–20 |
| Trizeps | 12,8 | 10–20 |
| Brust | 12,3 | 10–20 |
| Waden | 11 | 10–20 |
| Hintere Schulter, Bizeps, Quadrizeps, Beinbeuger | 10,5 | 10–20 |
| Oberer Rücken, Gesäß | 10 | 10–20 |
| Bauch | 4 | 4–10 |

Jeder Muskel wird 2× pro Woche trainiert, es gibt keine Hinweise.

### Tests (756 Eingabekombinationen)

Kombiniert werden Tage (1–7) × Ziel × Erfahrung × Ausstattung (Studio, Kurzhanteln, minimal) × Dauer (45, 75 min) ×
mit/ohne Prioritäten. Für jede Kombination gilt:
- Nur machbare Übungen, keine doppelt am selben Tag, 2–5 Sätze pro Übung (Einsteiger höchstens 4).
- Wochen- und Einheiten-Maximum werden nie überschritten. Zeitbudget eingehalten, sonst ein ausdrücklicher Hinweis.
- Grundübungen kommen vor Isolationsübungen.
- Pump-Finisher nur unter den genannten Bedingungen.
- Im Studio ab 3 Tagen à 75 min erreicht **jeder Muskel sein Mindestvolumen**.
- Prioritätsmuskeln bekommen nie weniger als ohne Priorität.
- Gemiedene Übungen fehlen, Favoriten erscheinen.
- Das Ergebnis ist deterministisch.

Ehrliche Grenzen:
- Mit 3 × 60 min und nur Kurzhanteln erreichen Fortgeschrittene das Mindestvolumen nicht. Der Plan sagt das und
  schlägt mehr Zeit oder weniger Prioritäten vor.
- Supersätze, die Zeit sparen könnten, sind noch nicht eingeplant.

## Progression & Anpassung

Umgesetzt wie in [adaptions-strategie.md](adaptions-strategie.md) entschieden, mit 23 Tests:

| Funktion | Aufgabe |
|---|---|
| `suggestNextSet` | Gewichtsvorschlag von Satz zu Satz (RIR) |
| `evaluateDoubleProgression` | Gewicht nach jeder Einheit |
| `detectStagnation`, `isRegressing`, `mesocycleTrend` | Leistungsverlauf |
| `reviewVolume` | Volumen am Ende eines Mesozyklus |
| `checkDeload`, `buildDeloadWeek` | Deload |
| `swapTrigger`, `findReplacement` | Übungswechsel |

Alle liefern Vorschläge im Format von `plan_adaptations`, mit Status (`auto_applied` oder `suggested`),
Vorher/Nachher, auslösendem Richtwert und deutscher Begründung.

## Verifiziert

- 172 Unit-Tests grün, Typecheck und Lint ohne Befund, Production-Build (80 statische Seiten)
- PostgreSQL 16:
  - Migration und Seed laufen (zweimal hintereinander, idempotent).
  - Resolver-Parität: 5.724 von 5.724 Kombinationen sind identisch.
  - Die Schema-Tests aus Schritt 1 bleiben grün.
- Browser (iPhone-Emulation): Liste mit 65 Übungen, Muskelfilter, Suche, Detailseite mit Richtwerten,
  RPE-Umrechnung und DOI-Links, Kreuzheben mit RIR 2–3 und ohne Pump-Finisher, deutsche 404-Seite, keine JS-Fehler.
  - Bekannt: Unbekannte Übungs-Slugs liefern HTTP 200 mit `noindex`. Das ist dokumentiertes Verhalten von Next.js 16
    beim Streaming.
