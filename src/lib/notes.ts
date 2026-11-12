import type { GymDB } from "@/lib/offline/db";
import type { NewOutboxEntry } from "@/lib/offline/outbox";

// Notizen je Übung (z. B. „Sitzhöhe 4, Griff weit“) – lokal sofort, über die Outbox auf alle Geräte.

export const NOTE_MAX = 500;

export async function saveNote(
  db: GymDB,
  exerciseId: string,
  text: string,
  options: { userId: string | null; sink: (entry: NewOutboxEntry) => void; now?: Date },
): Promise<void> {
  const note = text.trim().slice(0, NOTE_MAX);
  const updatedAt = (options.now ?? new Date()).toISOString();
  if (!note) {
    await db.notes.delete(exerciseId);
    if (options.userId)
      options.sink({ table: "exercise_notes", op: "delete", rowId: exerciseId, payload: { user_id: options.userId, exercise_id: exerciseId } });
    return;
  }
  await db.notes.put({ exerciseId, note, updatedAt });
  if (options.userId)
    options.sink({
      table: "exercise_notes",
      op: "upsert",
      rowId: exerciseId,
      payload: { user_id: options.userId, exercise_id: exerciseId, note, updated_at: updatedAt },
    });
}
