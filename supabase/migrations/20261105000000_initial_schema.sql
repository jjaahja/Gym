-- =============================================================================
-- Gym App – Initiales Datenbank-Schema (Supabase / PostgreSQL 15+)
-- =============================================================================
-- Konventionen
--   * Bezeichner auf Englisch (snake_case), Kommentare auf Deutsch.
--   * Primärschlüssel sind UUIDs, damit der Client (PWA, offline im Gym) IDs
--     selbst erzeugen und Sätze später per Upsert synchronisieren kann.
--   * Gewichte werden IMMER in kg gespeichert; die Umrechnung in lb passiert in der UI.
--   * Anstrengung wird IMMER als RIR gespeichert; RPE wird abgeleitet (RPE = 10 - RIR).
--   * Katalogdaten (Übungen, Muskeln, Richtwerte) sind für alle lesbar und werden
--     nur per Service-Role/Migration gepflegt. Nutzerdaten sind per RLS isoliert.
-- =============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- -----------------------------------------------------------------------------
-- 1. ENUMS
-- -----------------------------------------------------------------------------

create type public.training_goal as enum ('hypertrophy', 'strength', 'endurance');
create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');
create type public.split_type as enum ('full_body', 'upper_lower', 'push_pull_legs', 'custom');

create type public.body_region as enum ('upper', 'lower', 'core');
create type public.muscle_role as enum ('primary', 'secondary');

create type public.exercise_mechanic as enum ('compound', 'isolation');
create type public.exercise_tracking as enum ('weight_reps', 'bodyweight_reps', 'duration');
create type public.laterality as enum ('bilateral', 'unilateral');

-- Bewegungsmuster bzw. Gelenkaktion – Basis für Plan-Generierung und Übungswechsel
create type public.movement_pattern as enum (
  'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
  'squat', 'hinge', 'lunge', 'hip_extension',
  'knee_extension', 'knee_flexion', 'hip_abduction', 'hip_adduction', 'ankle_plantarflexion',
  'elbow_flexion', 'elbow_extension',
  'shoulder_abduction', 'shoulder_horizontal_adduction', 'shoulder_horizontal_abduction',
  'shoulder_extension',
  'core_anti_extension', 'core_flexion', 'core_rotation', 'carry'
);

-- Kategorien wissenschaftlicher Richtwerte.
-- Übungs-Ebene:   rep_range, rest_interval, proximity_to_failure, tempo, progression
-- Muskel-Ebene:   weekly_volume, session_volume, frequency
-- Plan-Ebene:     deload
create type public.guideline_category as enum (
  'rep_range', 'rest_interval', 'proximity_to_failure', 'tempo', 'progression',
  'weekly_volume', 'session_volume', 'frequency',
  'deload'
);

create type public.guideline_unit as enum (
  'reps', 'seconds', 'rir', 'sets_per_week', 'sets_per_session',
  'sessions_per_week', 'percent_1rm', 'weeks', 'kg', 'percent'
);

create type public.guideline_severity as enum ('info', 'tip', 'warning');

-- Wo in der App ein Richtwert eingeblendet werden darf
create type public.guideline_context as enum (
  'onboarding', 'plan_builder', 'exercise_detail', 'workout_tracker', 'analytics'
);

create type public.evidence_grade as enum ('strong', 'moderate', 'limited', 'expert_opinion');
create type public.source_type as enum (
  'meta_analysis', 'systematic_review', 'rct', 'position_stand', 'narrative_review', 'expert_consensus'
);

create type public.plan_status as enum ('draft', 'active', 'archived');
create type public.progression_scheme as enum ('double_progression', 'linear', 'rir_autoregulated');

create type public.session_status as enum ('in_progress', 'completed', 'abandoned');
create type public.set_type as enum ('warmup', 'working', 'backoff', 'dropset', 'amrap');

