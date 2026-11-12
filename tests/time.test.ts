import { describe, expect, it } from "vitest";
import { addDays, gameDateOf, isGameDate, startOfGameDate, weekStartOf, weekdayIndex, nextGameDayStart } from "@/lib/time";

describe("game date in America/New_York", () => {
  it("rolls over at local midnight during standard time (UTC-5)", () => {
    expect(gameDateOf(new Date("2026-11-11T04:59:59.999Z"))).toBe("2026-11-10");
    expect(gameDateOf(new Date("2026-11-11T05:00:00.000Z"))).toBe("2026-11-11");
  });
  it("rolls over at local midnight during daylight time (UTC-4)", () => {
    expect(gameDateOf(new Date("2026-07-04T03:59:59Z"))).toBe("2026-07-03");
    expect(gameDateOf(new Date("2026-07-04T04:00:00Z"))).toBe("2026-07-04");
  });
  it("handles the spring-forward day (2026-03-08)", () => {
    // 01:59 EST -> 03:00 EDT at 07:00Z; still the same game date
    expect(gameDateOf(new Date("2026-03-08T06:59:00Z"))).toBe("2026-03-08");
    expect(gameDateOf(new Date("2026-03-08T07:01:00Z"))).toBe("2026-03-08");
    expect(startOfGameDate("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfGameDate("2026-03-09").toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("handles the fall-back day (2026-11-01), a 25-hour day", () => {
    expect(startOfGameDate("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfGameDate("2026-11-02").toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // the repeated 1 AM hour is still Nov 1
    expect(gameDateOf(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(gameDateOf(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(gameDateOf(new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01");
  });
  it("computes the next day start across DST", () => {
    expect(nextGameDayStart(new Date("2026-03-08T12:00:00Z")).toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("week boundaries (Monday-Sunday)", () => {
  it("finds Monday", () => {
    expect(weekStartOf("2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(weekStartOf("2026-11-16")).toBe("2026-11-16");
    expect(weekdayIndex("2026-11-15")).toBe(6);
  });
  it("is unaffected by DST weeks", () => {
    expect(weekStartOf("2026-03-08")).toBe("2026-03-02");
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
  });
  it("validates date strings", () => {
    expect(isGameDate("2026-02-29")).toBe(false);
    expect(isGameDate("2028-02-29")).toBe(true);
    expect(isGameDate("2026-1-1")).toBe(false);
  });
});
