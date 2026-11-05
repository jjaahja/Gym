import { getDb } from "./db";
import { enqueue, type NewOutboxEntry } from "./outbox";
import { requestSync } from "./sync";

// Gemeinsamer Schreibweg aller Stores in die Outbox. Die Promise-Kette garantiert,
// dass Einträge in Aufruf-Reihenfolge landen – auch über Stores hinweg
// (Plan vor Session, Session vor Übung, Übung vor Satz).
let chain: Promise<void> = Promise.resolve();

export function writeToOutbox(entry: NewOutboxEntry): void {
  chain = chain
    .then(() => enqueue(getDb(), entry))
    .then(() => requestSync())
    .catch((err) => console.error("Outbox-Schreibfehler", err));
}

/** Wartet, bis alle bisher übergebenen Einträge geschrieben sind (z. B. vor dem Abmelden). */
export function outboxIdle(): Promise<void> {
  return chain;
}