create type public.adaptation_type as enum (
  'increase_load', 'decrease_load', 'add_set', 'remove_set',
  'change_rep_range', 'swap_exercise', 'deload'
);
create type public.adaptation_reason as enum (
  'progression_achieved', 'stagnation', 'regression', 'high_fatigue',
  'volume_below_min', 'volume_above_max', 'user_request'
);
create type public.adaptation_status as enum ('suggested', 'accepted', 'rejected', 'auto_applied');

create type public.exercise_preference as enum ('favorite', 'avoid');
create type public.effort_scale as enum ('rir', 'rpe');
create type public.unit_system as enum ('metric', 'imperial');

-- -----------------------------------------------------------------------------
-- 2. HILFSFUNKTIONEN
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. KATALOG: MUSKELN, EQUIPMENT, ÜBUNGEN
-- -----------------------------------------------------------------------------

create table public.muscle_groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,               -- z. B. 'chest', 'side_delts', 'quads'
  name_de     text not null,
  name_en     text not null,
  region      public.body_region not null,
  sort_order  int  not null default 0
);

create table public.equipment (
  id       uuid primary key default gen_random_uuid(),
  slug     text not null unique,                  -- z. B. 'barbell', 'dumbbell', 'cable', 'none'
  name_de  text not null,
  name_en  text not null
);

create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name_de           text not null,
  name_en           text not null,
  description       text,
  instructions      text[] not null default '{}',  -- Ausführung Schritt für Schritt
  common_mistakes   text[] not null default '{}',
  cues              text[] not null default '{}',  -- kurze Coaching-Cues für den Tracker
  image_url         text,
  video_url         text,
  gif_url           text,
  mechanic          public.exercise_mechanic not null,
  movement_pattern  public.movement_pattern  not null,
  laterality        public.laterality        not null default 'bilateral',
  tracking_type     public.exercise_tracking not null default 'weight_reps',
  difficulty        public.experience_level  not null default 'beginner',
  -- 1 = kaum systemische Ermüdung (Curls), 5 = sehr hoch (Kreuzheben).
  -- Wird für Pausenzeiten, Übungsauswahl und Deload-Logik genutzt.
  systemic_fatigue  smallint not null default 2 check (systemic_fatigue between 1 and 5),
  -- Kleinste sinnvolle Laststeigerung, z. B. 2.5 kg Langhantel, 1 kg Kabel
  load_increment_kg numeric(4,2) not null default 2.5 check (load_increment_kg > 0),
  -- NULL = globale Katalog-Übung; gesetzt = eigene Übung eines Nutzers
  created_by        uuid references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index exercises_movement_pattern_idx on public.exercises (movement_pattern);
create index exercises_created_by_idx on public.exercises (created_by) where created_by is not null;

create trigger exercises_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();

-- Primär-/Sekundärmuskeln. contribution = Gewichtung für die Volumenzählung
-- (Primär 1.0, Sekundär typischerweise 0.5 → "fraktionale Sätze").
create table public.exercise_muscles (
  exercise_id      uuid not null references public.exercises(id) on delete cascade,
  muscle_group_id  uuid not null references public.muscle_groups(id) on delete restrict,
  role             public.muscle_role not null,
  contribution     numeric(3,2) not null
                   check (contribution > 0 and contribution <= 1),
  primary key (exercise_id, muscle_group_id)
);

create index exercise_muscles_muscle_idx on public.exercise_muscles (muscle_group_id);

-- Benötigtes Equipment (alle gelisteten Teile werden benötigt)
create table public.exercise_equipment (
  exercise_id   uuid not null references public.exercises(id) on delete cascade,
  equipment_id  uuid not null references public.equipment(id) on delete restrict,
  primary key (exercise_id, equipment_id)
);

create index exercise_equipment_equipment_idx on public.exercise_equipment (equipment_id);

-- -----------------------------------------------------------------------------
-- 4. WISSENSCHAFTLICHE RICHTWERTE
-- -----------------------------------------------------------------------------

