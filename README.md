# Gym – adaptive, wissenschaftsbasierte Trainings-App

Plattformübergreifende Web-App (PWA). Sie begleitet Nutzer von der Trainingsplanung bis zum Live-Tracking im Gym,
passt den Plan anhand der Leistung an und zeigt bei jedem Schritt sportwissenschaftlich belegte Richtwerte.

## Roadmap

- [x] **1. Datenbank-Schema & Datenmodelle** ([Doku](docs/01-datenbank-schema.md), [SQL](supabase/migrations/20261105000000_initial_schema.sql)) – *wartet auf Freigabe*
- [ ] 2. Setup & Boilerplate (Next.js, TypeScript, Tailwind, Supabase, PWA)
- [ ] 3. Übungs-Datenbank, wissenschaftliche Richtwerte & Plan-Generierung
- [ ] 4. UI: Onboarding, Dashboard, Live-Workout-Tracker (Mobile-First)
- [ ] 5. Datenvisualisierung (Kraft- & Volumenverlauf)

## Struktur

```
docs/                    Architektur- und Entscheidungsdokumente
supabase/migrations/     Datenbank-Migrationen (PostgreSQL / Supabase)
```
