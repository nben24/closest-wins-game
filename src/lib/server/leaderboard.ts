import "server-only";
import { WEEKLY_COUNTED_DAYS } from "@/config/game";
import { getDb } from "@/lib/db";
import { formatNickname } from "@/lib/names";
import { now } from "@/lib/server/clock";
import { addDays, gameDateOf, weekStartOf } from "@/lib/time";

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
  /** Weekly/all-time only: average score per day played (every day, not just the counted ones). */
  average?: number;
}

export interface Board {
  scope: "day" | "week";
  date: string;
  weekStart?: string;
  weekEnd?: string;
  /** Weekly only: the week is over (its Sunday has passed in New York). */
  final?: boolean;
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
  average?: number;
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
    ...(r.average !== undefined && r.average !== null ? { average: Number(r.average) } : {}),
  };
}

async function finish(
  scope: Board["scope"],
  date: string,
  rankedSql: string,
  params: unknown[],
  viewerId: string,
  limit: number,
  week?: { weekStart: string; weekEnd: string; final: boolean },
): Promise<Board> {
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
    ...week,
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
             count(*)::int as days_played, least(count(*), ${WEEKLY_COUNTED_DAYS})::int as days_counted,
             round(avg(total_score))::int as average
        from days group by player_id)
    select player_id, total, days_played, days_counted, average, rank() over (order by total desc) as rank from sums`;
  const end = addDays(start, 6);
  return finish("week", date, sql, [start, end], viewerId, limit, { weekStart: start, weekEnd: end, final: end < gameDateOf(now()) });
}

export interface WeekPodium {
  weekStart: string;
  weekEnd: string;
  players: number;
  /** Everyone ranked 1–3 (ties can make this longer than three). */
  podium: BoardRow[];
}

/**
 * Top three of each finished week (Monday–Sunday, New York), newest first.
 * Same ranking as the weekly board: best ${WEEKLY_COUNTED_DAYS} days count.
 */
export async function pastWeeks(viewerId: string, weeks = 8): Promise<WeekPodium[]> {
  const db = await getDb();
  const thisWeek = weekStartOf(gameDateOf(now()));
  const rows = await db.query<RankedRow & { week_start: string; players: number }>(
    `with days as (
       select player_id, total_score, wk,
              row_number() over (partition by player_id, wk order by total_score desc) as n
         from (
           -- Monday of the challenge's week (pure date arithmetic; no time zones involved)
           select a.player_id, a.total_score, dc.challenge_date - (extract(isodow from dc.challenge_date)::int - 1) as wk
             from attempts a join daily_challenges dc on dc.id = a.challenge_id
            where dc.challenge_date < $1::date and a.status = 'completed') x),
     sums as (
       select wk, player_id, sum(total_score) filter (where n <= ${WEEKLY_COUNTED_DAYS})::int as total,
              count(*)::int as days_played, least(count(*), ${WEEKLY_COUNTED_DAYS})::int as days_counted,
              round(avg(total_score))::int as average
         from days group by wk, player_id),
     ranked as (
       select s.*, rank() over (partition by wk order by total desc) as rank, count(*) over (partition by wk) as players from sums s),
     recent as (select distinct wk from sums order by wk desc limit $2)
     select to_char(r.wk, 'YYYY-MM-DD') as week_start, r.players::int as players, r.player_id, r.total, r.days_played, r.days_counted,
            r.average, r.rank, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from ranked r join players p on p.id = r.player_id
      where r.rank <= 3 and r.wk in (select wk from recent)
      order by r.wk desc, r.rank, p.name_adjective, p.name_noun`,
    [thisWeek, weeks],
  );
  const out: WeekPodium[] = [];
  for (const r of rows) {
    let w = out[out.length - 1];
    if (!w || w.weekStart !== r.week_start) {
      w = { weekStart: r.week_start, weekEnd: addDays(r.week_start, 6), players: Number(r.players), podium: [] };
      out.push(w);
    }
    w.podium.push(toRow(r, viewerId));
  }
  return out;
}

export interface Leader {
  name: string;
  avatarId: string;
  total: number;
  /** How many other players share first place. */
  tiedWith: number;
  isViewer: boolean;
  daysPlayed?: number;
}

export interface LeadersSummary {
  date: string;
  today: (Leader & { players: number }) | null;
  week: (Leader & { players: number }) | null;
  lastWeek: Leader | null;
}

function leaderOf(top: BoardRow[]): Leader | null {
  const first = top[0];
  if (!first || first.rank !== 1) return null;
  return {
    name: first.name,
    avatarId: first.avatarId,
    total: first.total,
    tiedWith: top.filter((r) => r.rank === 1).length - 1,
    isViewer: top.some((r) => r.rank === 1 && r.isViewer),
    ...(first.daysPlayed !== undefined ? { daysPlayed: first.daysPlayed } : {}),
  };
}

/** Who's leading today, this week, and who won last week — for the home screen. Scores only, never answers. */
export async function leadersSummary(viewerId: string): Promise<LeadersSummary> {
  const date = gameDateOf(now());
  const [day, week, past] = await Promise.all([dailyBoard(viewerId, date, 10), weeklyBoard(viewerId, date, 10), pastWeeks(viewerId, 1)]);
  const lastWeekStart = addDays(weekStartOf(date), -7);
  const lw = past[0]?.weekStart === lastWeekStart ? past[0] : null;
  const t = leaderOf(day.top);
  const w = leaderOf(week.top);
  return {
    date,
    today: t && { ...t, players: day.totalPlayers },
    week: w && { ...w, players: week.totalPlayers },
    lastWeek: lw ? leaderOf(lw.podium) : null,
  };
}

export interface AllTimeRow {
  playerId: string;
  name: string;
  avatarId: string;
  daysPlayed: number;
  average: number;
  best: number;
  total: number;
  lastPlayed: string;
}

/** Admin: every player's lifetime numbers (completed days only). */
export async function allTimeStats(limit = 500): Promise<AllTimeRow[]> {
  const db = await getDb();
  const rows = await db.query<{
    player_id: string; avatar_id: string; name_adjective: string; name_noun: string; name_suffix: number | null;
    days_played: number; average: number; best: number; total: number; last_played: string;
  }>(
    `select a.player_id, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix,
            count(*)::int as days_played, round(avg(a.total_score))::int as average, max(a.total_score)::int as best,
            sum(a.total_score)::int as total, to_char(max(dc.challenge_date), 'YYYY-MM-DD') as last_played
       from attempts a join daily_challenges dc on dc.id = a.challenge_id join players p on p.id = a.player_id
      where a.status = 'completed'
      group by a.player_id, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
      order by average desc, days_played desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    playerId: r.player_id,
    name: formatNickname(r.name_adjective, r.name_noun, r.name_suffix),
    avatarId: r.avatar_id,
    daysPlayed: Number(r.days_played),
    average: Number(r.average),
    best: Number(r.best),
    total: Number(r.total),
    lastPlayed: r.last_played,
  }));
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