create table public.scientific_sources (
  id          uuid primary key default gen_random_uuid(),
  citation    text not null,                       -- Kurzzitat, z. B. "Schoenfeld et al., 2017"
  title       text not null,
  journal     text,
  year        smallint not null,
  doi         text unique,
  url         text,
  source_type public.source_type not null
);

-- Ein Richtwert ist eine Regel mit optionalen Geltungsbereich-Spalten (scope_*).
-- NULL in einer scope-Spalte = "gilt für alle". Ist eine scope-Spalte gesetzt,
-- MUSS sie zum Kontext passen. Gibt es mehrere passende Regeln derselben
-- Kategorie, gewinnt die spezifischste (höchste specificity, dann priority).
create table public.scientific_guidelines (
  id                     uuid primary key default gen_random_uuid(),
  key                    text not null unique,     -- stabiler Schlüssel, z. B. 'rep_range.hypertrophy.isolation'
  category               public.guideline_category not null,

  -- Geltungsbereich (alle optional)
  scope_goal             public.training_goal,
  scope_experience       public.experience_level,
  scope_mechanic         public.exercise_mechanic,
  scope_muscle_group_id  uuid references public.muscle_groups(id) on delete cascade,
  scope_movement_pattern public.movement_pattern,
  scope_exercise_id      uuid references public.exercises(id) on delete cascade,

  -- Richtwert
  min_value              numeric(7,2),
  max_value              numeric(7,2),
  unit                   public.guideline_unit not null,

  -- Darstellung. Platzhalter {min}, {max} werden von der App ersetzt.
  title                  text not null,
  message                text not null,           -- z. B. "Lass {min}–{max} Wiederholungen im Tank."
  rationale              text,                    -- kurze wissenschaftliche Begründung
  severity               public.guideline_severity not null default 'info',
  contexts               public.guideline_context[] not null default '{}',
  evidence_grade         public.evidence_grade not null,

  priority               smallint not null default 0,  -- Tie-Breaker bei gleicher specificity
  is_active              boolean not null default true,
  version                int not null default 1,

  -- Je spezifischer der Geltungsbereich, desto höher der Wert (Bit-Gewichtung,
  -- damit eine spezifischere Ebene nie von mehreren allgemeineren überstimmt wird).
  specificity            smallint generated always as (
                             (case when scope_exercise_id      is not null then 32 else 0 end)
                           + (case when scope_movement_pattern is not null then 16 else 0 end)
                           + (case when scope_muscle_group_id  is not null then  8 else 0 end)
                           + (case when scope_mechanic         is not null then  4 else 0 end)
                           + (case when scope_experience       is not null then  2 else 0 end)
                           + (case when scope_goal             is not null then  1 else 0 end)
                         ) stored,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint guideline_range_valid
    check (min_value is null or max_value is null or min_value <= max_value),
  constraint guideline_has_value
    check (min_value is not null or max_value is not null)
);

create index scientific_guidelines_lookup_idx
  on public.scientific_guidelines (category, specificity desc, priority desc)
  where is_active;

create trigger scientific_guidelines_updated_at before update on public.scientific_guidelines
  for each row execute function public.set_updated_at();

create table public.guideline_sources (
  guideline_id  uuid not null references public.scientific_guidelines(id) on delete cascade,
  source_id     uuid not null references public.scientific_sources(id) on delete cascade,
  primary key (guideline_id, source_id)
);

create index guideline_sources_source_idx on public.guideline_sources (source_id);

-- -----------------------------------------------------------------------------
-- 5. NUTZER, ASSESSMENT, PRÄFERENZEN
-- -----------------------------------------------------------------------------

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text,
  birth_year     smallint check (birth_year between 1900 and 2100),
  body_weight_kg numeric(5,2) check (body_weight_kg > 0),
  height_cm      numeric(5,1) check (height_cm > 0),
  unit_system    public.unit_system  not null default 'metric',
  effort_scale   public.effort_scale not null default 'rir',  -- Anzeige im Tracker
  timezone       text not null default 'Europe/Berlin',       -- für Wochengrenzen in Auswertungen
  onboarding_completed_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Onboarding-Fragebogen. Versioniert: jede Neubewertung = neue Zeile,
