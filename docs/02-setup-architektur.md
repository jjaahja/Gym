# Schritt 2 – Setup & Architektur

> Status: **fertig, wartet auf Freigabe**

## Stack

| Bereich | Wahl |
|---|---|
| Framework | Next.js 16.4 (App Router, Turbopack, Cache Components, Partial Prefetching), React 19.3 |
| Sprache & Styling | TypeScript (strict), Tailwind CSS 4 |
| Backend | Supabase: PostgreSQL, Auth, Row Level Security (`@supabase/ssr` 0.12, `@supabase/supabase-js` 2.119) |
| Client-Zustand | Zustand 5 (laufendes Training, Einstellungen) |
| Server-Daten | TanStack Query 5 (ab Schritt 3: Übungen, Pläne, Richtwerte) |
| Offline-Puffer | Dexie 4 (IndexedDB) |
| Tests | Vitest 4 |

## Ordnerstruktur

```
src/
  app/
    (app)/              Seiten mit Bottom-Navigation
      dashboard/        Plan-Übersicht
      onboarding/       Fragebogen (Schritt 4)
      workout/          Live-Tracker
      exercises/        Bibliothek + [slug]-Detailseite (Schritt 3)
      progress/         Charts (Schritt 5)
      settings/         Einheiten, RIR/RPE, Sync, Abmelden
    (auth)/login/       Anmelden / Registrieren
    auth/callback/      Ziel des Bestätigungslinks aus der E-Mail
    offline/            Fallback des Service Workers
    manifest.ts         PWA-Manifest
  components/           Navigation, UI-Bausteine, Banner, Provider
  lib/
    db/enums.ts         Spiegel der Postgres-Enums (Test hält beides synchron)
    offline/            Dexie-DB, Outbox, Sync
    supabase/           Browser-/Server-Client, Konfiguration
    training/           Trainingslogik (RIR/RPE, ab Schritt 3 Plan-Generator & Progression)
    units.ts            kg ↔ lb
  stores/               Zustand-Stores
  proxy.ts              Session-Refresh + Login-Schutz (Next 16: früher middleware.ts)
public/
  sw.js                 Service Worker
  icons/                App-Icons
supabase/migrations/    Datenbank-Schema
```

## Architektur-Entscheidungen

### Statische App-Shell, Daten im Client

Alle Seiten werden beim Build als statisches HTML vorgerendert. Nutzerdaten lädt der Client direkt von Supabase
(mit RLS) bzw. aus dem lokalen Speicher. Gründe:

- **Offline-Fähigkeit:** Eine statische Seite kann der Service Worker cachen. Eine serverseitig pro Nutzer gerenderte
  Seite ginge im Gym ohne Netz nicht.
- **Geschwindigkeit:** Die Seite ist sofort da, Daten kommen aus dem Cache und werden im Hintergrund aktualisiert.
- **Cache Components:** Next 16 erzwingt, dass Session-Lesen hinter `<Suspense>` steht. Mit Client-Daten entfällt das
  weitgehend.

### Schutz in zwei Schichten

1. **`proxy.ts`** erneuert bei jedem Seitenaufruf die Supabase-Session und leitet nicht angemeldete Nutzer zum Login
   (mit `?next=` als Rücksprungziel, gegen Open Redirects abgesichert). Ist Supabase kurz nicht erreichbar, wird
   niemand ausgeloggt.
2. **Row Level Security** in der Datenbank ist die eigentliche Sicherung: Selbst mit gültigem Login sieht und
   schreibt jeder nur seine eigenen Daten.

### Offline-Training: Store → Outbox → Sync

```
Satz eintragen
   │
   ▼
Workout-Store (Zustand, in localStorage gespeichert)   ← UI liest von hier, überlebt Reload
   │ jede Änderung als vollständige DB-Zeile
   ▼
Outbox (IndexedDB, Reihenfolge garantiert)
   │ bei Netz: sofort, beim Fokus der App und alle 30 s
   ▼
Supabase (upsert mit clientseitig erzeugten UUIDs)
```

