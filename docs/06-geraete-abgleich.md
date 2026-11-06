# Schritt 6 – Geräte-Abgleich (Server → Gerät)

Bisher lief der Abgleich nur in eine Richtung: Änderungen gingen über die Outbox an Supabase. Jetzt holt sich jedes
Gerät auch den Stand vom Server. Neues Handy, Tablet oder Browser: anmelden, und Plan, Anpassungsprotokoll,
Trainingshistorie, Körpermaße und Anzeige-Einstellungen sind da.

## Ablauf

1. **Erst hochladen, dann holen.** Die Outbox wird zuerst übertragen, damit der Server den neuesten Stand dieses Geräts
   kennt.
2. **Holen** (`fetchRemoteState`): aktiver Plan mit Tagen und Übungen, Assessment, Ausstattung, Protokoll des Plans,
   abgeschlossene Trainings mit Übungen und Sätzen (seitenweise je 500), Körpermaße, Profil. RLS liefert nur eigene
   Zeilen.
3. **Übernehmen** (`pullFromServer`) nach festen Regeln (siehe unten).

Wann: beim Start, nach der Anmeldung (sofort), bei „Jetzt synchronisieren“ in den Einstellungen und danach höchstens
alle 10 Minuten (bei Netz, Fokus oder im 30-s-Takt). Während des ersten Abgleichs zeigt ein leeres Gerät
„Lade deine Daten …“ statt „Noch kein Trainingsplan“.

## Regeln

| Daten | Regel | Warum |
|---|---|---|
| **Konto** | Gehören die lokalen Daten einem anderen Konto, werden sie (inkl. Outbox) entfernt. | Kein Vermischen von Konten auf einem Gerät; fremde Outbox-Einträge würden ohnehin an RLS scheitern. |
| **Trainings** | Zusammenführen: Server ergänzt, lokale bleiben. | Trainings werden nie geändert oder gelöscht – ein noch nicht hochgeladenes Training darf nicht verschwinden. |
| **Körpermaße** | Server-Stand übernehmen, auch Löschungen – außer Einträge, die lokal noch ausstehen oder sich während des Abrufs geändert haben. ID je Konto und Tag stabil. | Gelöschte Messungen sollen auf allen Geräten verschwinden; derselbe Tag auf zwei Geräten ergibt keinen Konflikt. |
| **Plan, Protokoll, Einstellungen** | Nur ersetzen, wenn lokal **nichts aussteht**, **kein Training läuft** und sich während des Abrufs nichts geändert hat. Sonst beim nächsten Abgleich. | Ein älterer Server-Stand darf frische Änderungen dieses Geräts nicht überschreiben; ein laufendes Training braucht seine Planübungen. |

Gleichzeitige Änderungen auf zwei Geräten, die beide offline waren: Pro Zeile gewinnt, was zuletzt hochgeladen wird.

## Vollständiger Planzustand in der Datenbank

Damit ein Plan exakt wiederhergestellt werden kann, speichert die Migration
[`20261106120000_device_sync.sql`](../supabase/migrations/20261106120000_device_sync.sql) bisher nur lokale Felder:

| Spalte | Inhalt |
|---|---|
| `training_plans.next_day_index` | nächster Trainingstag (wird nach jedem Training aktualisiert) |
| `training_plans.cycle_started_at`, `completed_mesocycles` | laufender Mesozyklus |
| `training_plans.deload_week_start`, `last_deload_at` | Deload-Woche |
| `training_plans.warnings` | Hinweise der Plan-Generierung |
| `training_plans.muscle_targets` | Zielvolumen je Muskel (Ziel, Min, Max, Häufigkeit, Priorität) |
| `plan_days.day_type` | Vorlage des Trainingstags |

Alles andere wird aus den Zeilen abgeleitet – so wie das Gerät es selbst tut: geplantes Volumen und Dauer aus den
Übungen, Richtwert-Schlüssel der Vorgaben aus dem Katalog, Slugs aus den stabilen Katalog-IDs.

## Verifiziert

- **Round Trip** (`remote.test.ts`): Ein Gerät durchläuft Plan, zwei Trainings mit Laststeigerung,
  Mesozyklus-Abschluss (Volumen automatisch, Übungswechsel und Deload angenommen, Vorschlag abgelehnt, einer offen),
  Trainingstag-Wechsel und Körpermaße. Aus den Server-Zeilen (Format wie PostgREST) entsteht **exakt** derselbe
  Zustand: Plan, Protokoll, Trainings, Messungen.
- **Abgleichsregeln** (`pull.test.ts`): neues Gerät, Änderungen eines anderen Geräts, ausstehende Änderungen,
  laufendes Training, Änderungen während des Abrufs, gelöschte und ausstehende Messungen, Kontowechsel,
  Wiederholung ohne Änderung.
- **Abruf** (`remote-fetch.test.ts`): Filter, eingebettete Tabellen, Seitenweise-Laden (1.201 Trainings),
  Abbruch bei Fehlern statt halbem Stand.