-- damit nachvollziehbar bleibt, auf welcher Basis ein Plan generiert wurde.
create table public.user_assessments (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  goal                   public.training_goal    not null,
  experience_level       public.experience_level not null,
  training_age_months    int check (training_age_months >= 0),
  days_per_week          smallint not null check (days_per_week between 1 and 7),
  session_duration_min   smallint not null check (session_duration_min between 15 and 240),
  preferred_split        public.split_type,          -- NULL = Algorithmus entscheidet
  priority_muscle_ids    uuid[] not null default '{}', -- Muskeln mit Extra-Volumen
  limitations            text,                         -- Freitext: Verletzungen etc.
  created_at             timestamptz not null default now()
);

create index user_assessments_user_idx on public.user_assessments (user_id, created_at desc);

create table public.user_equipment (
  user_id       uuid not null references auth.users(id) on delete cascade,
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  primary key (user_id, equipment_id)
);

create table public.user_exercise_preferences (
  user_id      uuid not null references auth.users(id) on delete cascade,
  exercise_id  uuid not null references public.exercises(id) on delete cascade,
  preference   public.exercise_preference not null,
  reason       text,
  primary key (user_id, exercise_id)
);

-- -----------------------------------------------------------------------------
-- 6. TRAININGSPLÄNE (SOLL)
-- -----------------------------------------------------------------------------

create table public.training_plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  assessment_id      uuid references public.user_assessments(id) on delete set null,
  parent_plan_id     uuid references public.training_plans(id) on delete set null, -- Herkunft bei Neugenerierung
  name               text not null,
  split_type         public.split_type    not null,
  goal               public.training_goal not null,
  status             public.plan_status   not null default 'draft',
  mesocycle_weeks    smallint not null default 5 check (mesocycle_weeks between 1 and 16),
  current_week       smallint not null default 1 check (current_week >= 1),
  generator_version  text,                          -- Version des Generierungs-Algorithmus
  started_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Höchstens ein aktiver Plan pro Nutzer
create unique index training_plans_one_active_idx
  on public.training_plans (user_id) where status = 'active';
create index training_plans_user_idx on public.training_plans (user_id, created_at desc);

create trigger training_plans_updated_at before update on public.training_plans
  for each row execute function public.set_updated_at();

create table public.plan_days (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.training_plans(id) on delete cascade,
  day_index   smallint not null check (day_index >= 0),  -- Reihenfolge im Mikrozyklus
  name        text not null,                             -- z. B. "Push A", "Upper 1"
  weekday     smallint check (weekday between 1 and 7),  -- optional: ISO-Wochentag
  unique (plan_id, day_index)
);

-- Die Übungsvorgabe (Soll) – Startwerte stammen aus den aufgelösten Richtwerten,
-- können aber vom Nutzer oder Adaptions-Algorithmus überschrieben werden.
create table public.plan_exercises (
  id                  uuid primary key default gen_random_uuid(),
  plan_day_id         uuid not null references public.plan_days(id) on delete cascade,
  exercise_id         uuid not null references public.exercises(id) on delete restrict,
  order_index         smallint not null check (order_index >= 0),
  superset_group      smallint,                    -- gleiche Nummer = Supersatz
  target_sets         smallint not null check (target_sets between 1 and 15),
  target_reps_min     smallint not null check (target_reps_min >= 1),
  target_reps_max     smallint not null,
  target_rir_min      numeric(3,1) check (target_rir_min between 0 and 10),
  target_rir_max      numeric(3,1) check (target_rir_max between 0 and 10),
  target_load_kg      numeric(6,2) check (target_load_kg >= 0),  -- vom Progressions-Algorithmus gepflegt
  rest_seconds        smallint not null check (rest_seconds between 0 and 900),
  progression_scheme  public.progression_scheme not null default 'double_progression',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (plan_day_id, order_index),
  constraint plan_exercise_rep_range_valid check (target_reps_min <= target_reps_max),
  constraint plan_exercise_rir_range_valid
    check (target_rir_min is null or target_rir_max is null or target_rir_min <= target_rir_max)
);

