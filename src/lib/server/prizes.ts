import "server-only";
import crypto from "node:crypto";
import { PRIZE_CODES_FROM_WEEK } from "@/config/game";
import { getDb } from "@/lib/db";
import { now } from "@/lib/server/clock";
import { weeklyBoard } from "@/lib/server/leaderboard";
import { addDays, gameDateOf, weekStartOf } from "@/lib/time";

/**
 * Private prize claim codes. When a week ends, each top-3 finisher gets a random
 * code. Only that player (on their own home screen) and the admin can see it,
 * so "I'm the winner" claims can be checked: the real winner can read you the code.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const NOBODY = "00000000-0000-0000-0000-000000000000";

export function newPrizeCode(): string {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export interface PrizeCode {
  weekStart: string;
  playerId: string;
  rank: number;
  code: string;
}

/** Create codes for a finished week's top 3 (idempotent). Weeks before prizes started, or not yet over, get none. */
export async function ensurePrizeCodes(weekStart: string): Promise<PrizeCode[]> {
  if (weekStart < PRIZE_CODES_FROM_WEEK || addDays(weekStart, 6) >= gameDateOf(now())) return [];
  const db = await getDb();
  const existing = await db.query<{ week_start: string; player_id: string; rank: number; code: string }>(
    "select to_char(week_start, 'YYYY-MM-DD') as week_start, player_id, rank, code from prize_codes where week_start = $1::date order by rank",
    [weekStart],
  );
  if (existing.length === 0) {
    const board = await weeklyBoard(NOBODY, weekStart, 10);
    for (const r of board.top.filter((r) => r.rank <= 3)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const rows = await db.query(
          `insert into prize_codes (week_start, player_id, rank, code) values ($1::date, $2, $3, $4)
           on conflict do nothing returning code`,
          [weekStart, r.playerId, r.rank, newPrizeCode()],
        );
        if (rows.length) break;
        const already = await db.one("select 1 from prize_codes where week_start = $1::date and player_id = $2", [weekStart, r.playerId]);
        if (already) break; // created concurrently; otherwise it was a (very unlikely) code collision — retry
      }
    }
    return ensurePrizeCodesRead(weekStart);
  }
  return existing.map((e) => ({ weekStart: e.week_start, playerId: e.player_id, rank: e.rank, code: e.code }));
}

async function ensurePrizeCodesRead(weekStart: string): Promise<PrizeCode[]> {
  const db = await getDb();
  const rows = await db.query<{ week_start: string; player_id: string; rank: number; code: string }>(
    "select to_char(week_start, 'YYYY-MM-DD') as week_start, player_id, rank, code from prize_codes where week_start = $1::date order by rank",
    [weekStart],
  );
  return rows.map((e) => ({ weekStart: e.week_start, playerId: e.player_id, rank: e.rank, code: e.code }));
}

/** The viewer's own code for last week, if they finished top 3. Never returns anyone else's code. */
export async function myLastWeekPrize(playerId: string): Promise<{ weekStart: string; rank: number; code: string } | null> {
  const lastWeek = addDays(weekStartOf(gameDateOf(now())), -7);
  const codes = await ensurePrizeCodes(lastWeek);
  const mine = codes.find((c) => c.playerId === playerId);
  return mine ? { weekStart: mine.weekStart, rank: mine.rank, code: mine.code } : null;
}
