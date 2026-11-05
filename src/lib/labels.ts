import type {
  ExerciseMechanic,
  ExperienceLevel,
  MuscleRole,
  ResistanceProfile,
  SetType,
  TrainingGoal,
} from "@/lib/db/enums";

// Deutsche Anzeigetexte für Enum-Werte.

export const MECHANIC_LABELS: Record<ExerciseMechanic, string> = {
  compound: "Grundübung",
  isolation: "Isolationsübung",
};

export const DIFFICULTY_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Einsteiger",
  intermediate: "Fortgeschritten",
  advanced: "Erfahren",
};

export const PROFILE_LABELS: Record<ResistanceProfile, string> = {
  lengthened: "Dehnungsfokus",
  mid_range: "Schwerpunkt Mitte",
  shortened: "Schwerpunkt Kontraktion",
};

export const ROLE_LABELS: Record<MuscleRole, string> = {
  primary: "Hauptmuskel",
  secondary: "Mitbeansprucht",
};

export const GOAL_LABELS: Record<TrainingGoal, string> = {
  hypertrophy: "Muskelaufbau & Optik",
  strength: "Maximalkraft",
  endurance: "Kraftausdauer",
};

export const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: "Aufwärmsatz",
  working: "Arbeitssatz",
  backoff: "Back-off-Satz",
  amrap: "AMRAP",
  dropset: "Dropsatz",
  myo_reps: "Myo-Reps",
  rest_pause: "Rest-Pause",
  lengthened_partials: "Teilwiederholungen in Dehnung",
};
