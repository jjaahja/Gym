-- Geräteübergreifender Abgleich: Der Planzustand liegt vollständig in der Datenbank, damit ein neues Gerät
-- Plan, Trainingstag, Mesozyklus und Deload wiederherstellen kann (bisher nur lokal gespeichert).

alter table public.training_plans
  add column next_day_index       smallint not null default 0 check (next_day_index >= 0),
  add column cycle_started_at     timestamptz,
  add column completed_mesocycles smallint not null default 0 check (completed_mesocycles >= 0),
  add column deload_week_start    timestamptz,
  add column last_deload_at       timestamptz,
  add column warnings             text[] not null default '{}',
  add column muscle_targets       jsonb not null default '[]'::jsonb
    check (jsonb_typeof(muscle_targets) = 'array');

comment on column public.training_plans.next_day_index is 'Welcher Trainingstag (plan_days.day_index) als Nächstes dran ist';
comment on column public.training_plans.cycle_started_at is 'Beginn des laufenden Mesozyklus (nach Auswertung bzw. Deload-Woche)';
comment on column public.training_plans.deload_week_start is 'Beginn der laufenden/letzten Deload-Woche (gilt 7 Tage)';
comment on column public.training_plans.warnings is 'Hinweise der Plan-Generierung (z. B. Volumen unter Minimum)';
comment on column public.training_plans.muscle_targets is
  'Zielvolumen je Muskel aus der Generierung: [{muscle_group_id, target_sets, min, max, frequency, priority}]';

alter table public.plan_days
  add column day_type text check (day_type in ('full_a', 'full_b', 'full_c', 'upper', 'lower', 'push', 'pull', 'legs'));

comment on column public.plan_days.day_type is 'Vorlage des Trainingstags (Generator)';
