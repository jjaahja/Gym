-- Kalender-Abo: persönlicher, geheimer Link (webcal://…/api/calendar/<token>.ics), den Kalender-Apps regelmäßig
-- abrufen. Kalender-Apps senden keine Anmeldung mit – deshalb liefert eine SECURITY-DEFINER-Funktion für einen
-- gültigen Token genau den Trainingsplan dieses Nutzers (Tage, Wochentage, Übungen, Deload, Auswertung), sonst nichts.
-- Der Token hat 256 Bit Zufall; ein neuer Token macht den alten Link ungültig.

create table public.calendar_feeds (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  token             text not null unique check (token ~ '^[A-Za-z0-9_-]{43,64}$'),
  event_time        time not null default '18:00',
  reminder_minutes  smallint not null default 30 check (reminder_minutes between 0 and 1440),
  created_at        timestamptz not null default now(),
  last_accessed_at  timestamptz
);

comment on table public.calendar_feeds is 'Kalender-Abo je Nutzer: geheimer Token, Uhrzeit und Erinnerung der Trainingstermine';

alter table public.calendar_feeds enable row level security;

create policy calendar_feeds_select_own on public.calendar_feeds
  for select to authenticated using (user_id = (select auth.uid()));
create policy calendar_feeds_insert_own on public.calendar_feeds
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy calendar_feeds_update_own on public.calendar_feeds
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy calendar_feeds_delete_own on public.calendar_feeds
  for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.calendar_feed(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.calendar_feeds;
  p public.training_plans;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43,64}$' then
    return null;
  end if;
  select * into f from public.calendar_feeds where token = p_token;
  if not found then
    return null;
  end if;
  update public.calendar_feeds set last_accessed_at = now() where user_id = f.user_id;
  select * into p from public.training_plans where user_id = f.user_id and status = 'active';

  return jsonb_build_object(
    'event_time', to_char(f.event_time, 'HH24:MI'),
    'reminder_minutes', f.reminder_minutes,
    'plan', case when p.id is null then null else jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'started_at', p.started_at,
      'cycle_started_at', p.cycle_started_at,
      'mesocycle_weeks', p.mesocycle_weeks,
      'deload_week_start', p.deload_week_start,
      'days', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'weekday', d.weekday,
          'exercises', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'exercise_id', pe.exercise_id,
              'sets', pe.target_sets,
              'reps_min', pe.target_reps_min,
              'reps_max', pe.target_reps_max,
              'rest_seconds', pe.rest_seconds,
              'last_set_technique', pe.last_set_technique
            ) order by pe.order_index), '[]'::jsonb)
            from public.plan_exercises pe where pe.plan_day_id = d.id
          )
        ) order by d.day_index), '[]'::jsonb)
        from public.plan_days d where d.plan_id = p.id
      )
    ) end
  );
end;
$$;

comment on function public.calendar_feed(text) is
  'Trainingsplan für einen gültigen Kalender-Abo-Token (öffentlich aufrufbar, gibt sonst null zurück)';

revoke all on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;
