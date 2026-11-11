import { describe, expect, it } from "vitest";
import { apkUrl, fetchLatest, isRelease, updateAvailable, type Release } from "./app-update";

const release: Release = {
  versionCode: 3,
  versionName: "1.2",
  file: "gym-1.2.apk",
  sha256: "a".repeat(64),
  size: 5_000_000,
  date: "2026-11-11",
  notes: ["Updates direkt in der App"],
};

describe("App-Update", () => {
  it("erkennt neuere Versionen; alte Apps ohne Update-Funktion bekommen immer den Hinweis", () => {
    expect(updateAvailable({ kind: "app", versionCode: 2, versionName: "1.1", canInstall: true }, release)).toBe(true);
    expect(updateAvailable({ kind: "app", versionCode: 3, versionName: "1.2", canInstall: true }, release)).toBe(false);
    expect(updateAvailable({ kind: "app", versionCode: 4, versionName: "1.3", canInstall: true }, release)).toBe(false);
    expect(updateAvailable({ kind: "legacy" }, release)).toBe(true);
    expect(updateAvailable({ kind: "browser" }, release)).toBe(false);
    expect(updateAvailable(null, release)).toBe(false);
  });

  it("akzeptiert nur gültige Versionsangaben (Dateiname, Prüfsumme)", () => {
    expect(isRelease(release)).toBe(true);
    expect(isRelease({ ...release, file: "../evil.apk" })).toBe(false);
    expect(isRelease({ ...release, file: "https://evil.example/x.apk" })).toBe(false);
    expect(isRelease({ ...release, sha256: "xyz" })).toBe(false);
    expect(isRelease(null)).toBe(false);
  });

  it("lädt version.json ohne Cache und baut die absolute APK-Adresse", async () => {
    let init: RequestInit | undefined;
    const ok = (async (_: RequestInfo | URL, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify(release));
    }) as typeof fetch;
    expect(await fetchLatest(ok)).toEqual(release);
    expect(init?.cache).toBe("no-store");
    expect(await fetchLatest((async () => new Response("nope", { status: 404 })) as typeof fetch)).toBeNull();
    expect(apkUrl(release, "https://gym-alpha-flax.vercel.app")).toBe("https://gym-alpha-flax.vercel.app/downloads/gym-1.2.apk");
  });
});
