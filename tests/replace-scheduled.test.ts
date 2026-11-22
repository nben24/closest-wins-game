import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { listChallenges } from "@/lib/server/admin/ops";
import { setQuestionStatus } from "@/lib/server/admin/questions";
import { fillSchedule, getPlayableChallenge, publishChallenge, replaceRemovedScheduled, today } from "@/lib/server/challenges";
import { addDays } from "@/lib/time";
import { fakeClock, freshDb, resetClock } from "./support/db";

let db: Db;
beforeEach(async () => {
  fakeClock("2026-11-16T20:00:00Z");
  db = await freshDb();
});
afterEach(async () => {
  resetClock();
  await db.close();
});

const slot = (date: string, position: number) =>
  db.one<{ challenge_id: string; question_id: string; replaced_question_id: string | null }>(
    `select cq.challenge_id, cq.question_id, cq.replaced_question_id from challenge_questions cq
       join daily_challenges dc on dc.id = cq.challenge_id where dc.challenge_date = $1 and cq.position = $2`,
    [date, position],
  );

describe("replacing removed questions on scheduled days", () => {
  it("swaps a rejected question out right away and remembers what it replaced", async () => {
    const day = addDays(today(), 2);
    await fillSchedule(addDays(today(), 1), 3, "admin");
    const before = (await slot(day, 3))!;
    const oldPrompt = (await db.one<{ prompt: string; difficulty: string }>("select prompt, difficulty from questions where id = $1", [before.question_id]))!;

    await setQuestionStatus(before.question_id, "rejected", "admin", "wrong");
    const after = (await slot(day, 3))!;
    expect(after.question_id).not.toBe(before.question_id);
    expect(after.replaced_question_id).toBe(before.question_id);
    const repl = await db.one<{ status: string; difficulty: string }>("select status, difficulty from questions where id = $1", [after.question_id]);
    expect(repl).toMatchObject({ status: "approved", difficulty: oldPrompt.difficulty });

    // the schedule page shows the badge and the old question
    const listed = (await listChallenges(day, 1))[0].questions.find((q) => q.position === 3)!;
    expect(listed.replaced?.prompt).toBe(oldPrompt.prompt);
  });

  it("also catches questions rejected directly in the database (e.g. the SQL editor)", async () => {
    await fillSchedule(addDays(today(), 1), 2, "admin");
    const a = (await slot(addDays(today(), 1), 1))!;
    const b = (await slot(addDays(today(), 2), 4))!;
    await db.query("update questions set status = 'rejected' where id = any($1::uuid[])", [[a.question_id, b.question_id]]);
    expect(await replaceRemovedScheduled("admin")).toEqual({ replaced: 2, stuck: 0 });
    expect((await slot(addDays(today(), 1), 1))!.replaced_question_id).toBe(a.question_id);
    expect((await slot(addDays(today(), 2), 4))!.replaced_question_id).toBe(b.question_id);
    // all five on each day are still different questions, and nothing runs twice
    const ids = await db.query<{ question_id: string }>("select question_id from challenge_questions");
    expect(new Set(ids.map((r) => r.question_id)).size).toBe(ids.length);
    expect(await replaceRemovedScheduled("admin")).toEqual({ replaced: 0, stuck: 0 });
  });

  it("leaves questions sent back to review alone, so they can be re-approved", async () => {
    await fillSchedule(addDays(today(), 1), 1, "admin");
    const s = (await slot(addDays(today(), 1), 2))!;
    await setQuestionStatus(s.question_id, "review", "admin");
    expect((await slot(addDays(today(), 1), 2))!.question_id).toBe(s.question_id);
  });

  it("never touches a published day", async () => {
    const ch = (await getPlayableChallenge(today()))!;
    const s = (await slot(today(), 1))!;
    await db.query("update questions set status = 'archived' where id = $1", [s.question_id]);
    expect((await replaceRemovedScheduled()).replaced).toBe(0);
    expect((await slot(today(), 1))!.question_id).toBe(s.question_id);
    expect(ch.status).toBe("published");
  });

  it("marks questions swapped at publish time the same way", async () => {
    await fillSchedule(addDays(today(), 1), 1, "admin");
    const s = (await slot(addDays(today(), 1), 5))!;
    await db.query("update questions set status = 'review' where id = $1", [s.question_id]);
    await db.tx((sql) => publishChallenge(sql, s.challenge_id, "test"));
    expect((await slot(addDays(today(), 1), 5))!.replaced_question_id).toBe(s.question_id);
  });
});
