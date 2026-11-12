/**
 * Central game configuration. Rename the game by setting NEXT_PUBLIC_GAME_TITLE
 * (or editing the default below) — every player-facing title reads from here.
 */
export const GAME_TITLE = process.env.NEXT_PUBLIC_GAME_TITLE?.trim() || "Closest Wins";
export const GAME_TAGLINE = "Five numbers a day. Closest guess wins.";

/** Timezone that defines the daily challenge date and the Monday–Sunday week. */
export const GAME_TIMEZONE = "America/New_York";

/** Challenge #1 is played on this date (YYYY-MM-DD, in GAME_TIMEZONE). */
export const GAME_LAUNCH_DATE = process.env.NEXT_PUBLIC_GAME_LAUNCH_DATE?.trim() || "2026-11-01";

export const QUESTIONS_PER_DAY = 5;
export const MAX_POINTS_PER_QUESTION = 1000;
export const MAX_POINTS_PER_DAY = QUESTIONS_PER_DAY * MAX_POINTS_PER_QUESTION;

/**
 * Round timing (milliseconds). The server persists the reading start and the
 * answer deadline; these constants are used to compute them.
 */
export const TIMING = {
  /** Question visible, input disabled. */
  readingMs: 4_000,
  /** Answer window after reading ends. */
  answerMs: 10_000,
  /**
   * Network grace: a submission that reaches the server up to this long after
   * the deadline is still accepted. It covers ordinary mobile latency and is
   * not extra thinking time (the on-screen timer still ends at the deadline).
   */
  submitGraceMs: 1_500,
  /**
   * Clock-skew tolerance: a submission up to this long before the answer
   * window officially opens is accepted (the client estimates server time from
   * one round trip and can be slightly early).
   */
  earlyToleranceMs: 300,
} as const;

/** Weekly standings: best N daily scores per Monday–Sunday week. */
export const WEEKLY_COUNTED_DAYS = 5;

/** Prompts longer than this are flagged: they must be readable in ~4 seconds. */
export const MAX_PROMPT_CHARS = 120;
export const MAX_PROMPT_WORDS = 22;
