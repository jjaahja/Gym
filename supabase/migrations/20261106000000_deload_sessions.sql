-- Schritt 5: Deload-Einheiten kennzeichnen.
-- Sie zählen zum Wochenvolumen, werden aber bei Stagnation/Rückgang (Mesozyklus-Auswertung) nicht
-- als Leistungsabfall gewertet – dort trainiert man bewusst mit halben Sätzen und RIR 3–4.
alter table public.workout_sessions
  add column is_deload boolean not null default false;

comment on column public.workout_sessions.is_deload is
  'Training in einer Deload-Woche (halbe Sätze, RIR 3–4); keine Progression, nicht in Stagnationsprüfung';