create index plan_exercises_exercise_idx on public.plan_exercises (exercise_id);

create trigger plan_exercises_updated_at before update on public.plan_exercises
  for each row execute function public.set_updated_at();

-- Protokoll aller (vorgeschlagenen) Plananpassungen – macht den Algorithmus
-- transparent und lässt den Nutzer Vorschläge annehmen/ablehnen.
create table public.plan_adaptations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  plan_id           uuid not null references public.training_plans(id) on delete cascade,
  plan_exercise_id  uuid references public.plan_exercises(id) on delete cascade,
  muscle_group_id   uuid references public.muscle_groups(id) on delete set null,
  type              public.adaptation_type   not null,
  reason            public.adaptation_reason not null,
  status            public.adaptation_status not null default 'suggested',
  before_state      jsonb,   -- z. B. {"target_load_kg": 80, "target_sets": 3}
  after_state       jsonb,   -- z. B. {"target_load_kg": 82.5}
  guideline_id      uuid references public.scientific_guidelines(id) on delete set null, -- auslösende Regel
  explanation       text,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index plan_adaptations_plan_idx on public.plan_adaptations (plan_id, created_at desc);
create index plan_adaptations_open_idx on public.plan_adaptations (user_id) where status = 'suggested';

-- -----------------------------------------------------------------------------
-- 7. TRAINING-LOGS (IST)
-- -----------------------------------------------------------------------------

create table public.workout_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  plan_id         uuid references public.training_plans(id) on delete set null,
  plan_day_id     uuid references public.plan_days(id) on delete set null,
  plan_week       smallint,                          -- Woche im Mesozyklus zum Zeitpunkt des Trainings
  status          public.session_status not null default 'in_progress',
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  session_rpe     numeric(3,1) check (session_rpe between 1 and 10), -- Gesamtbelastung (sRPE)
  body_weight_kg  numeric(5,2) check (body_weight_kg > 0),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint session_time_valid check (ended_at is null or ended_at >= started_at)
);

create index workout_sessions_user_idx on public.workout_sessions (user_id, started_at desc);
-- Höchstens ein laufendes Workout pro Nutzer
create unique index workout_sessions_one_running_idx
  on public.workout_sessions (user_id) where status = 'in_progress';

create trigger workout_sessions_updated_at before update on public.workout_sessions
  for each row execute function public.set_updated_at();

