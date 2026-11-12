import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import {
  createGroup, groupComparisons, groupDetail, joinGroup, leaveGroup, listMyGroups, normalizeInviteCode, removeMember, rotateInvite,
} from "@/lib/server/groups";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { getResults } from "@/lib/server/results";
import { fakeClock, freshDb, makePlayer, resetClock } from "./support/db";

let db: Db;
let clock: ReturnType<typeof fakeClock>;
beforeEach(async () => {
  clock = fakeClock("2026-11-11T20:00:00Z");
  db = await freshDb();
});
afterEach(async () => {
  resetClock();
  await db.close();
});

async function playAll(player: string, guesses: (string | null)[]) {
  const s = await getPlayState(player);
  for (let p = 1; p <= 5; p++) {
    await beginRound(player, s.challenge!.id, p);
    clock.advance(5000);
    await submitRound(player, s.challenge!.id, p, guesses[p - 1], `g${p}`);
    clock.advance(1000);
  }
  return s.challenge!.id;
}

describe("groups", () => {
  it("creates, joins with a code, and validates labels", async () => {
    const a = await makePlayer(db);
    const b = await makePlayer(db);
    await expect(createGroup(a, "Lucky", "Whatever I type")).rejects.toMatchObject({ code: "invalid_label" });
    const g = await createGroup(a, "Lucky", "Guessers");
    const detail = await groupDetail(a, g.id, "2026-11-11");
    expect(detail.label).toBe("The Lucky Guessers");
    const joined = await joinGroup(b, normalizeInviteCode(detail.inviteCode.toLowerCase())!);
    expect(joined.memberCount).toBe(2);
    // joining twice is a no-op
    expect((await joinGroup(b, detail.inviteCode)).memberCount).toBe(2);
    expect(await listMyGroups(b)).toHaveLength(1);
  });

  it("hides groups from non-members (same 404 as a missing group)", async () => {
    const a = await makePlayer(db);
    const outsider = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    await expect(groupDetail(outsider, g.id, "2026-11-11")).rejects.toMatchObject({ status: 404 });
    await expect(groupDetail(outsider, "00000000-0000-4000-8000-000000000000", "2026-11-11")).rejects.toMatchObject({ status: 404 });
    await expect(rotateInvite(outsider, g.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lets only the owner remove members and rotate the invite", async () => {
    const a = await makePlayer(db);
    const b = await makePlayer(db);
    const c = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    const code = (await groupDetail(a, g.id, "2026-11-11")).inviteCode;
    await joinGroup(b, code);
    await joinGroup(c, code);
    await expect(removeMember(b, g.id, c)).rejects.toMatchObject({ status: 403 });
    await removeMember(a, g.id, c);
    await expect(groupDetail(c, g.id, "2026-11-11")).rejects.toMatchObject({ status: 404 });
    const newCode = await rotateInvite(a, g.id);
    expect(newCode).not.toBe(code);
    await expect(joinGroup(c, code)).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("transfers ownership when the owner leaves and deletes empty groups", async () => {
    const a = await makePlayer(db);
    const b = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    await joinGroup(b, (await groupDetail(a, g.id, "2026-11-11")).inviteCode);
    await leaveGroup(a, g.id);
    expect((await groupDetail(b, g.id, "2026-11-11")).isOwner).toBe(true);
    await leaveGroup(b, g.id);
    expect(await db.query("select * from groups")).toHaveLength(0);
  });
});

describe("leaderboards and comparisons", () => {
  it("ranks the day with shared ranks for ties and only completed players", async () => {
    const a = await makePlayer(db);
    const b = await makePlayer(db);
    const c = await makePlayer(db);
    const d = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    const code = (await groupDetail(a, g.id, "2026-11-11")).inviteCode;
    for (const p of [b, c, d]) await joinGroup(p, code);
    // Exact answers → 5000 for both a and b (deterministic regardless of which questions were picked).
    const ch = await getPlayState(a);
    const answers = await db.query<{ answer: number }>(
      "select answer from challenge_questions where challenge_id = $1 order by position",
      [ch.challenge!.id],
    );
    const same = answers.map((r) => String(r.answer));
    await playAll(a, same);
    await playAll(b, same);
    await playAll(c, [null, null, null, null, null]);
    // d starts but does not finish
    const s = await getPlayState(d);
    await beginRound(d, s.challenge!.id, 1);

    const detail = await groupDetail(a, g.id, "2026-11-11");
    const ranks = Object.fromEntries(detail.daily.map((x) => [x.playerId, x.rank]));
    expect(ranks[a]).toBe(1);
    expect(ranks[b]).toBe(1);
    expect(ranks[c]).toBe(3);
    expect(ranks[d]).toBeUndefined();
    expect(detail.notFinished.map((x) => x.playerId)).toEqual([d]);
  });

  it("shows answer-level comparisons only after the viewer completes, with submitted guesses only", async () => {
    const a = await makePlayer(db);
    const b = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    await joinGroup(b, (await groupDetail(a, g.id, "2026-11-11")).inviteCode);
    await playAll(b, ["5", null, "7", "8", "9"]);

    // a has not played: no comparisons, no reveals
    const s = await getPlayState(a);
    await beginRound(a, s.challenge!.id, 1);
    clock.advance(5000);
    await submitRound(a, s.challenge!.id, 1, "3", "x");
    const partial = await getResults(a, "2026-11-11");
    expect(partial.groups).toBeNull();
    expect(partial.rounds).toHaveLength(1);

    clock.advance(1000);
    for (let p = 2; p <= 5; p++) {
      await beginRound(a, s.challenge!.id, p);
      clock.advance(5000);
      await submitRound(a, s.challenge!.id, p, "3", `x${p}`);
      clock.advance(1000);
    }
    const full = await getResults(a, "2026-11-11");
    expect(full.groups).toHaveLength(1);
    const cmp = full.groups![0];
    expect(cmp.guesses[2].map((x) => x.playerId)).toEqual([a]); // b's blank answer excluded
    expect(cmp.guesses[1]).toHaveLength(2);
    const direct = await groupComparisons(a, s.challenge!.id);
    expect(direct[0].standings).toHaveLength(2);
  });

  it("sums the best five days Monday-Sunday in New York time", async () => {
    const a = await makePlayer(db);
    const g = await createGroup(a, "Lucky", "Guessers");
    // Mon Nov 9 .. Sun Nov 15, 2026: play 6 days
    const days = ["09", "10", "11", "12", "13", "14"];
    for (const d of days) {
      clock.set(`2026-11-${d}T18:00:00Z`);
      await playAll(a, ["1", "1", "1", "1", "1"]);
    }
    clock.set("2026-11-15T18:00:00Z");
    const detail = await groupDetail(a, g.id, "2026-11-15");
    expect(detail.weekStart).toBe("2026-11-09");
    expect(detail.weekly[0].daysPlayed).toBe(6);
    expect(detail.weekly[0].daysCounted).toBe(5);
    const totals = await db.query<{ total_score: number }>("select total_score from attempts order by total_score desc");
    const best5 = totals.slice(0, 5).reduce((s, r) => s + r.total_score, 0);
    expect(detail.weekly[0].total).toBe(best5);
    // Monday 00:30 New York belongs to the new week
    clock.set("2026-11-16T05:30:00Z");
    const next = await groupDetail(a, g.id, "2026-11-16");
    expect(next.weekStart).toBe("2026-11-16");
    expect(next.weekly).toHaveLength(0);
  });
});
