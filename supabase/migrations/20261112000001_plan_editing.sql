-- Plan selbst bearbeiten: Übung hinzufügen und Vorgabe ändern (Sätze, Wdh., RIR, Pause, Technik).
-- Wie das Entfernen im Anpassungsprotokoll festgehalten und rückgängig machbar:
--   add_exercise:  after_state.plan_exercise = neue Planübung, plan_day_id
--   edit_exercise: before_state.fields / after_state.fields = geänderte Felder
-- Supersätze im Plan nutzen die vorhandene Spalte plan_exercises.superset_group.
alter type public.adaptation_type add value if not exists 'add_exercise';
alter type public.adaptation_type add value if not exists 'edit_exercise';
