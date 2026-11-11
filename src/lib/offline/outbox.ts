import type { SupabaseClient } from "@supabase/supabase-js";
import type { GymDB, OutboxEntry } from "./db";

export type NewOutboxEntry = Pick<OutboxEntry, "table" | "op" | "rowId" | "payload">;

/** Ziel der Synchronisierung – in der App Supabase, in Tests ein Fake. */
export interface SyncBackend {
  upsert(table: string, row: Record<string, unknown>): Promise<void>;
  remove(table: string, match: Record<string, unknown>): Promise<void>;
  /** Mehrere Zeilen derselben Tabelle in einer Anfrage (optional) */
  upsertMany?(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

/** Höchstens so viele Zeilen je Anfrage */
export const MAX_BATCH = 200;

const KEY_COLUMNS: Record<string, string[]> = { user_equipment: ["user_id", "equipment_id"] };
const rowKey = (table: string, row: Record<string, unknown>) =>
  (KEY_COLUMNS[table] ?? ["id"]).map((k) => String(row[k])).join(":");
const columnsOf = (row: Record<string, unknown>) => Object.keys(row).sort().join(",");

/**
 * Aufeinanderfolgende Upserts derselben Tabelle mit denselben Spalten werden zu einer Anfrage gebündelt.
 * Die Reihenfolge zwischen Tabellen bleibt erhalten (Training → Übung → Satz). Mehrfache Versionen derselben
 * Zeile innerhalb eines Bündels: die letzte gilt – wie bei einzelner Übertragung (Postgres erlaubt dieselbe
 * Zeile nicht zweimal in einem Upsert).
 */
export function nextBatch(entries: readonly OutboxEntry[]): OutboxEntry[] {
  const first = entries[0];
  if (!first) return [];
  if (first.op !== "upsert") return [first];
  const columns = columnsOf(first.payload);
  const batch: OutboxEntry[] = [];
  for (const e of entries) {
    if (e.op !== "upsert" || e.table !== first.table || columnsOf(e.payload) !== columns || batch.length >= MAX_BATCH) break;
    batch.push(e);
  }
  return batch;
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
 * Einträge VOR alle wartenden stellen (eine Transaktion). Für fehlende Eltern-Zeilen: Kennt der Server den Plan
 * nicht, scheitern wartende Trainings an der Zugriffsregel (Plan muss dem Nutzer gehören) – und die Outbox hängt,
 * weil sie strikt in Reihenfolge überträgt. Wartende Einträge, die die neuen ersetzen (dieselbe Zeile; bei
 * `user_equipment` alle, da die neuen die Ausstattung komplett setzen), fallen weg – sonst würde danach ein älterer
 * Stand übertragen. Profile bleiben: Deren Einträge setzen unterschiedliche Spalten.
 */
export async function prependMany(db: GymDB, entries: readonly NewOutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const replaced = new Set(entries.filter((e) => e.table !== "profiles").map((e) => `${e.table}|${e.rowId}`));
  const resetsEquipment = entries.some((e) => e.table === "user_equipment");
  const createdAt = Date.now();
  await db.transaction("rw", db.outbox, async () => {
    const pending = await db.outbox.orderBy("seq").toArray();
    const kept = pending.filter(
      (e) => !replaced.has(`${e.table}|${e.rowId}`) && !(resetsEquipment && e.table === "user_equipment"),
    );
    await db.outbox.clear();
    await db.outbox.bulkAdd([
      ...entries.map((e) => ({ ...e, createdAt, attempts: 0 })),
      // ohne seq: neu nummeriert, damit sie hinter den vorangestellten Einträgen liegen
      ...kept.map((e) => ({ ...e, seq: undefined })),
    ]);
  });
}

/** Mehrere Einträge in einer Transaktion – Reihenfolge bleibt erhalten, alles oder nichts. */
export async function enqueueMany(db: GymDB, entries: readonly NewOutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const createdAt = Date.now();
  await db.outbox.bulkAdd(entries.map((e) => ({ ...e, createdAt, attempts: 0 })));
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

  for (let i = 0; i < entries.length; ) {
    const batch = backend.upsertMany ? nextBatch(entries.slice(i)) : [entries[i]];
    const entry = batch[0];
    try {
      if (batch.length > 1) {
        const rows = new Map<string, Record<string, unknown>>();
        for (const e of batch) {
          const key = rowKey(e.table, e.payload);
          rows.delete(key); // Position der letzten Version übernehmen
          rows.set(key, e.payload);
        }
        await backend.upsertMany!(entry.table, [...rows.values()]);
      } else if (entry.op === "upsert") {
        await backend.upsert(entry.table, entry.payload);
      } else {
        const match = Object.keys(entry.payload).length > 0 ? entry.payload : { id: entry.rowId };
        await backend.remove(entry.table, match);
      }
      await db.outbox.bulkDelete(batch.map((e) => e.seq!));
      synced += batch.length;
      i += batch.length;
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
    async upsertMany(table, rows) {
      // Alle Zeilen haben dieselben Spalten (nextBatch) – nichts wird mit NULL aufgefüllt
      const { error } = await client.from(table).upsert(rows);
      if (error) throw new Error(error.message);
    },
    async remove(table, match) {
      const { error } = await client.from(table).delete().match(match);
      if (error) throw new Error(error.message);
    },
  };
}
