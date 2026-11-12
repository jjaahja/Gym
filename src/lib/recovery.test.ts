import { describe, expect, it } from "vitest";
import { assessRecovery, formatSleep, type DayValue } from "./recovery";

const days = (from: string, values: number[]): DayValue[] =>
  values.map((value, i) => {
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { day: d.toISOString().slice(0, 10), value };
  });

describe("Erholung", () => {
  const today = "2026-11-12";
  const normalSleep = days("2026-10-29", Array(14).fill(450)); // 7,5 h bis gestern
  const normalRhr = days("2026-10-29", Array(14).fill(56));

  it("ohne Daten kein Hinweis", () => {
    expect(assessRecovery([], [], today)).toBeNull();
  });

  it("gut erholt", () => {
    const r = assessRecovery([...normalSleep, { day: today, value: 440 }], [...normalRhr, { day: today, value: 57 }], today)!;
    expect(r.level).toBe("ok");
    expect(r.sleep).toEqual({ minutes: 440, baseline: 450, short: false });
    expect(r.restingHr).toMatchObject({ bpm: 57, baseline: 56, delta: 1, high: false });
  });

  it("wenig Schlaf: unter 6 h oder 90 min unter dem eigenen Schnitt", () => {
    expect(assessRecovery([...normalSleep, { day: today, value: 350 }], [], today)!.level).toBe("reduced");
    const r = assessRecovery([...normalSleep, { day: today, value: 370 }], [], today)!;
    expect(r.sleep!.short).toBe(false);
    const longSleeper = days("2026-10-29", Array(14).fill(540));
    expect(assessRecovery([...longSleeper, { day: today, value: 420 }], [], today)!.sleep!.short).toBe(true);
  });

  it("Ruhepuls +5 über dem Schnitt; beides zusammen → locker trainieren", () => {
    const high = assessRecovery([], [...normalRhr, { day: today, value: 62 }], today)!;
    expect(high).toMatchObject({ level: "reduced", restingHr: { delta: 6, high: true } });
    expect(high.advice).toMatch(/Ruhepuls/);
    const both = assessRecovery([...normalSleep, { day: today, value: 300 }], [...normalRhr, { day: today, value: 63 }], today)!;
    expect(both.level).toBe("low");
    expect(both.advice).toMatch(/1 Satz weniger/);
  });

  it("Ruhepuls von gestern, wenn heute noch keiner da ist; zu wenig Verlauf → kein Vergleich", () => {
    expect(assessRecovery([], [...normalRhr.slice(0, 13), { day: "2026-11-11", value: 64 }], today)!.restingHr!.high).toBe(true);
    expect(assessRecovery([], [...normalRhr.slice(0, 3), { day: today, value: 70 }], today)).toBeNull();
  });

  it("formatiert Schlafdauer", () => {
    expect(formatSleep(405)).toBe("6 h 45 min");
  });
});
