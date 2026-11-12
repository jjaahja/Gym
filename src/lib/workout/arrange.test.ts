import { describe, expect, it } from "vitest";
import { arrangeItems, move, normalizeSupersets, supersetInfo, toggleLink } from "./arrange";

const items = ["a", "b", "c", "d"].map((key) => ({ key }));

describe("Reihenfolge und Supersätze", () => {
  it("sortiert nach gespeicherter Reihenfolge, neue Übungen hinten", () => {
    expect(arrangeItems([...items, { key: "x" }], ["c", "a", "d", "b"]).map((i) => i.key)).toEqual(["c", "a", "d", "b", "x"]);
    expect(arrangeItems(items, undefined).map((i) => i.key)).toEqual(["a", "b", "c", "d"]);
    expect(move(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  it("verbindet mit der nächsten Übung (max. 3) und löst wieder", () => {
    const keys = ["a", "b", "c", "d"];
    let groups = toggleLink(keys, [], "a");
    expect(groups).toEqual([["a", "b"]]);
    groups = toggleLink(keys, groups, "b");
    expect(groups).toEqual([["a", "b", "c"]]);
    expect(toggleLink(keys, groups, "c")).toEqual([["a", "b", "c"]]); // vierte nicht
    expect(toggleLink(keys, groups, "a")).toEqual([["b", "c"]]);
    expect(toggleLink(keys, [], "d")).toEqual([]); // letzte hat keine nächste
  });

  it("Gruppen nur aus direkt aufeinanderfolgenden Übungen; Bezeichnungen A1/A2, B1/B2", () => {
    expect(normalizeSupersets(["a", "c", "b", "d"], [["a", "b"]])).toEqual([]);
    const info = supersetInfo(["a", "b", "c", "d"], [["c", "d"], ["a", "b"]]);
    expect(info.get("a")).toEqual({ label: "A1", next: "b", isLast: false });
    expect(info.get("b")).toEqual({ label: "A2", next: null, isLast: true });
    expect(info.get("c")?.label).toBe("B1");
  });
});
