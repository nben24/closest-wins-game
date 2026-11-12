import "server-only";
import crypto from "node:crypto";
import { getDb, isUniqueViolation, type Sql } from "@/lib/db";
import { formatGroupLabel, formatNickname, validateGroupLabel } from "@/lib/names";
import { rankByScore, weeklyTotal } from "@/lib/ranking";
import { weekDates, weekStartOf } from "@/lib/time";
import { now } from "@/lib/server/clock";
import { ApiError, forbidden, notFound } from "@/lib/server/errors";
import { audit } from "@/lib/server/notify";

export const MAX_GROUPS_PER_PLAYER = 20;
export const MAX_MEMBERS_PER_GROUP = 50;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newInviteCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

interface GroupRow {
  id: string;
  label_adjective: string;
  label_noun: string;
  owner_player_id: string;
  invite_code: string;
  created_at: Date;
}

export interface GroupSummary {
  id: string;
  label: string;
  memberCount: number;
  isOwner: boolean;
}

export async function listMyGroups(playerId: string): Promise<GroupSummary[]> {
  const db = await getDb();
  const rows = await db.query<GroupRow & { member_count: number }>(
    `select g.*, (select count(*)::int from group_members m2 where m2.group_id = g.id) as member_count
       from groups g join group_members m on m.group_id = g.id
      where m.player_id = $1 order by m.joined_at`,
    [playerId],
  );
  return rows.map((g) => ({
    id: g.id,
    label: formatGroupLabel(g.label_adjective, g.label_noun),
    memberCount: g.member_count,
    isOwner: g.owner_player_id === playerId,
  }));
}

async function membershipCount(sql: Sql, playerId: string): Promise<number> {
  return (await sql.one<{ n: number }>("select count(*)::int as n from group_members where player_id = $1", [playerId]))!.n;
}

export async function createGroup(playerId: string, adjective: unknown, noun: unknown): Promise<GroupSummary> {
  const err = validateGroupLabel(adjective, noun);
  if (err) throw new ApiError(400, "invalid_label", err);
  const db = await getDb();
  return db.tx(async (sql) => {
    if ((await membershipCount(sql, playerId)) >= MAX_GROUPS_PER_PLAYER) {
      throw new ApiError(409, "too_many_groups", `You can be in up to ${MAX_GROUPS_PER_PLAYER} groups.`);
    }
    for (let i = 0; i < 5; i++) {
      try {
        const g = await sql.one<GroupRow>(
          `insert into groups (label_adjective, label_noun, owner_player_id, invite_code) values ($1, $2, $3, $4) returning *`,
          [adjective, noun, playerId, newInviteCode()],
        );
        await sql.query("insert into group_members (group_id, player_id, role) values ($1, $2, 'owner')", [g!.id, playerId]);
        return { id: g!.id, label: formatGroupLabel(g!.label_adjective, g!.label_noun), memberCount: 1, isOwner: true };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    throw new ApiError(500, "code_collision", "Please try again.");
  });
}

/** Preview a group by invite code (label + member count only). */
export async function previewInvite(code: string): Promise<{ id: string; label: string; memberCount: number } | null> {
  const db = await getDb();
  const g = await db.one<GroupRow & { member_count: number }>(
    `select g.*, (select count(*)::int from group_members m where m.group_id = g.id) as member_count
       from groups g where invite_code = $1`,
    [code],
  );
  return g ? { id: g.id, label: formatGroupLabel(g.label_adjective, g.label_noun), memberCount: g.member_count } : null;
}

export async function joinGroup(playerId: string, code: string): Promise<GroupSummary> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const g = await sql.one<GroupRow>("select * from groups where invite_code = $1 for update", [code]);
    if (!g) throw new ApiError(404, "invalid_code", "That invite code didn't work. Check it and try again.");
    const already = await sql.one("select 1 from group_members where group_id = $1 and player_id = $2", [g.id, playerId]);
    if (!already) {
      if ((await membershipCount(sql, playerId)) >= MAX_GROUPS_PER_PLAYER) {
        throw new ApiError(409, "too_many_groups", `You can be in up to ${MAX_GROUPS_PER_PLAYER} groups.`);
      }
      const members = (await sql.one<{ n: number }>("select count(*)::int as n from group_members where group_id = $1", [g.id]))!.n;
      if (members >= MAX_MEMBERS_PER_GROUP) throw new ApiError(409, "group_full", "This group is full.");
      await sql.query("insert into group_members (group_id, player_id) values ($1, $2) on conflict do nothing", [g.id, playerId]);
    }
    const count = (await sql.one<{ n: number }>("select count(*)::int as n from group_members where group_id = $1", [g.id]))!.n;
    return { id: g.id, label: formatGroupLabel(g.label_adjective, g.label_noun), memberCount: count, isOwner: g.owner_player_id === playerId };
  });
}

