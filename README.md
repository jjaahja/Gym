# Gym – adaptive, wissenschaftsbasierte Trainings-App

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
- [x] **2. Setup & Boilerplate** – [Doku](docs/02-setup-architektur.md) – *wartet auf Freigabe*
- [ ] 3. Übungs-Datenbank, wissenschaftliche Richtwerte & Plan-Generierung
- [ ] 4. UI: Onboarding, Dashboard, Live-Workout-Tracker (Mobile-First)
- [ ] 5. Datenvisualisierung (Kraft-, Volumen- und Körpermaß-Verlauf)

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
