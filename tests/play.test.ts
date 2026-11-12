import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { fakeClock, freshDb, makePlayer, resetClock } from "./support/db";

// 2026-11-11 15:00 New York (EST) — mid-afternoon on game day 2026-11-11.
const NOON = "2026-11-11T20:00:00.000Z";

let db: Db;
let clock: ReturnType<typeof fakeClock>;
let player: string;

beforeEach(async () => {
  clock = fakeClock(NOON);
  db = await freshDb();
  player = await makePlayer(db);
});
afterEach(async () => {
  resetClock();
  await db.close();
});

async function correctAnswer(position: number, challengeId: string) {
  const r = await db.one<{ answer: number }>("select answer from challenge_questions where challenge_id = $1 and position = $2", [challengeId, position]);
  return r!.answer;
}

describe("round lifecycle", () => {
  it("publishes today's challenge on demand without exposing answers", async () => {
    const s = await getPlayState(player);
    expect(s.challenge?.date).toBe("2026-11-11");
    expect(s.challenge?.isDemo).toBe(true);
    expect(s.nextPosition).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(/"answer"/);
    const b = await beginRound(player, s.challenge!.id, 1);
    const open = b.rounds[0];
    expect(open.status).toBe("open");
    expect(open.reveal).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/"answer"|explanation|sourceUrl/);
  });

  it("enforces the 4s reading phase and 10s answer window", async () => {
    const s = await getPlayState(player);
    const b = await beginRound(player, s.challenge!.id, 1);
    const r = b.rounds[0];
    expect(new Date(r.answerOpensAt).getTime() - new Date(r.readingStartedAt).getTime()).toBe(4000);
    expect(new Date(r.deadlineAt).getTime() - new Date(r.answerOpensAt).getTime()).toBe(10000);
    clock.advance(2000);
    await expect(submitRound(player, s.challenge!.id, 1, "5", "a")).rejects.toMatchObject({ code: "too_early" });
    clock.advance(1800); // 3.8s: within the 300ms early tolerance
    const ok = await submitRound(player, s.challenge!.id, 1, "5", "a");
    expect(ok.round.status).toBe("answered");
  });

  it("does not reset the timer on refresh or a second begin", async () => {
    const s = await getPlayState(player);
    const first = await beginRound(player, s.challenge!.id, 1);
    clock.advance(6000);
    const again = await beginRound(player, s.challenge!.id, 1);
    expect(again.rounds[0].deadlineAt).toBe(first.rounds[0].deadlineAt);
    const refreshed = await getPlayState(player);
    expect(refreshed.rounds[0].deadlineAt).toBe(first.rounds[0].deadlineAt);
    expect(refreshed.rounds[0].status).toBe("open");
    // A begin for the *next* position while one is open returns the open round
    const tab2 = await beginRound(player, s.challenge!.id, 2);
    expect(tab2.rounds).toHaveLength(1);
    expect(tab2.rounds[0].position).toBe(1);
  });

  it("accepts submissions within the grace period and rejects them after", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    await beginRound(player, id, 1);
    clock.advance(14_000 + 1_400); // deadline + 1.4s
    const ok = await submitRound(player, id, 1, String(await correctAnswer(1, id)), "x");
    expect(ok.late).toBe(false);
    expect(ok.round.reveal!.score).toBe(1000);

    await beginRound(player, id, 2);
    clock.advance(14_000 + 1_600); // deadline + 1.6s
    const late = await submitRound(player, id, 2, String(await correctAnswer(2, id)), "y");
    expect(late.late).toBe(true);
    expect(late.round.status).toBe("timed_out");
    expect(late.round.reveal!.score).toBe(0);
  });

  it("finalizes expired rounds as timed out when state is read", async () => {
    const s = await getPlayState(player);
    await beginRound(player, s.challenge!.id, 1);
    clock.advance(60_000);
    const after = await getPlayState(player);
    expect(after.rounds[0].status).toBe("timed_out");
    expect(after.rounds[0].reveal?.score).toBe(0);
    expect(after.nextPosition).toBe(2);
  });

  it("is idempotent: duplicate submissions never rescore", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    await beginRound(player, id, 1);
    clock.advance(5000);
    const answer = await correctAnswer(1, id);
    const first = await submitRound(player, id, 1, String(answer * 3), "s1");
    const dup = await submitRound(player, id, 1, String(answer), "s2");
    expect(dup.duplicate).toBe(true);
    expect(dup.round.reveal!.score).toBe(first.round.reveal!.score);
    expect(dup.state.attempt!.totalScore).toBe(first.state.attempt!.totalScore);
    // concurrent duplicates
    await beginRound(player, id, 2);
    clock.advance(5000);
    const results = await Promise.all([1, 2, 3].map((i) => submitRound(player, id, 2, "1", `c${i}`)));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const rounds = await db.query("select * from rounds where position = 2");
    expect(rounds).toHaveLength(1);
  });

  it("rejects out-of-order rounds and scoring of rounds not started", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    await expect(beginRound(player, id, 3)).rejects.toMatchObject({ code: "out_of_order" });
    await expect(submitRound(player, id, 1, "4", "z")).rejects.toMatchObject({ code: "not_started" });
  });

  it("treats blank or invalid input as zero and zero as a valid guess", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    await beginRound(player, id, 1);
    clock.advance(5000);
    const blank = await submitRound(player, id, 1, "", "b");
    expect(blank.round.status).toBe("no_answer");
    expect(blank.round.reveal!.score).toBe(0);
    await beginRound(player, id, 2);
    clock.advance(5000);
    const junk = await submitRound(player, id, 2, "12abc", "j");
    expect(junk.round.status).toBe("no_answer");
    await beginRound(player, id, 3);
    clock.advance(5000);
    const zero = await submitRound(player, id, 3, "0", "z");
    expect(zero.round.status).toBe("answered");
    expect(zero.round.reveal!.guess).toBe(0);
  });

  it("completes after five rounds and computes the total on the server", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    let total = 0;
    for (let p = 1; p <= 5; p++) {
      await beginRound(player, id, p);
      clock.advance(5000);
      const r = await submitRound(player, id, p, String(await correctAnswer(p, id)), `p${p}`);
      total += r.round.reveal!.score;
    }
    const done = await getPlayState(player);
    expect(done.attempt).toMatchObject({ status: "completed", totalScore: 5000, roundsFinished: 5 });
    expect(total).toBe(5000);
    expect(done.nextPosition).toBeNull();
    await expect(beginRound(player, id, 1)).resolves.toBeDefined(); // returns existing, no new round
    const count = await db.one<{ n: number }>("select count(*)::int as n from rounds");
    expect(count!.n).toBe(5);
  });

  it("serves the same challenge to everyone", async () => {
    const other = await makePlayer(db);
    const a = await getPlayState(player);
    const b = await getPlayState(other);
    expect(a.challenge!.id).toBe(b.challenge!.id);
  });

  it("rolls over at New York midnight and refuses to begin yesterday's challenge", async () => {
    const s = await getPlayState(player);
    clock.set("2026-11-12T05:00:01.000Z"); // 00:00:01 EST Nov 12
    const next = await getPlayState(player);
    expect(next.challenge!.date).toBe("2026-11-12");
    expect(next.challenge!.id).not.toBe(s.challenge!.id);
    await expect(beginRound(player, s.challenge!.id, 1)).rejects.toMatchObject({ code: "challenge_changed" });
  });
});

