import type { NewOutboxEntry } from "./outbox";
import type { RemoteState } from "./remote";

// Test-Doppel für Supabase: wendet Outbox-Einträge wie `insert … on conflict do update` an und liefert
// die Zeilen im Format von PostgREST (Zeitstempel „+00:00“, eingebettete Kindtabellen).

type Row = Record<string, unknown>;

const KEYS: Record<string, string[]> = { user_equipment: ["user_id", "equipment_id"] };
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** So gibt Postgres timestamptz in JSON aus: ohne „.000“, mit „+00:00“. */
export function pgTimestamp(value: string): string {
  const [base, ms] = new Date(value).toISOString().slice(0, -1).split(".");
  return `${base}${ms && ms !== "000" ? `.${ms.replace(/0+$/, "")}` : ""}+00:00`;
}

const format = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && ISO_UTC.test(v) ? pgTimestamp(v) : v]));

export class FakeServer {
  private tables = new Map<string, Map<string, Row>>();

  apply(entry: NewOutboxEntry): void {
    const keys = KEYS[entry.table] ?? ["id"];
    const table = this.tables.get(entry.table) ?? new Map<string, Row>();
    this.tables.set(entry.table, table);
    if (entry.op === "upsert") {
      const key = keys.map((k) => String(entry.payload[k])).join(":");
      table.set(key, { ...table.get(key), ...entry.payload });
    } else {
      const match = Object.keys(entry.payload).length ? entry.payload : { id: entry.rowId };
      for (const [key, row] of table) if (Object.entries(match).every(([k, v]) => row[k] === v)) table.delete(key);
    }
  }

  rows(table: string): Row[] {
    return [...(this.tables.get(table)?.values() ?? [])].map(format);
  }

  /** Was `fetchRemoteState` für diesen Nutzer liefern würde. */
  state(userId: string): RemoteState {
    const own = (table: string) => this.rows(table).filter((r) => r.user_id === userId);
    const plan = own("training_plans").find((p) => p.status === "active");
    const nestPlan = (p: Row) => ({
      ...p,
      plan_days: this.rows("plan_days")
        .filter((d) => d.plan_id === p.id)
        .map((d) => ({ ...d, plan_exercises: this.rows("plan_exercises").filter((e) => e.plan_day_id === d.id) })),
    });
    const sessions = own("workout_sessions")
      .filter((s) => s.status === "completed")
      .map((s) => ({
        ...s,
        exercise_logs: this.rows("exercise_logs")
          .filter((l) => l.session_id === s.id)
          .map((l) => ({ ...l, set_logs: this.rows("set_logs").filter((x) => x.exercise_log_id === l.id) })),
      }));
    const profile = own("profiles")[0] ?? this.rows("profiles").find((p) => p.id === userId);
    return {
      profile: profile
        ? { unit_system: (profile.unit_system as never) ?? "metric", effort_scale: (profile.effort_scale as never) ?? "rir" }
        : null,
      plan: plan ? (nestPlan(plan) as never) : null,
      assessment: plan ? ((this.rows("user_assessments").find((a) => a.id === plan.assessment_id) as never) ?? null) : null,
      equipmentIds: own("user_equipment").map((e) => String(e.equipment_id)),
      adaptations: plan ? (own("plan_adaptations").filter((a) => a.plan_id === plan.id) as never) : [],
      sessions: sessions as never,
      measurements: own("body_measurements") as never,
    };
  }
}
