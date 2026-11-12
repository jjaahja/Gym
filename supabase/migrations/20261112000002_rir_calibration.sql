-- RIR-Check: Satz bis zum Versagen mit vorheriger Schätzung – wie gut schätzt der Nutzer die Wiederholungen im Tank?
-- Tatsächlicher RIR = failure_reps − stop_reps. Der Satz selbst steht wie jeder andere in set_logs.
create table public.rir_calibrations (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  exercise_id    uuid not null references public.exercises(id) on delete cascade,
  performed_on   date not null,
  weight_kg      numeric(6,2) check (weight_kg >= 0),
  stop_reps      smallint not null check (stop_reps between 1 and 50),
  predicted_rir  numeric(3,1) not null check (predicted_rir between 0 and 10),
  failure_reps   smallint not null check (failure_reps between 1 and 60),
  created_at     timestamptz not null default now(),
  constraint rir_calibration_failure_after_stop check (failure_reps >= stop_reps)
);
create index rir_calibrations_user_idx on public.rir_calibrations (user_id, created_at);
alter table public.rir_calibrations enable row level security;
create policy "own rows" on public.rir_calibrations for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
