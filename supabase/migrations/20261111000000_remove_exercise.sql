-- Übung auf Wunsch dauerhaft aus dem Plan entfernen (im Training: „Auch aus dem Plan“).
-- Wie ein Übungswechsel im Anpassungsprotokoll festgehalten und rückgängig machbar; before_state enthält die
-- vollständige Planübung und den Trainingstag.
alter type public.adaptation_type add value if not exists 'remove_exercise';
