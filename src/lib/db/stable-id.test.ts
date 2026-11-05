import { describe, expect, it } from "vitest";
import { catalogId, uuidV5 } from "./stable-id";

const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("UUIDv5", () => {
  // Referenzwerte aus Pythons uuid.uuid5()
  it("stimmt mit der Referenzimplementierung überein", () => {
    expect(uuidV5("python.org", NAMESPACE_DNS)).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(catalogId("exercise", "barbell-bench-press")).toBe("72bc637a-e334-517b-89a0-03153fca2585");
  });

  it("verarbeitet Umlaute und lange Namen (mehrere SHA-1-Blöcke)", () => {
    const long = "übung:".repeat(40);
    expect(uuidV5(long, NAMESPACE_DNS)).toBe("c9c44c15-5736-5709-997c-d3baf3b1e4ce");
  });

  it("unterscheidet Arten mit gleichem Slug", () => {
    expect(catalogId("muscle", "chest")).not.toBe(catalogId("exercise", "chest"));
  });
});
