import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { feedbackText, summarizePlay, type PlayedQuestion } from "@/lib/generation-feedback";
import { challengeFeedback, reportProblem, resolveReports, setReaction } from "@/lib/server/feedback";
import { beginRound, getPlayState, submitRound } from "@/lib/server/play";
import { getResults } from "@/lib/server/results";
import { fakeClock, freshDb, makePlayer, resetClock } from "./support/db";

let db: Db;
let clock: ReturnType<typeof fakeClock>;
const DAY = "2026-11-11";
beforeEach(async () => {
  clock = fakeClock("2026-11-11T20:00:00Z");
  db = await freshDb();
});
afterEach(async () => {
  resetClock();
  await db.close();
});

async function play(player: string, rounds = 5) {
  const s = await getPlayState(player);
  const id = s.challenge!.id;
  for (let p = 1; p <= rounds; p++) {
    await beginRound(player, id, p);
    clock.advance(5000);
    await submitRound(player, id, p, "10", `g${p}`);
    clock.advance(500);
  }
  return id;
}

describe("player feedback on questions", () => {
  it("is only allowed after finishing the day", async () => {
    const a = await makePlayer(db);
    await expect(setReaction(a, DAY, 1, 1)).rejects.toMatchObject({ code: "not_finished" });
    await play(a, 2); // mid-game
    await expect(setReaction(a, DAY, 1, 1)).rejects.toMatchObject({ code: "not_finished" });
    await expect(reportProblem(a, DAY, 1, "wrong")).rejects.toMatchObject({ code: "not_finished" });
    expect((await getResults(a, DAY)).feedback).toBeNull();
  });

  it("saves, changes and clears a thumbs up or down, and shows it back on the results screen", async () => {
    const a = await makePlayer(db);
    await play(a);
    await setReaction(a, DAY, 2, 1);
    await setReaction(a, DAY, 3, -1);
    await setReaction(a, DAY, 3, 1);
    await setReaction(a, DAY, 2, null);
    const mine = (await getResults(a, DAY)).feedback!;
    expect(mine).toEqual([
      { position: 2, reaction: null, reported: false },
      { position: 3, reaction: 1, reported: false },
    ]);
  });

  it("sends reports to the admin and lets the admin mark them handled", async () => {
    const [a, b] = [await makePlayer(db), await makePlayer(db)];
    const ch = await play(a);
    await play(b);
    await reportProblem(a, DAY, 4, "  The answer is   out of date  ");
    await reportProblem(b, DAY, 4, "x".repeat(500));
    await setReaction(b, DAY, 4, -1);
    const note = await db.one<{ message: string }>("select message from admin_notifications where kind = 'player_report' and resolved_at is null");
    expect(note!.message).toContain("Q4");

    const fb = (await challengeFeedback(ch)).find((f) => f.position === 4)!;
    expect(fb.down).toBe(1);
    expect(fb.reports.map((r) => r.text)).toEqual(["The answer is out of date", "x".repeat(300)]);
    expect((await getResults(a, DAY)).feedback!.find((f) => f.position === 4)!.reported).toBe(true);

    await resolveReports(ch, 4);
    expect((await challengeFeedback(ch))[0].reports.every((r) => r.resolved)).toBe(true);
    expect(await db.one("select 1 from admin_notifications where kind = 'player_report' and resolved_at is null")).toBeFalsy();

    await expect(reportProblem(a, DAY, 1, "   ")).rejects.toMatchObject({ code: "empty_report" });
    // a second report on the same question replaces the first, and reopens it
    await reportProblem(a, DAY, 4, "Actually the unit is wrong");
    const again = (await challengeFeedback(ch))[0].reports;
    expect(again.map((r) => r.text)).toEqual(["x".repeat(300), "Actually the unit is wrong"]);
    expect(again.find((r) => r.text.startsWith("Actually"))!.resolved).toBe(false);
  });

  it("never shows one player another player's feedback", async () => {
    const [a, b] = [await makePlayer(db), await makePlayer(db)];
    await play(a);
    await play(b);
    await setReaction(a, DAY, 1, -1);
    await reportProblem(a, DAY, 1, "confusing");
    const theirs = await getResults(b, DAY);
    expect(theirs.feedback).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain("confusing");
  });
});

const q = (prompt: string, avgPoints: number, up = 0, down = 0): PlayedQuestion => ({ date: DAY, prompt, difficulty: "medium", players: 10, avgPoints, up, down });

describe("thumbs feed the generator", () => {
  it("lists favorites and dislikes by vote, whatever they scored", () => {
    const played = [q("Clock hands overlap", 120, 6, 0), q("Sea otter hairs", 0, 0, 5), q("Jaws runtime", 667, 1, 0), q("A", 300), q("B", 400)];
    const s = summarizePlay(played)!;
    expect(s.loved.map((x) => x.prompt)).toEqual(["Clock hands overlap"]); // low score, but loved
    expect(s.disliked.map((x) => x.prompt)).toEqual(["Sea otter hairs"]);
    expect(s.loved.some((x) => x.prompt === "Jaws runtime")).toBe(false); // one vote isn't enough
    const text = feedbackText(played, []);
    expect(text).toContain("Players' favorites");
    expect(text).toContain("👍 6");
    expect(text).toContain("thumbs down");
  });
});
