import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("lässt interne Pfade durch", () => {
    expect(safeNextPath("/workout")).toBe("/workout");
    expect(safeNextPath("/exercises/bench-press?tab=guide")).toBe("/exercises/bench-press?tab=guide");
  });

  it("blockt externe Ziele", () => {
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
  });

  it("nutzt den Fallback bei leerem Wert", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
  });
});
