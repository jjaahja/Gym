-- Funktionspaket: Übungsnotizen, Ernährung (Protein), Fortschrittsfotos, Fehlerberichte, Konto selbst löschen.
-- Alles nur für den eigenen Nutzer lesbar/schreibbar (Row Level Security).

-- ── Notizen je Übung (z. B. „Sitzhöhe 4“) ──
create table public.exercise_notes (
  user_id      uuid not null references auth.users(id) on delete cascade,
  exercise_id  uuid not null references public.exercises(id) on delete cascade,
  note         text not null check (char_length(note) between 1 and 500),
  updated_at   timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
alter table public.exercise_notes enable row level security;
create policy "own rows" on public.exercise_notes for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Ernährung je Tag (Protein, Kalorien) – von Hand oder aus Health Connect ──
create table public.nutrition_days (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null,
  protein_g    numeric(5,1) check (protein_g between 0 and 1000),
  energy_kcal  numeric(6,0) check (energy_kcal between 0 and 20000),
  source       text not null default 'manual' check (source in ('manual', 'health_connect')),
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.nutrition_days enable row level security;
create policy "own rows" on public.nutrition_days for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Fortschrittsfotos: Datei im privaten Bucket, Metadaten hier ──
create table public.progress_photos (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  taken_on      date not null,
  pose          text not null check (pose in ('front', 'side', 'back')),
  storage_path  text not null check (storage_path like user_id::text || '/%'),
  width         integer check (width > 0),
  height        integer check (height > 0),
  created_at    timestamptz not null default now()
);
create index progress_photos_user_idx on public.progress_photos (user_id, taken_on);
alter table public.progress_photos enable row level security;
create policy "own rows" on public.progress_photos for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Bucket (privat): Dateien unter <user_id>/… – nur der Besitzer darf lesen, hochladen, löschen
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "progress photos: read own" on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "progress photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "progress photos: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Fehlerberichte: nur schreiben (lesen nur der Betreiber im Dashboard) ──
create table public.client_errors (
  id           bigint generated always as identity primary key,
  user_id      uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  message      text not null check (char_length(message) <= 2000),
  context      jsonb check (pg_column_size(context) <= 8192),
  app_version  text check (char_length(app_version) <= 40)
);
alter table public.client_errors enable row level security;
create policy "insert own" on public.client_errors for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ── Konto selbst löschen: alle Tabellen hängen per „on delete cascade“ am Nutzer ──
-- Fotos im Storage löscht die App vorher über die Storage-API (direktes Löschen in storage.objects ist gesperrt).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'nicht angemeldet';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
