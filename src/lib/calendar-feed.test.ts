import { describe, expect, it } from "vitest";
import { feedUrls, newToken } from "./calendar-feed";

describe("Kalender-Abo-Link", () => {
  it("erzeugt 43 Zeichen Base64url aus 32 Zufallsbytes – passend zur Prüfung in der Datenbank", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(newToken((b) => b.fill(255))).toBe("_".repeat(42) + "8");
  });

  it("baut Links für Apple (webcal) und Google Kalender", () => {
    const urls = feedUrls("https://gym-alpha-flax.vercel.app", "abc");
    expect(urls.https).toBe("https://gym-alpha-flax.vercel.app/api/calendar/abc.ics");
    expect(urls.webcal).toBe("webcal://gym-alpha-flax.vercel.app/api/calendar/abc.ics");
    expect(urls.google).toBe(
      "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fgym-alpha-flax.vercel.app%2Fapi%2Fcalendar%2Fabc.ics",
    );
  });
});
