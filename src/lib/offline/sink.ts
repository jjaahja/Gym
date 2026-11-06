import { getDb } from "./db";
import { enqueueMany, type NewOutboxEntry } from "./outbox";
import { requestSync } from "./sync";

// Gemeinsamer Schreibweg aller Stores in die Outbox. Einträge einer Aktion (z. B. Plan anlegen: ~60 Zeilen)
// werden gesammelt und in EINER IndexedDB-Transaktion geschrieben – schnell und alles oder nichts, damit ein
// sofortiges Schließen der App keine halben Pläne hinterlässt. Die Promise-Kette hält die Reihenfolge über
// Aktionen und Stores hinweg (Plan vor Session, Session vor Übung, Übung vor Satz).
let chain: Promise<void> = Promise.resolve();
let buffer: NewOutboxEntry[] = [];
let scheduled = false;

export function writeToOutbox(entry: NewOutboxEntry): void {
  buffer.push(entry);
  if (scheduled) return;
  scheduled = true;
  // Mikrotask: alle synchron ausgelösten Einträge derselben Aktion landen im selben Bündel
  queueMicrotask(() => {
    const batch = buffer;
    buffer = [];
    scheduled = false;
    chain = chain
      .then(() => enqueueMany(getDb(), batch))
      .then(() => requestSync())
      .catch((err) => console.error("Outbox-Schreibfehler", err));
  });
}

/** Wartet, bis alle bisher übergebenen Einträge geschrieben sind (z. B. vor dem Abmelden). */
export async function outboxIdle(): Promise<void> {
  // gesammelte, noch nicht eingeplante Einträge zuerst einplanen lassen
  await Promise.resolve();
  return chain;
}
