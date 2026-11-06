# Gym – adaptive, wissenschaftsbasierte Trainings-App

**Live: https://gym-alpha-flax.vercel.app** – [Veröffentlichung & Installation aufs Handy](docs/07-veroeffentlichung.md)

Plattformübergreifende Web-App (PWA). Sie begleitet Nutzer von der Trainingsplanung bis zum Live-Tracking im Gym,
passt den Plan anhand der Leistung an und zeigt bei jedem Schritt sportwissenschaftlich belegte Richtwerte.

**Hauptziel: Muskelaufbau & Optik.** Der Pump wird als Feedback und mit gezielten Pump-Finishern unterstützt,
ohne die eigentlichen Wachstumstreiber (mechanische Spannung, Volumen, Progression) aus dem Blick zu verlieren.

## Schnellstart

```bash
npm install
cp .env.example .env.local   # optional: Supabase-URL + Publishable Key, sonst Demo-Modus
npm run dev                  # http://localhost:3000
```

Auf dem Handy: Seite öffnen → „Zum Home-Bildschirm“. Danach läuft die App im Vollbild und auch offline.

## Roadmap

- [x] **1. Datenbank-Schema & Datenmodelle** – [Doku](docs/01-datenbank-schema.md), [SQL](supabase/migrations/20261105000000_initial_schema.sql), [Adaptions-Strategie](docs/adaptions-strategie.md)
- [x] **2. Setup & Boilerplate** – [Doku](docs/02-setup-architektur.md)
- [x] **3. Übungs-Datenbank, wissenschaftliche Richtwerte & Plan-Generierung** – [Doku](docs/03-katalog-und-logik.md)
- [x] **4. UI: Onboarding, Dashboard, Live-Workout-Tracker** – [Doku](docs/04-oberflaeche-und-tracker.md)
- [x] **5. Datenvisualisierung & Mesozyklus-Abschluss** (Kraft, Wochenvolumen, Körpermaße, Pump; Volumen-, Deload- und Wechselentscheidungen) – [Doku](docs/05-fortschritt-und-mesozyklus.md)
- [x] **6. Geräte-Abgleich** (Server → Gerät: Plan, Protokoll, Trainings, Körpermaße, Einstellungen; Kontowechsel) – [Doku](docs/06-geraete-abgleich.md)
- [x] **7. Veröffentlichung** (Vercel + Supabase, live getestet mit zwei Geräten) – [Doku](docs/07-veroeffentlichung.md)
- [x] **8. Wochenplan, Kalender, Übungstausch & Videos** (Wochentage, neue Übersicht, Monatskalender mit Export und Abo, Tausch im Training, 65 geprüfte Ausführungsvideos, Machbarkeit Withings/Apple Health/Google Fit) – [Doku](docs/08-wochenplan-kalender-videos.md)
- [x] **9. Health Connect & Android-App** (Gewicht und Körperfett z. B. der Withings-Waage automatisch in die Körpermaße, Android-App als Hülle um die Web-App, Datenschutzseite) – [Doku](docs/09-health-connect-android.md)

## Tech-Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (PostgreSQL, Auth, RLS) · Zustand · TanStack Query ·
Dexie (IndexedDB) · Vitest

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm test` | Unit-Tests |
| `npm run lint` / `npm run typecheck` | Code-Qualität |
| `npm run build` && `npm start` | Production-Build (inkl. Service Worker) |
| `npm run db:seed` | `supabase/seed.sql` aus dem Katalog neu erzeugen |
| `npx tsx scripts/verify-resolver-parity.ts \| psql <db>` | Richtwert-Auflösung App = Datenbank |
| `npx tsx scripts/verify-sync-contract.ts \| psql <db>` | Outbox-Zeilen unter RLS, Views = App-Berechnung |
| `npx tsx scripts/verify-pull-contract.ts …` | Server-JSON → identischer Gerätezustand (Ablauf im Skriptkopf) |
