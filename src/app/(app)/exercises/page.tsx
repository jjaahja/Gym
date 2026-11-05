import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { exercises, getEquipment, getMuscle, primaryMuscles } from "@/lib/catalog";
import { ExerciseBrowser, type ExerciseListItem } from "./exercise-browser";

export const metadata: Metadata = { title: "Übungen" };

export default function ExercisesPage() {
  const items: ExerciseListItem[] = exercises
    .map((e) => {
      const primary = primaryMuscles(e);
      return {
        slug: e.slug,
        name: e.nameDe,
        primary: primary.map((m) => getMuscle(m).nameDe),
        muscleSlugs: primary,
        sortKey: getMuscle(primary[0]).sortOrder,
        equipment: e.equipment.length ? e.equipment.map((x) => getEquipment(x).nameDe).join(", ") : "Ohne Equipment",
        mechanic: e.mechanic,
        lengthened: e.resistanceProfile === "lengthened",
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, "de"));

  return (
    <>
      <PageHeader title="Übungen" subtitle={`${items.length} Übungen mit Ausführung, Muskeln und Richtwerten`} />
      <ExerciseBrowser items={items} />
    </>
  );
}