describe("database integrity", () => {
  it("makes published challenges immutable", async () => {
    const s = await getPlayState(player);
    const id = s.challenge!.id;
    await expect(db.query("update challenge_questions set answer = 1 where challenge_id = $1 and position = 1", [id])).rejects.toThrow(/immutable/);
    await expect(db.query("delete from challenge_questions where challenge_id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(db.query("delete from daily_challenges where id = $1", [id])).rejects.toThrow(/cannot be deleted/);
    // voiding is allowed (audited correction path)
    await db.query("update challenge_questions set voided = true, voided_reason = 'test' where challenge_id = $1 and position = 1", [id]);
  });

  it("refuses to change a finalized round", async () => {
    const s = await getPlayState(player);
    await beginRound(player, s.challenge!.id, 1);
    clock.advance(5000);
    await submitRound(player, s.challenge!.id, 1, "1", "x");
    await expect(db.query("update rounds set score = 1000")).rejects.toThrow(/finalized/);
  });

  it("only lets approved questions be scheduled", async () => {
    const q = await db.one<{ id: string }>("update questions set status = 'review' where id = (select id from questions limit 1) returning id");
    const ch = await db.one<{ id: string }>("insert into daily_challenges (challenge_date, number) values ('2027-01-01', 1) returning id");
    await expect(
      db.query("insert into challenge_questions (challenge_id, position, question_id) values ($1, 1, $2)", [ch!.id, q!.id]),
    ).rejects.toThrow(/approved/);
  });

  it("requires sources before a non-demo question can be approved", async () => {
    await expect(
      db.query(
        `insert into questions (prompt, answer, unit, category, difficulty, scoring_type, tolerance, normalized_prompt, status, provenance)
         values ('How many test things exist here?', 5, 'x', 'everyday', 'easy', 'ratio', 1.5, 'how many test things exist here', 'approved', 'ai')`,
      ),
    ).rejects.toThrow(/questions_approved_needs_source/);
  });
});
