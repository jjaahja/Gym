// Spiegel der Postgres-Enums aus supabase/migrations/*_initial_schema.sql.
// Wird von src/lib/db/enums.test.ts gegen das SQL geprüft – bei Schemaänderungen beide anpassen.

export const DB_ENUMS = {
  training_goal: ["hypertrophy", "strength", "endurance"],
  experience_level: ["beginner", "intermediate", "advanced"],
  split_type: ["full_body", "upper_lower", "push_pull_legs", "custom"],
  body_region: ["upper", "lower", "core"],
  muscle_role: ["primary", "secondary"],
  exercise_mechanic: ["compound", "isolation"],
  exercise_tracking: ["weight_reps", "bodyweight_reps", "duration"],
  laterality: ["bilateral", "unilateral"],
  resistance_profile: ["lengthened", "mid_range", "shortened"],
  movement_pattern: ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "squat", "hinge", "lunge", "hip_extension", "knee_extension", "knee_flexion", "hip_abduction", "hip_adduction", "ankle_plantarflexion", "elbow_flexion", "elbow_extension", "shoulder_abduction", "shoulder_horizontal_adduction", "shoulder_horizontal_abduction", "shoulder_extension", "core_anti_extension", "core_flexion", "core_rotation", "carry"],
  guideline_category: ["rep_range", "rest_interval", "proximity_to_failure", "tempo", "progression", "autoregulation", "range_of_motion", "intensity_technique", "attentional_focus", "weekly_volume", "session_volume", "frequency", "volume_progression", "exercise_variation", "deload"],
  guideline_unit: ["reps", "seconds", "rir", "sets_per_week", "sets_per_session", "sessions_per_week", "percent_1rm", "weeks", "kg", "percent", "sets_per_exercise", "qualitative"],
  guideline_severity: ["info", "tip", "warning"],
  guideline_context: ["onboarding", "plan_builder", "exercise_detail", "workout_tracker", "analytics"],
  evidence_grade: ["strong", "moderate", "limited", "expert_opinion"],
  source_type: ["meta_analysis", "systematic_review", "rct", "observational", "position_stand", "narrative_review", "expert_consensus"],
  plan_status: ["draft", "active", "archived"],
  progression_scheme: ["double_progression", "linear", "rir_autoregulated"],
  session_status: ["in_progress", "completed", "abandoned"],
  set_type: ["warmup", "working", "backoff", "amrap", "dropset", "myo_reps", "rest_pause", "lengthened_partials"],
  adaptation_type: ["increase_load", "decrease_load", "add_set", "remove_set", "change_rep_range", "swap_exercise", "deload"],
  adaptation_reason: ["progression_achieved", "stagnation", "regression", "high_fatigue", "volume_below_min", "volume_above_max", "user_request", "stimulus_feedback", "mesocycle_end"],
  adaptation_status: ["suggested", "accepted", "rejected", "auto_applied", "reverted"],
  exercise_preference: ["favorite", "avoid"],
  effort_scale: ["rir", "rpe"],
  unit_system: ["metric", "imperial"],
} as const;

type EnumOf<K extends keyof typeof DB_ENUMS> = (typeof DB_ENUMS)[K][number];

export type TrainingGoal = EnumOf<"training_goal">;
export type ExperienceLevel = EnumOf<"experience_level">;
export type SplitType = EnumOf<"split_type">;
export type BodyRegion = EnumOf<"body_region">;
export type MuscleRole = EnumOf<"muscle_role">;
export type ExerciseMechanic = EnumOf<"exercise_mechanic">;
export type ExerciseTracking = EnumOf<"exercise_tracking">;
export type Laterality = EnumOf<"laterality">;
export type ResistanceProfile = EnumOf<"resistance_profile">;
export type MovementPattern = EnumOf<"movement_pattern">;
export type GuidelineCategory = EnumOf<"guideline_category">;
export type GuidelineUnit = EnumOf<"guideline_unit">;
export type GuidelineSeverity = EnumOf<"guideline_severity">;
export type GuidelineContext = EnumOf<"guideline_context">;
export type EvidenceGrade = EnumOf<"evidence_grade">;
export type SourceType = EnumOf<"source_type">;
export type PlanStatus = EnumOf<"plan_status">;
export type ProgressionScheme = EnumOf<"progression_scheme">;
export type SessionStatus = EnumOf<"session_status">;
export type SetType = EnumOf<"set_type">;
export type AdaptationType = EnumOf<"adaptation_type">;
export type AdaptationReason = EnumOf<"adaptation_reason">;
export type AdaptationStatus = EnumOf<"adaptation_status">;
export type ExercisePreference = EnumOf<"exercise_preference">;
export type EffortScale = EnumOf<"effort_scale">;
export type UnitSystem = EnumOf<"unit_system">;