- **Reihenfolge bleibt erhalten:** Die Einträge werden strikt nacheinander übertragen. Beim ersten Fehler stoppt
  der Sync, damit nie ein Satz vor seiner Übung oder Session ankommt.
- **Wiederholbar:** Es werden immer ganze Zeilen per Upsert geschickt, nie Teil-Updates. Ein erneutes Senden nach
  einem Abbruch ist dadurch unschädlich.
- **Demo-Modus:** Ohne Supabase-Konfiguration läuft alles lokal, synchronisiert wird nichts.
- **Abmelden** entfernt die lokalen Trainingsdaten vom Gerät und warnt vorher, wenn noch etwas nicht
  synchronisiert ist.

### Service Worker (`public/sw.js`)

| Anfrage | Strategie |
|---|---|
| Seiten | Netz zuerst. Offline: zuletzt gesehene Version, sonst `/offline` |
| `/_next/static/*` (gehasht) | Cache zuerst |
| Icons, Manifest | aus dem Cache, Aktualisierung im Hintergrund |
| Supabase-API | **nie gecacht**. Daten laufen über die Outbox |

Weiterleitungen (z. B. zum Login) werden nie gecacht. Der Service Worker ist nur im Production-Build aktiv.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env.local   # Supabase-URL und Publishable Key eintragen (optional)
npm run dev                  # http://localhost:3000
```

Datenbank: Die Migration aus `supabase/migrations/` mit der Supabase-CLI einspielen (`supabase db push`) oder im
SQL-Editor des Supabase-Dashboards ausführen.

| Befehl | Prüft |
|---|---|
| `npm test` | Unit-Tests (Outbox, Workout-Store, Einheiten, Enum-Sync mit dem SQL, Redirect-Schutz) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production-Build inkl. Prerender-Prüfung von Cache Components |

## Verifiziert

- 47 Unit-Tests grün, Lint und Typecheck ohne Befund, Production-Build erfolgreich
- Im Browser (iPhone-Emulation, Production-Build):
  - Weiterleitung `/` → `/dashboard`
  - Training starten; Training und Timer überleben einen Reload
  - Einstellung RIR/RPE bleibt gespeichert
  - Aktiver Menüpunkt auch auf der Übungs-Detailseite
  - Service Worker aktiv; Trainingsseite offline erreichbar mit Offline-Banner; nie besuchte Seite zeigt `/offline`
  - Keine JS-Fehler
- Mit Supabase-Konfiguration:
  - Geschützte Seiten leiten zum Login mit Rücksprungziel; Login, Offline-Seite, Manifest, Icons und
    Service Worker bleiben öffentlich
  - Ist der Server nicht erreichbar, nennt der Login das richtig („Keine Verbindung“ statt „Passwort falsch“)
- `npm ci` aus der Lock-Datei installiert sauber; `npm audit` meldet für die ausgelieferten Pakete keine Schwachstellen

## Bekannte Grenzen (werden in den nächsten Schritten gelöst)

- **Datenbank-Typen:** Der Supabase-Client ist noch ungetypt. Die Typen werden generiert, sobald ein Supabase-Projekt
  verbunden ist (`supabase gen types`).
- **Dauerhafte Sync-Fehler:** Wird eine Zeile vom Server dauerhaft abgelehnt (z. B. durch einen Constraint), blockiert
  sie die Outbox. Der Fehler wird unter „Profil“ angezeigt. Eine Lösung im UI folgt mit dem Live-Tracker (Schritt 4).
- **Einstellungen** (kg/lb, RIR/RPE) sind vorerst nur lokal gespeichert und werden mit dem Onboarding an
  `profiles` angebunden.
- **Ende-zu-Ende gegen ein echtes Supabase-Projekt** ist noch nicht getestet: Im Container gibt es keins. Das Schema
  ist gegen PostgreSQL 16 getestet, die Sync-Logik gegen einen Fake.
