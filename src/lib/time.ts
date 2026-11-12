import { GAME_LAUNCH_DATE, GAME_TIMEZONE } from "@/config/game";

/**
 * Date helpers. A "game date" is a calendar date string (YYYY-MM-DD) in
 * America/New_York. Once we have a date string, all arithmetic is plain
 * calendar arithmetic in UTC, which is immune to daylight-saving shifts.
 */

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: GAME_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hourFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: GAME_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isGameDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The game date (America/New_York) of an instant. */
export function gameDateOf(instant: Date): string {
  const parts = dateFmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toUtcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromUtcDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtcDay(toUtcDay(date) + n);
}

export function daysBetween(from: string, to: string): number {
  return toUtcDay(to) - toUtcDay(from);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(date: string): number {
  const dow = new Date(toUtcDay(date) * 86_400_000).getUTCDay(); // 0 = Sunday
  return (dow + 6) % 7;
}

/** Monday of the Monday–Sunday week containing `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Challenge number: the launch date is #1. */
export function challengeNumber(date: string): number {
  return daysBetween(GAME_LAUNCH_DATE, date) + 1;
}

/** The UTC instant at which `date` begins in America/New_York. */
export function startOfGameDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  // New York is UTC−5 (EST) or UTC−4 (EDT); midnight is never skipped by DST.
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, offsetHours));
    if (gameDateOf(candidate) === date && hourFmt.format(candidate) === "00:00") return candidate;
  }
  // Fallback (should be unreachable for America/New_York).
  return new Date(Date.UTC(y, m - 1, d, 5));
}

export function nextGameDayStart(now: Date): Date {
  return startOfGameDate(addDays(gameDateOf(now), 1));
}

export function formatGameDate(date: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
