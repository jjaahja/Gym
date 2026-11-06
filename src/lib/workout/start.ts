import { mesocyclePosition, type StoredPlan } from "@/stores/plan-store";

/** Startoptionen für ein Training: Planbezug, Woche im Mesozyklus und ob gerade Deload-Woche ist. */
export function startOptions(plan: StoredPlan | null, dayId: string | null, now = new Date()) {
  if (!plan || !dayId) return { planId: null, planDayId: null };
  const position = mesocyclePosition(plan, now);
  return { planId: plan.id, planDayId: dayId, planWeek: position.week, deload: position.deload };
}
