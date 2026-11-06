import { afterEach, describe, expect, it, vi } from "vitest";

// Capacitor-Plugins sind Proxys, die auf jede Eigenschaft antworten – auch auf `then`.
// Wird so ein Proxy aus einer async-Funktion zurückgegeben, bricht es ("Health.then() is not implemented on android").
vi.mock("@capgo/capacitor-health", () => {
  const calls: string[] = [];
  const Health = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") throw new Error('"Health.then()" is not implemented on android');
        if (prop === "__calls") return calls;
        return async (options?: unknown) => {
          calls.push(String(prop));
          if (prop === "isAvailable") return { available: true, platform: "android" };
          if (prop === "requestAuthorization") return { readAuthorized: ["weight"], readDenied: ["bodyFat"], writeAuthorized: [], writeDenied: [] };
          return options ?? {};
        };
      },
    },
  );
  return { Health };
});

const storage = new Map<string, string>();

describe("Plugin-Aufrufe in der Android-App", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("funktionieren mit dem Plugin-Proxy (kein await auf den Proxy selbst)", async () => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    });
    const hc = await import("./health-connect");
    expect(hc.isAndroidApp()).toBe(true);
    await expect(hc.availability()).resolves.toEqual({ available: true });
    await expect(hc.connect()).resolves.toBe(true); // Gewicht erlaubt reicht
    expect(hc.readState().connected).toBe(true);
    await expect(hc.openSettings()).resolves.toBeUndefined();
    const { Health } = (await import("@capgo/capacitor-health")) as unknown as { Health: { __calls: string[] } };
    expect(Health.__calls).toEqual(["isAvailable", "requestAuthorization", "openHealthConnectSettings"]);
  });
});
