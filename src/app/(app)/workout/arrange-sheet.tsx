"use client";

import { useState } from "react";
import { LinkIcon } from "@/components/icons";
import { Sheet } from "@/components/sheet";
import { buttonStyles } from "@/components/ui";
import { move, normalizeSupersets, supersetInfo, toggleLink } from "@/lib/workout/arrange";
import { workoutStore } from "@/stores/workout";

/** Reihenfolge ändern und Übungen zu Supersätzen verbinden (nur für dieses Training). */
export function ArrangeSheet({
  onClose,
  items,
  supersets,
}: {
  onClose: () => void;
  items: readonly { key: string; name: string }[];
  supersets: readonly (readonly string[])[];
}) {
  const names = new Map(items.map((i) => [i.key, i.name]));
  const [order, setOrder] = useState(() => items.map((i) => i.key));
  const [groups, setGroups] = useState(() => normalizeSupersets(order, supersets));
  const info = supersetInfo(order, groups);

  const save = () => {
    workoutStore.getState().arrange(order, normalizeSupersets(order, groups));
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Reihenfolge & Supersätze">
      <p className="mb-3 text-sm text-muted">
        Mit den Pfeilen verschieben. Das Ketten-Symbol verbindet eine Übung mit der nächsten zum Supersatz – die Pause kommt
        dann erst nach der letzten Übung der Gruppe.
      </p>
      <ol className="space-y-1">
        {order.map((key, i) => {
          const s = info.get(key);
          const linked = Boolean(s && !s.isLast);
          return (
            <li key={key}>
              <div className="flex items-center gap-2 rounded-[0.875rem] bg-surface px-3 py-2 shadow-card">
                <span className="w-7 shrink-0 text-center text-xs font-bold text-accent">{s?.label ?? ""}</span>
                <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{names.get(key)}</span>
                <button
                  type="button"
                  aria-label={`${names.get(key)} nach oben`}
                  disabled={i === 0}
                  onClick={() => setOrder((o) => move(o, key, -1))}
                  className="grid size-9 place-items-center rounded-full bg-surface-2 text-lg disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${names.get(key)} nach unten`}
                  disabled={i === order.length - 1}
                  onClick={() => setOrder((o) => move(o, key, 1))}
                  className="grid size-9 place-items-center rounded-full bg-surface-2 text-lg disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
              {i < order.length - 1 && (
                <div className="flex justify-center py-0.5">
                  <button
                    type="button"
                    aria-pressed={linked}
                    aria-label={linked ? `Supersatz mit ${names.get(order[i + 1])} lösen` : `Mit ${names.get(order[i + 1])} als Supersatz verbinden`}
                    onClick={() => setGroups((g) => toggleLink(order, g, key))}
                    className={`flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${
                      linked ? "bg-accent text-accent-fg" : "text-muted"
                    }`}
                  >
                    <LinkIcon className="size-3.5" />
                    {linked ? "Supersatz" : "verbinden"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className={`${buttonStyles.primary} mt-4 w-full`} onClick={save}>
        Übernehmen
      </button>
    </Sheet>
  );
}