- **Gegen PostgreSQL 16:** Schreib-Vertrag (176 Outbox-Einträge unter RLS, inkl. neuer Spalten) und Lese-Vertrag:
  Postgres erzeugt das JSON wie PostgREST (`row_to_json`/`json_agg` als angemeldeter Nutzer); daraus werden beide
  Pläne (aktiv und archiviert, mit Wechsel, Deload und zurückgenommener Volumenänderung), 5 Anpassungen,
  3 Trainings und 2 Körpermaße identisch wiederhergestellt. Eine absichtlich verfälschte Erwartung wird erkannt.
- **Browser (Demo-Modus):** Dashboard ohne Plan hängt nicht bei „Lade …“, Schritt-5-Ablauf unverändert grün.
- **Live gegen das Supabase-Projekt** (Frankfurt, Postgres 17; zwei getrennte Browserprofile als Geräte, zwei
  vorab bestätigte Testkonten, danach samt Daten gelöscht) – alle 18 Prüfungen bestanden:
  - Gerät A: Anmeldung, Plan, Training, Körpermaße → 64 Änderungen in 9 s auf dem Server (Plan inkl. Trainingstag,
    Zielvolumen, Tagesvorlage).
  - Gerät B (frisch, gleiches Konto): Plan mit richtigem nächsten Tag, Kraftverlauf und Körpermaße von A.
  - B trainiert und stellt auf lb um → A übernimmt beides beim nächsten Abgleich.
  - Kontowechsel auf B: das zweite Konto sieht nichts vom ersten. Keine Konsolenfehler.

## Gebündelte Übertragung

Die Outbox schickt aufeinanderfolgende Änderungen derselben Tabelle mit denselben Spalten als **eine** Anfrage
(höchstens 200 Zeilen). Die Reihenfolge zwischen Tabellen bleibt (Training vor Übung vor Satz); kommt dieselbe Zeile
mehrfach vor, gilt die letzte Version. Teil-Updates (z. B. nur die Einheit im Profil) bleiben einzeln, damit keine
Spalte mit NULL überschrieben wird. Ergebnis im Live-Test: 64 Änderungen (Plan + Training + Messung) in 9 s statt
über einer Minute – bei schlechtem Empfang im Gym zählt jede gesparte Anfrage.

Außerdem zeigen die Einstellungen direkt nach dem Laden „Prüfe ausstehende Änderungen …“ statt fälschlich
„Alles synchronisiert.“, bis die Warteschlange gezählt ist; das Abmelden zählt selbst nach.

## Supabase-Projekt

Eingerichtet über die Management-API (`api.supabase.com`, Personal Access Token in der Umgebung „Gym“):

1. Migrationen in Reihenfolge aus `supabase/migrations/`, danach `supabase/seed.sql` (65 Übungen, 41 Richtwerte,
   35 Quellen). Alle 20 Tabellen mit Row Level Security; Resolver-Parität TypeScript = SQL auch dort geprüft.
2. App-Konfiguration in `.env.local` (nicht im Repository): `NEXT_PUBLIC_SUPABASE_URL` und der **Publishable Key**
   (Dashboard → Project Settings → API Keys). Beide sind öffentlich; geschützt wird über RLS. Der Secret Key wird
   nirgends verwendet.

**Vor dem Veröffentlichen der App** (Dashboard → Authentication):

- **URL Configuration:** „Site URL“ und „Redirect URLs“ auf die echte Adresse setzen (derzeit
  `http://localhost:3000`), sonst führt der Bestätigungslink nach der Registrierung ins Leere.
- **E-Mails:** Der eingebaute Versand von Supabase schickt Bestätigungsmails nur an Mitglieder der Organisation und
  nur wenige pro Stunde. Für andere Nutzer einen eigenen SMTP-Dienst eintragen (Authentication → Emails → SMTP).
- Die E-Mail-Bestätigung bleibt eingeschaltet; für den Test wurden stattdessen bestätigte Testkonten angelegt.

## Bekannte Grenzen

- **Laufendes Training** wird nicht übertragen: Ein auf dem Handy begonnenes Training erscheint erst nach dem
  Abschluss auf anderen Geräten.
- **Archivierte Pläne** werden nicht geladen (nur ihre Trainings); das Protokoll umfasst den aktiven Plan.
- **Kein Echtzeit-Abgleich:** Änderungen eines anderen Geräts kommen beim nächsten Abgleich (spätestens nach
  10 Minuten bzw. sofort über „Jetzt synchronisieren“).
- **Dauerhaft abgelehnte Einträge halten die Outbox an.** Die Outbox überträgt strikt in Reihenfolge (Satz nie vor
  seinem Training). Lehnt der Server einen Eintrag dauerhaft ab (Datenfehler), bleibt alles Weitere liegen; die
  Einstellungen zeigen den Fehler. Den häufigsten Fall – zwei Geräte messen offline am selben Tag – verhindert eine
  stabile ID je Konto und Tag (`measurementId`): Beide schreiben dieselbe Zeile, der letzte Upload gewinnt.