async function requireMember(sql: Sql, groupId: string, playerId: string): Promise<GroupRow> {
  const g = await sql.one<GroupRow>(
    "select g.* from groups g join group_members m on m.group_id = g.id where g.id = $1 and m.player_id = $2",
    [groupId, playerId],
  );
  // Same response whether the group doesn't exist or you're not in it.
  if (!g) throw notFound("Group");
  return g;
}

export async function leaveGroup(playerId: string, groupId: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const g = await requireMember(sql, groupId, playerId);
    await sql.query("delete from group_members where group_id = $1 and player_id = $2", [groupId, playerId]);
    if (g.owner_player_id === playerId) {
      const next = await sql.one<{ player_id: string }>(
        "select player_id from group_members where group_id = $1 order by joined_at limit 1",
        [groupId],
      );
      if (next) {
        await sql.query("update groups set owner_player_id = $2 where id = $1", [groupId, next.player_id]);
        await sql.query("update group_members set role = 'owner' where group_id = $1 and player_id = $2", [groupId, next.player_id]);
      } else {
        await sql.query("delete from groups where id = $1", [groupId]);
      }
    }
  });
}

export async function removeMember(ownerId: string, groupId: string, memberId: string): Promise<void> {
  const db = await getDb();
  await db.tx(async (sql) => {
    const g = await requireMember(sql, groupId, ownerId);
    if (g.owner_player_id !== ownerId) throw forbidden();
    if (memberId === ownerId) throw new ApiError(400, "cannot_remove_self", "Use Leave group instead.");
    await sql.query("delete from group_members where group_id = $1 and player_id = $2", [groupId, memberId]);
    await audit(`player:${ownerId}`, "remove_member", "group", groupId, { memberId }, sql);
  });
}

