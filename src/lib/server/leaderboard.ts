import "server-only";
import { WEEKLY_COUNTED_DAYS } from "@/config/game";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { addDays, weekStartOf } from "@/lib/time";

/**
 * Public leaderboards across every player. Only completed days count, ties
 * share a rank (SQL rank(): 1, 1, 3), and only approved nicknames/avatars are
 * shown — no personal information exists to leak.
 */

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  avatarId: string;
  total: number;
  isViewer: boolean;
  daysPlayed?: number;
  daysCounted?: number;
}

export interface Board {
  scope: "day" | "week";
  date: string;
  weekStart?: string;
  totalPlayers: number;
  top: BoardRow[];
  me: BoardRow | null;
}

interface RankedRow {
  rank: number;
  player_id: string;
  total: number;
  days_played?: number;
  days_counted?: number;
  avatar_id: string;
  name_adjective: string;
  name_noun: string;
  name_suffix: number | null;
}

function toRow(r: RankedRow, viewerId: string): BoardRow {
  return {
    rank: Number(r.rank),
    playerId: r.player_id,
    name: formatNickname(r.name_adjective, r.name_noun, r.name_suffix),
    avatarId: r.avatar_id,
    total: Number(r.total),
    isViewer: r.player_id === viewerId,
    ...(r.days_played !== undefined ? { daysPlayed: Number(r.days_played), daysCounted: Number(r.days_counted) } : {}),
  };
}

async function finish(scope: Board["scope"], date: string, rankedSql: string, params: unknown[], viewerId: string, limit: number, weekStart?: string): Promise<Board> {
  const db = await getDb();
  const top = await db.query<RankedRow>(
    `with ranked as (${rankedSql})
     select r.*, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from ranked r join players p on p.id = r.player_id
      order by r.rank, p.name_adjective, p.name_noun limit $${params.length + 1}`,
    [...params, limit],
  );
  const mine = await db.one<RankedRow>(
    `with ranked as (${rankedSql})
     select r.*, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from ranked r join players p on p.id = r.player_id where r.player_id = $${params.length + 1}`,
    [...params, viewerId],
  );
  const count = await db.one<{ n: number }>(`with ranked as (${rankedSql}) select count(*)::int as n from ranked`, params);
  return {
    scope,
    date,
    weekStart,
    totalPlayers: count?.n ?? 0,
    top: top.map((r) => toRow(r, viewerId)),
    me: mine ? toRow(mine, viewerId) : null,
  };
}

export async function dailyBoard(viewerId: string, date: string, limit = 50): Promise<Board> {
  const sql = `
    select a.player_id, a.total_score as total, rank() over (order by a.total_score desc) as rank
      from attempts a join daily_challenges dc on dc.id = a.challenge_id
     where dc.challenge_date = $1::date and a.status = 'completed'`;
  return finish("day", date, sql, [date], viewerId, limit);
}

export async function weeklyBoard(viewerId: string, date: string, limit = 50): Promise<Board> {
  const start = weekStartOf(date);
  const sql = `
    with days as (
      select a.player_id, a.total_score,
             row_number() over (partition by a.player_id order by a.total_score desc) as n
        from attempts a join daily_challenges dc on dc.id = a.challenge_id
       where dc.challenge_date between $1::date and $2::date and a.status = 'completed'),
    sums as (
      select player_id, sum(total_score) filter (where n <= ${WEEKLY_COUNTED_DAYS})::int as total,
             count(*)::int as days_played, least(count(*), ${WEEKLY_COUNTED_DAYS})::int as days_counted
        from days group by player_id)
    select player_id, total, days_played, days_counted, rank() over (order by total desc) as rank from sums`;
  return finish("week", date, sql, [start, addDays(start, 6)], viewerId, limit, start);
}

export interface EveryoneQuestionStats {
  position: number;
  submitted: number;
  median: number | null;
  higherPct: number;
  lowerPct: number;
  /** Share of other players whose guess was further from the answer than the viewer's. */
  beatPct: number | null;
}

export interface EveryoneStats {
  rank: number | null;
  players: number;
  questions: EveryoneQuestionStats[];
}

/**
 * Aggregate comparisons with everyone who completed the day. Called only once
 * the viewer has completed; uses submitted guesses only; reports nothing for
 * questions with fewer than 3 submitted guesses.
 */
export async function everyoneStats(viewerId: string, challengeId: string): Promise<EveryoneStats> {
  const db = await getDb();
  const rankRow = await db.one<{ rank: number; players: number }>(
    `with ranked as (
       select player_id, rank() over (order by total_score desc) as rank, count(*) over () as players
         from attempts where challenge_id = $1 and status = 'completed')
     select rank::int as rank, players::int as players from ranked where player_id = $2`,
    [challengeId, viewerId],
  );
  const players = rankRow?.players ?? 0;
  const snaps = await db.query<{ position: number; answer: number; scoring_type: string; voided: boolean }>(
    "select position, answer, scoring_type, voided from challenge_questions where challenge_id = $1 order by position",
    [challengeId],
  );
  const guesses = await db.query<{ position: number; guess: number; player_id: string }>(
    `select r.position, r.guess, a.player_id from rounds r join attempts a on a.id = r.attempt_id
      where a.challenge_id = $1 and a.status = 'completed' and r.status = 'answered'`,
    [challengeId],
  );
  const questions: EveryoneQuestionStats[] = [];
  for (const s of snaps) {
    if (s.voided) continue;
    const gs = guesses.filter((g) => g.position === s.position);
    if (gs.length < 3) {
      questions.push({ position: s.position, submitted: gs.length, median: null, higherPct: 0, lowerPct: 0, beatPct: null });
      continue;
    }
    const sorted = gs.map((g) => g.guess).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const dist = (g: number) => (s.scoring_type === "ratio" && g > 0 && s.answer > 0 ? Math.abs(Math.log(g / s.answer)) : g <= 0 && s.scoring_type === "ratio" ? Infinity : Math.abs(g - s.answer));
    const mine = gs.find((g) => g.player_id === viewerId);
    const others = gs.filter((g) => g.player_id !== viewerId);
    const beatPct = mine && others.length ? Math.round((others.filter((o) => dist(o.guess) > dist(mine.guess)).length / others.length) * 100) : null;
    questions.push({
      position: s.position,
      submitted: gs.length,
      median,
      higherPct: Math.round((gs.filter((g) => g.guess > s.answer).length / gs.length) * 100),
      lowerPct: Math.round((gs.filter((g) => g.guess < s.answer).length / gs.length) * 100),
      beatPct,
    });
  }
  return { rank: rankRow?.rank ?? null, players, questions };
}