create table public.exercise_logs (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id       uuid not null references public.exercises(id) on delete restrict,
  plan_exercise_id  uuid references public.plan_exercises(id) on delete set null, -- NULL = spontan hinzugefügt
  order_index       smallint not null check (order_index >= 0),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index exercise_logs_session_idx on public.exercise_logs (session_id, order_index);
create index exercise_logs_exercise_idx on public.exercise_logs (exercise_id);

create trigger exercise_logs_updated_at before update on public.exercise_logs
  for each row execute function public.set_updated_at();

create table public.set_logs (
  id                uuid primary key default gen_random_uuid(),
  exercise_log_id   uuid not null references public.exercise_logs(id) on delete cascade,
  set_index         smallint not null check (set_index >= 0),
  set_type          public.set_type not null default 'working',
  weight_kg         numeric(6,2) check (weight_kg >= 0),           -- Zusatzlast bei Körpergewichtsübungen
  reps              smallint check (reps between 0 and 200),
  duration_seconds  smallint check (duration_seconds between 0 and 3600), -- für tracking_type = 'duration'
  rir               numeric(3,1) check (rir between 0 and 10),     -- RPE = 10 - RIR
  rest_seconds      smallint check (rest_seconds between 0 and 3600), -- tatsächliche Pause davor
  is_completed      boolean not null default false,
  completed_at      timestamptz,
  -- Geschätztes 1RM (Epley, RIR-korrigiert). Nur für 1–12 Wdh. und RIR <= 4
  -- aussagekräftig – RIR-Schätzungen weit weg vom Versagen sind zu ungenau.
  e1rm_kg           numeric(6,2) generated always as (
                      case
                        when reps between 1 and 12 and weight_kg > 0
                             and (rir is null or rir <= 4)
                        then round(weight_kg * (1 + (reps + coalesce(rir, 0)) / 30.0), 2)
                      end
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (exercise_log_id, set_index)
);

create trigger set_logs_updated_at before update on public.set_logs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 8. RICHTWERT-AUFLÖSUNG
-- -----------------------------------------------------------------------------

-- Liefert pro Kategorie genau EINE Regel: die spezifischste, die auf die Übung
-- (inkl. Mechanik, Bewegungsmuster, Primärmuskeln) und den Nutzerkontext passt.
create or replace function public.resolve_exercise_guidelines(
  p_exercise_id uuid,
  p_goal        public.training_goal,
  p_experience  public.experience_level
)
returns setof public.scientific_guidelines
language sql
stable
as $$
  select distinct on (g.category) g.*
  from public.scientific_guidelines g
  join public.exercises e on e.id = p_exercise_id
  where g.is_active
    and g.category in ('rep_range', 'rest_interval', 'proximity_to_failure', 'tempo', 'progression')
    and (g.scope_exercise_id      is null or g.scope_exercise_id      = e.id)
    and (g.scope_movement_pattern is null or g.scope_movement_pattern = e.movement_pattern)
    and (g.scope_mechanic         is null or g.scope_mechanic         = e.mechanic)
    and (g.scope_goal             is null or g.scope_goal             = p_goal)
    and (g.scope_experience       is null or g.scope_experience       = p_experience)
    and (g.scope_muscle_group_id  is null or exists (
           select 1 from public.exercise_muscles em
           where em.exercise_id = e.id
             and em.muscle_group_id = g.scope_muscle_group_id
             and em.role = 'primary'))
  order by g.category, g.specificity desc, g.priority desc, g.created_at;
$$;

-- Dasselbe für Richtwerte auf Muskel-Ebene (Wochenvolumen, Volumen pro Einheit, Frequenz)
create or replace function public.resolve_muscle_guidelines(
  p_muscle_group_id uuid,
  p_goal            public.training_goal,
  p_experience      public.experience_level
)
returns setof public.scientific_guidelines
language sql
stable
as $$
  select distinct on (g.category) g.*
  from public.scientific_guidelines g
  where g.is_active
    and g.category in ('weekly_volume', 'session_volume', 'frequency')
    and g.scope_exercise_id is null
    and g.scope_movement_pattern is null
    and g.scope_mechanic is null
    and (g.scope_muscle_group_id is null or g.scope_muscle_group_id = p_muscle_group_id)
    and (g.scope_goal            is null or g.scope_goal            = p_goal)
    and (g.scope_experience      is null or g.scope_experience      = p_experience)
  order by g.category, g.specificity desc, g.priority desc, g.created_at;
$$;

-- -----------------------------------------------------------------------------
-- 9. AUSWERTUNGS-VIEWS (security_invoker → RLS der Basistabellen greift)
-- -----------------------------------------------------------------------------

-- "Letztes Mal": die Arbeitssätze der jüngsten abgeschlossenen Einheit je Übung
create view public.exercise_last_performance
with (security_invoker = true) as
select distinct on (ws.user_id, el.exercise_id)
  ws.user_id,
  el.exercise_id,
  ws.id         as session_id,
  ws.started_at as performed_at,
  (
    select jsonb_agg(
             jsonb_build_object(
               'set_index', s.set_index,
               'set_type',  s.set_type,
               'weight_kg', s.weight_kg,
               'reps',      s.reps,
               'rir',       s.rir,
               'e1rm_kg',   s.e1rm_kg
             ) order by s.set_index)
    from public.set_logs s
    where s.exercise_log_id = el.id
      and s.is_completed
      and s.set_type <> 'warmup'
  ) as sets
from public.exercise_logs el
join public.workout_sessions ws on ws.id = el.session_id
where ws.status = 'completed'
  and exists (
    select 1 from public.set_logs s
    where s.exercise_log_id = el.id and s.is_completed and s.set_type <> 'warmup'
  )
order by ws.user_id, el.exercise_id, ws.started_at desc;

-- Verlauf je Übung und Einheit – Grundlage für Kraft-Charts und Stagnations-Erkennung
create view public.exercise_progress
with (security_invoker = true) as
select
  ws.user_id,
  el.exercise_id,
  ws.id                         as session_id,
  ws.started_at                 as performed_at,
  max(s.weight_kg)              as top_weight_kg,
  max(s.e1rm_kg)                as best_e1rm_kg,
  sum(s.weight_kg * s.reps)     as volume_load_kg,
  count(*)                      as working_sets,
  sum(s.reps)                   as total_reps
from public.set_logs s
join public.exercise_logs el    on el.id = s.exercise_log_id
join public.workout_sessions ws on ws.id = el.session_id
where ws.status = 'completed'
  and s.is_completed
  and s.set_type <> 'warmup'
group by ws.user_id, el.exercise_id, ws.id, ws.started_at;

-- Harte Sätze pro Muskelgruppe und Kalenderwoche (Zeitzone des Nutzers).
-- "Hart" = Arbeitssatz mit RIR <= 4 (oder ohne RIR-Angabe).
-- Sekundärmuskeln zählen anteilig über exercise_muscles.contribution.
create view public.weekly_muscle_volume
with (security_invoker = true) as
select
  ws.user_id,
  (date_trunc('week', ws.started_at at time zone p.timezone))::date as week_start,
  em.muscle_group_id,
  sum(em.contribution)                                     as hard_sets,
  sum(case when em.role = 'primary' then 1 else 0 end)     as direct_sets
from public.set_logs s
join public.exercise_logs el    on el.id = s.exercise_log_id
join public.workout_sessions ws on ws.id = el.session_id
join public.profiles p          on p.id = ws.user_id
join public.exercise_muscles em on em.exercise_id = el.exercise_id
where ws.status in ('in_progress', 'completed')
  and s.is_completed
  and s.set_type <> 'warmup'
  and (s.rir is null or s.rir <= 4)
group by ws.user_id, week_start, em.muscle_group_id;

-- -----------------------------------------------------------------------------
-- 10. AUTOMATISCHES PROFIL BEI REGISTRIERUNG
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

-- Katalog: für alle lesbar, Schreiben nur per Service-Role (umgeht RLS)
alter table public.muscle_groups         enable row level security;
alter table public.equipment             enable row level security;
alter table public.scientific_sources    enable row level security;
alter table public.scientific_guidelines enable row level security;
alter table public.guideline_sources     enable row level security;

create policy "catalog readable" on public.muscle_groups         for select using (true);
create policy "catalog readable" on public.equipment             for select using (true);
create policy "catalog readable" on public.scientific_sources    for select using (true);
create policy "catalog readable" on public.scientific_guidelines for select using (true);
create policy "catalog readable" on public.guideline_sources     for select using (true);

-- Übungen: Katalog + eigene Übungen lesbar, nur eigene schreibbar
alter table public.exercises          enable row level security;
alter table public.exercise_muscles   enable row level security;
alter table public.exercise_equipment enable row level security;

create policy "exercises readable" on public.exercises for select
  using (created_by is null or created_by = (select auth.uid()));
create policy "own exercises insert" on public.exercises for insert
  with check (created_by = (select auth.uid()));
create policy "own exercises update" on public.exercises for update
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "own exercises delete" on public.exercises for delete
  using (created_by = (select auth.uid()));

create policy "exercise muscles readable" on public.exercise_muscles for select
  using (exists (select 1 from public.exercises e where e.id = exercise_id));  -- RLS von exercises greift
create policy "own exercise muscles write" on public.exercise_muscles for all
  using (exists (select 1 from public.exercises e
                 where e.id = exercise_id and e.created_by = (select auth.uid())))
  with check (exists (select 1 from public.exercises e
                      where e.id = exercise_id and e.created_by = (select auth.uid())));

create policy "exercise equipment readable" on public.exercise_equipment for select
  using (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy "own exercise equipment write" on public.exercise_equipment for all
  using (exists (select 1 from public.exercises e
                 where e.id = exercise_id and e.created_by = (select auth.uid())))
  with check (exists (select 1 from public.exercises e
                      where e.id = exercise_id and e.created_by = (select auth.uid())));

-- Nutzereigene Tabellen mit user_id
alter table public.profiles                  enable row level security;
alter table public.user_assessments          enable row level security;
alter table public.user_equipment            enable row level security;
alter table public.user_exercise_preferences enable row level security;
alter table public.training_plans            enable row level security;
alter table public.plan_adaptations          enable row level security;
alter table public.workout_sessions          enable row level security;

create policy "own profile" on public.profiles for all
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own rows" on public.user_assessments for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.user_equipment for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.user_exercise_preferences for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.training_plans for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Bei Tabellen mit Verweis auf einen Plan wird zusätzlich geprüft, dass der Plan
-- dem Nutzer gehört (sonst könnte man Datensätze an fremde Pläne hängen).
create policy "own rows" on public.plan_adaptations for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.training_plans tp
                          where tp.id = plan_id and tp.user_id = (select auth.uid())));
create policy "own rows" on public.workout_sessions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and (plan_id is null or exists (select 1 from public.training_plans tp
                                              where tp.id = plan_id and tp.user_id = (select auth.uid()))));

