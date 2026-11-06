# Veröffentlichung

**Live:** https://gym-alpha-flax.vercel.app

## Auf dem Handy installieren

1. Adresse im Browser öffnen und registrieren (siehe „Registrierung“ unten).
2. **iPhone (Safari):** Teilen → „Zum Home-Bildschirm“. **Android (Chrome):** Menü ⋮ → „App installieren“.
3. Danach startet die App im Vollbild und funktioniert im Gym auch ohne Netz; Änderungen werden nachgeladen,
   sobald wieder Empfang da ist.

## Aufbau

| Teil | Dienst | Einstellungen |
|---|---|---|
| App (Next.js) | Vercel, Projekt `gym`, Hobby-Tarif | Node 22, Installation `npm ci`, Umgebungsvariablen `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (beide öffentlich) |
| Datenbank & Anmeldung | Supabase, Projekt „Gym“ (Frankfurt) | Migrationen + Katalog eingespielt, Row Level Security auf allen Tabellen; Site URL und Redirect-URL = Live-Adresse; E-Mail-Bestätigung an |

`.vercelignore` hält lokale Geheimnisse (`.env*`) und Build-Artefakte aus dem Upload heraus.

## Registrierung

Die E-Mail-Bestätigung ist eingeschaltet. Supabase verschickt mit dem eingebauten Mailversand Bestätigungsmails
**nur an Mitglieder der eigenen Supabase-Organisation** und nur wenige pro Stunde. Für den eigenen Gebrauch also mit
der E-Mail-Adresse registrieren, mit der das Supabase-Konto angelegt ist. Sollen weitere Personen die App nutzen:
im Supabase-Dashboard unter Authentication → Emails einen eigenen SMTP-Dienst eintragen.

## Aktualisieren

Neue Version veröffentlichen (im Projektordner):

```bash
vercel deploy --prod
```

Optional automatisch bei jedem Push: im Vercel-Dashboard unter Project → Settings → Git das GitHub-Repository
`jjaahja/Gym` verbinden und den Produktions-Branch wählen.

## Verifiziert

Zwei-Geräte-Test gegen die veröffentlichte App (zwei getrennte Browserprofile, zwei vorab bestätigte Testkonten,
danach samt Daten gelöscht) – alle 18 Prüfungen bestanden: Anmeldung, Plan, Training und Körpermaße auf Gerät A
(64 Änderungen in 11 s hochgeladen), vollständige Übernahme auf Gerät B, Rückweg B → A (Training, Einheit lb),
Kontowechsel ohne fremde Daten, keine Konsolenfehler. Außerdem: HTTPS mit HSTS, Anmeldeschutz aller App-Seiten,
Manifest und Service Worker erreichbar.

## Zugänge

Für Einrichtung und Veröffentlichung sind in der Claude-Cloud-Umgebung „Gym“ ein Supabase Access Token und ein
Vercel-Token gespeichert. Beide geben Verwaltungszugriff. Wenn keine weitere Arbeit über Claude ansteht, unter
supabase.com → Account preferences → Access Tokens bzw. vercel.com → Account Settings → Tokens widerrufen.
