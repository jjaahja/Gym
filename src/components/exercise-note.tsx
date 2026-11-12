"use client";

import { useState } from "react";
import { NoteIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles, pillStyles } from "@/components/ui";
import { NOTE_MAX, saveNote } from "@/lib/notes";
import { getDb } from "@/lib/offline/db";
import { writeToOutbox } from "@/lib/offline/sink";
import { useLiveQuery } from "@/lib/offline/use-live-query";
import { getCurrentUserId } from "@/lib/supabase/client";

/** Persönliche Notiz zu einer Übung (Geräteeinstellung, Griff …): Anzeige + Bearbeiten im Sheet. */
export function ExerciseNote({ exerciseId, exerciseName, variant = "inline" }: { exerciseId: string; exerciseName: string; variant?: "inline" | "button" }) {
  const note = useLiveQuery(() => getDb().notes.get(exerciseId), [exerciseId], undefined);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const edit = () => {
    setDraft(note?.note ?? "");
    setOpen(true);
  };
  const save = async () => {
    await saveNote(getDb(), exerciseId, draft, { userId: await getCurrentUserId(), sink: writeToOutbox });
    setOpen(false);
  };

  return (
    <>
      {variant === "button" && !note && (
        <button type="button" onClick={edit} className={`${pillStyles} text-accent`}>
          <NoteIcon className="size-4" /> Notiz
        </button>
      )}
      {note && (
        <button type="button" onClick={edit} className="flex w-full items-start gap-2 rounded-[0.75rem] bg-warning-bg px-3 py-2 text-left text-sm text-warning-fg">
          <NoteIcon className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1 whitespace-pre-line">{note.note}</span>
          <span className="sr-only">Notiz bearbeiten</span>
        </button>
      )}
      {variant === "inline" && !note && (
        <button type="button" onClick={edit} className={`${pillStyles} text-accent`}>
          <NoteIcon className="size-4" /> Notiz hinzufügen
        </button>
      )}
      {open && (
        <Sheet open onClose={() => setOpen(false)} title="Notiz">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-muted">Für {exerciseName} – erscheint bei jedem Training.</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, NOTE_MAX))}
                rows={4}
                autoFocus
                placeholder="z. B. Sitzhöhe 4, Griff weit, Kabel auf Stufe 2"
                className="field mt-2 block py-2.5"
              />
            </label>
            <p className="text-right text-xs text-muted">
              {draft.length}/{NOTE_MAX}
            </p>
            <button type="button" className={`${buttonStyles.primary} w-full`} onClick={() => void save()}>
              {draft.trim() ? "Speichern" : note ? "Notiz löschen" : "Schließen"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