-- Kindtabellen: Zugriff über den Eltern-Datensatz
alter table public.plan_days      enable row level security;
alter table public.plan_exercises enable row level security;
alter table public.exercise_logs  enable row level security;
alter table public.set_logs       enable row level security;

create policy "via plan" on public.plan_days for all
  using (exists (select 1 from public.training_plans tp
                 where tp.id = plan_id and tp.user_id = (select auth.uid())))
  with check (exists (select 1 from public.training_plans tp
                      where tp.id = plan_id and tp.user_id = (select auth.uid())));

create policy "via plan day" on public.plan_exercises for all
  using (exists (select 1 from public.plan_days pd
                 join public.training_plans tp on tp.id = pd.plan_id
                 where pd.id = plan_day_id and tp.user_id = (select auth.uid())))
  with check (exists (select 1 from public.plan_days pd
                      join public.training_plans tp on tp.id = pd.plan_id
                      where pd.id = plan_day_id and tp.user_id = (select auth.uid())));

create policy "via session" on public.exercise_logs for all
  using (exists (select 1 from public.workout_sessions ws
                 where ws.id = session_id and ws.user_id = (select auth.uid())))
  with check (exists (select 1 from public.workout_sessions ws
                      where ws.id = session_id and ws.user_id = (select auth.uid())));

create policy "via exercise log" on public.set_logs for all
  using (exists (select 1 from public.exercise_logs el
                 join public.workout_sessions ws on ws.id = el.session_id
                 where el.id = exercise_log_id and ws.user_id = (select auth.uid())))
  with check (exists (select 1 from public.exercise_logs el
                      join public.workout_sessions ws on ws.id = el.session_id
                      where el.id = exercise_log_id and ws.user_id = (select auth.uid())));
