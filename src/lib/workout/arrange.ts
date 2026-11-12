// Reihenfolge und Supersätze im laufenden Training.
// Supersatz: zwei (oder drei) Übungen direkt nacheinander, Pause erst nach der letzten – spart Zeit, besonders bei
// Übungen für unterschiedliche Muskeln (z. B. Bizeps/Trizeps).

export interface SupersetInfo {
  /** „A1“, „A2“ … */
  label: string;
  /** nächste Übung im Supersatz (fehlt bei der letzten) */
  next: string | null;
  isLast: boolean;
}

/** Elemente nach gespeicherter Reihenfolge; unbekannte (neu hinzugefügte) hinten in ursprünglicher Reihenfolge. */
export function arrangeItems<T extends { key: string }>(items: readonly T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return [...items];
  const rank = new Map(order.map((k, i) => [k, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (rank.get(a.item.key) ?? order.length + a.i) - (rank.get(b.item.key) ?? order.length + b.i))
    .map(({ item }) => item);
}

/** Supersatz-Gruppen nur aus direkt aufeinanderfolgenden, vorhandenen Übungen (mind. 2). */
export function normalizeSupersets(orderedKeys: readonly string[], groups: readonly (readonly string[])[] | undefined): string[][] {
  const position = new Map(orderedKeys.map((k, i) => [k, i]));
  const result: string[][] = [];
  for (const group of groups ?? []) {
    const members = group.filter((k) => position.has(k)).sort((a, b) => position.get(a)! - position.get(b)!);
    // nur zusammenhängende Läufe behalten
    let run: string[] = [];
    for (const k of members) {
      if (run.length && position.get(k)! !== position.get(run.at(-1)!)! + 1) {
        if (run.length >= 2) result.push(run);
        run = [];
      }
      run.push(k);
    }
    if (run.length >= 2) result.push(run);
  }
  return result.sort((a, b) => position.get(a[0])! - position.get(b[0])!);
}

export function supersetInfo(orderedKeys: readonly string[], groups: readonly (readonly string[])[] | undefined): Map<string, SupersetInfo> {
  const info = new Map<string, SupersetInfo>();
  normalizeSupersets(orderedKeys, groups).forEach((group, g) => {
    const letter = String.fromCharCode(65 + (g % 26));
    group.forEach((key, i) => info.set(key, { label: `${letter}${i + 1}`, next: group[i + 1] ?? null, isLast: i === group.length - 1 }));
  });
  return info;
}

/** Übung mit der nächsten zu einem Supersatz verbinden bzw. die Verbindung lösen. */
export function toggleLink(orderedKeys: readonly string[], groups: readonly (readonly string[])[] | undefined, key: string): string[][] {
  const i = orderedKeys.indexOf(key);
  const nextKey = orderedKeys[i + 1];
  if (i < 0 || !nextKey) return normalizeSupersets(orderedKeys, groups);
  const current = normalizeSupersets(orderedKeys, groups);
  const linked = current.some((g) => g.includes(key) && g.includes(nextKey));
  if (linked) {
    // Gruppe an dieser Stelle teilen
    return current.flatMap((g) => {
      if (!g.includes(key) || !g.includes(nextKey)) return [g];
      const cut = g.indexOf(nextKey);
      return [g.slice(0, cut), g.slice(cut)].filter((part) => part.length >= 2);
    });
  }
  // verbinden: Gruppen beider Übungen zusammenführen (höchstens 3 Übungen je Supersatz)
  const a = current.find((g) => g.includes(key)) ?? [key];
  const b = current.find((g) => g.includes(nextKey)) ?? [nextKey];
  if (a.length + b.length > 3) return current;
  return normalizeSupersets(orderedKeys, [...current.filter((g) => g !== a && g !== b), [...a, ...b]]);
}

/** Eine Übung nach oben/unten verschieben; Supersätze bleiben zusammen, wenn möglich. */
export function move(orderedKeys: readonly string[], key: string, delta: -1 | 1): string[] {
  const i = orderedKeys.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= orderedKeys.length) return [...orderedKeys];
  const next = [...orderedKeys];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
