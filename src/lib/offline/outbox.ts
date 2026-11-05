import type { SupabaseClient } from "@supabase/supabase-js";
import type { GymDB, OutboxEntry } from "./db";

export type NewOutboxEntry = Pick<OutboxEntry, "table" | "op" | "rowId" | "payload">;

/** Ziel der Synchronisierung – in der App Supabase, in Tests ein Fake. */
export interface SyncBackend {
  upsert(table: string, row: Record<string, unknown>): Promise<void>;
  remove(table: string, id: string): Promise<void>;
}

export interface FlushResult {
  synced: number;
  remaining: number;
  error?: string;
}

export async function enqueue(db: GymDB, entry: NewOutboxEntry): Promise<void> {
  await db.outbox.add({ ...entry, createdAt: Date.now(), attempts: 0 });
}

/**
 * Überträgt die Outbox strikt in Reihenfolge. Beim ersten Fehler wird abgebrochen,
 * damit abhängige Zeilen (Satz → Übung → Session) nie vor ihren Eltern ankommen.
 * Bewusst KEIN Zusammenfassen mehrerer Upserts derselben Zeile: Das würde z. B. die
 * erste Session-Zeile überspringen, bevor die Übungen darauf verweisen.
 */
export async function flushOutbox(db: GymDB, backend: SyncBackend): Promise<FlushResult> {
  const entries = await db.outbox.orderBy("seq").toArray();
  let synced = 0;

  for (const entry of entries) {
    try {
      if (entry.op === "upsert") {
        await backend.upsert(entry.table, entry.payload);
      } else {
        await backend.remove(entry.table, entry.rowId);
      }
      await db.outbox.delete(entry.seq!);
      synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.outbox.update(entry.seq!, { attempts: entry.attempts + 1, lastError: message });
      return { synced, remaining: await db.outbox.count(), error: message };
    }
  }

  return { synced, remaining: await db.outbox.count() };
}

let running: Promise<FlushResult> | null = null;

/** Verhindert parallele Flushes (z. B. "online"-Event und Intervall gleichzeitig). */
export function flushOutboxOnce(db: GymDB, backend: SyncBackend): Promise<FlushResult> {
  running ??= flushOutbox(db, backend).finally(() => {
    running = null;
  });
  return running;
}

export function supabaseBackend(client: SupabaseClient): SyncBackend {
  return {
    async upsert(table, row) {
      const { error } = await client.from(table).upsert(row);
      if (error) throw new Error(error.message);
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