export async function rotateInvite(ownerId: string, groupId: string): Promise<string> {
  const db = await getDb();
  return db.tx(async (sql) => {
    const g = await requireMember(sql, groupId, ownerId);
    if (g.owner_player_id !== ownerId) throw forbidden();
    for (let i = 0; i < 5; i++) {
      const code = newInviteCode();
      try {
        await sql.query("update groups set invite_code = $2, invite_rotated_at = $3 where id = $1", [groupId, code, now()]);
        return code;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    throw new ApiError(500, "code_collision", "Please try again.");
  });
}

export interface StandingRow {
  playerId: string;
  name: string;
  avatarId: string;
  isViewer: boolean;
  total: number;
  rank: number;
}

export interface WeeklyRow extends StandingRow {
  daysPlayed: number;
  daysCounted: number;
}

export interface GroupDetail {
  id: string;
  label: string;
  inviteCode: string;
  isOwner: boolean;
  members: { playerId: string; name: string; avatarId: string; role: string; isViewer: boolean }[];
  date: string;
  daily: StandingRow[];
  notFinished: { playerId: string; name: string; avatarId: string }[];
  weekStart: string;
  weekly: WeeklyRow[];
}

interface MemberRow {
  player_id: string;
  role: string;
  avatar_id: string;
  name_adjective: string;
  name_noun: string;
  name_suffix: number | null;
}

async function members(sql: Sql, groupId: string): Promise<MemberRow[]> {
  return sql.query<MemberRow>(
    `select m.player_id, m.role, p.avatar_id, p.name_adjective, p.name_noun, p.name_suffix
       from group_members m join players p on p.id = m.player_id
      where m.group_id = $1 order by m.joined_at`,
    [groupId],
  );
}

const nameOf = (m: MemberRow) => formatNickname(m.name_adjective, m.name_noun, m.name_suffix);

export async function groupDetail(viewerId: string, groupId: string, date: string): Promise<GroupDetail> {
  const db = await getDb();
  const g = await requireMember(db, groupId, viewerId);
  const ms = await members(db, groupId);
  const ids = ms.map((m) => m.player_id);
  const byId = new Map(ms.map((m) => [m.player_id, m]));

  // Daily: completed attempts only (practice never counts — it isn't stored).
  const daily = await db.query<{ player_id: string; total_score: number }>(
    `select a.player_id, a.total_score from attempts a join daily_challenges dc on dc.id = a.challenge_id
      where dc.challenge_date = $1 and a.status = 'completed' and a.player_id = any($2::uuid[])`,
    [date, ids],
  );
  const dailyRanked = rankByScore(
    daily.map((d) => {
      const m = byId.get(d.player_id)!;
      return { playerId: d.player_id, name: nameOf(m), avatarId: m.avatar_id, isViewer: d.player_id === viewerId, total: d.total_score };
    }),
    (x) => x.total,
    (x) => x.name,
  );
  const finished = new Set(daily.map((d) => d.player_id));

  const weekStart = weekStartOf(date);
  const dates = weekDates(weekStart);
  const weekRows = await db.query<{ player_id: string; total_score: number }>(
    `select a.player_id, a.total_score from attempts a join daily_challenges dc on dc.id = a.challenge_id
      where dc.challenge_date between $1::date and $2::date and a.status = 'completed' and a.player_id = any($3::uuid[])`,
    [dates[0], dates[6], ids],
  );
  const perPlayer = new Map<string, number[]>();
  for (const r of weekRows) perPlayer.set(r.player_id, [...(perPlayer.get(r.player_id) ?? []), r.total_score]);
  const weekly = rankByScore(
    [...perPlayer.entries()].map(([pid, scores]) => {
      const m = byId.get(pid)!;
      const w = weeklyTotal(scores);
      return { playerId: pid, name: nameOf(m), avatarId: m.avatar_id, isViewer: pid === viewerId, total: w.total, daysPlayed: w.daysPlayed, daysCounted: w.daysCounted };
    }),
    (x) => x.total,
    (x) => x.name,
  );

  return {
    id: g.id,
    label: formatGroupLabel(g.label_adjective, g.label_noun),
    inviteCode: g.invite_code,
    isOwner: g.owner_player_id === viewerId,
    members: ms.map((m) => ({ playerId: m.player_id, name: nameOf(m), avatarId: m.avatar_id, role: m.role, isViewer: m.player_id === viewerId })),
    date,
    daily: dailyRanked,
    notFinished: ms.filter((m) => !finished.has(m.player_id)).map((m) => ({ playerId: m.player_id, name: nameOf(m), avatarId: m.avatar_id })),
    weekStart,
    weekly,
  };
}

export interface GroupComparison {
  groupId: string;
  label: string;
  standings: StandingRow[];
  /** Per position: submitted guesses from members who completed the day. */
  guesses: Record<number, { playerId: string; name: string; avatarId: string; guess: number; isViewer: boolean }[]>;
  finishedCount: number;
  memberCount: number;
}

/**
 * Answer-level comparisons for the viewer's groups. Only called once the
 * viewer has completed the challenge; only completed members are included;
 * only submitted (status = answered) guesses are compared.
 */
export async function groupComparisons(viewerId: string, challengeId: string): Promise<GroupComparison[]> {
  const db = await getDb();
  const groups = await db.query<GroupRow>(
    "select g.* from groups g join group_members m on m.group_id = g.id where m.player_id = $1 order by m.joined_at",
    [viewerId],
  );
  const out: GroupComparison[] = [];
  for (const g of groups) {
    const ms = await members(db, g.id);
    const byId = new Map(ms.map((m) => [m.player_id, m]));
    const attempts = await db.query<{ id: string; player_id: string; total_score: number }>(
      `select id, player_id, total_score from attempts where challenge_id = $1 and status = 'completed' and player_id = any($2::uuid[])`,
      [challengeId, ms.map((m) => m.player_id)],
    );
    const standings = rankByScore(
      attempts.map((a) => {
        const m = byId.get(a.player_id)!;
        return { playerId: a.player_id, name: nameOf(m), avatarId: m.avatar_id, isViewer: a.player_id === viewerId, total: a.total_score };
      }),
      (x) => x.total,
      (x) => x.name,
    );
    const rounds = await db.query<{ attempt_id: string; position: number; guess: number }>(
      `select attempt_id, position, guess from rounds where attempt_id = any($1::uuid[]) and status = 'answered'`,
      [attempts.map((a) => a.id)],
    );
    const ownerOf = new Map(attempts.map((a) => [a.id, a.player_id]));
    const guesses: GroupComparison["guesses"] = {};
    for (const r of rounds) {
      const pid = ownerOf.get(r.attempt_id)!;
      const m = byId.get(pid)!;
      (guesses[r.position] ??= []).push({ playerId: pid, name: nameOf(m), avatarId: m.avatar_id, guess: r.guess, isViewer: pid === viewerId });
    }
    out.push({ groupId: g.id, label: formatGroupLabel(g.label_adjective, g.label_noun), standings, guesses, finishedCount: attempts.length, memberCount: ms.length });
  }
  return out;
}
