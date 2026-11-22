import { describe, expect, it } from "vitest";
import { feedbackText, summarizePlay, type PlayedQuestion } from "@/lib/generation-feedback";
import { proposalUserPrompt } from "@/lib/server/ai/prompts";

const q = (prompt: string, difficulty: string, avgPoints: number, players = 12): PlayedQuestion => ({ date: "2026-11-20", prompt, difficulty, players, avgPoints });

// Shaped like the live results from 2026-11-12 to 2026-11-22.
const played = [
  q("How many minutes long is Jaws?", "easy", 667),
  q("What was the US launch price of the Nintendo Switch?", "medium", 705),
  q("How many hairs per square inch of sea otter fur?", "medium", 0),
  q("What is the surface area of Lake Superior in square kilometres?", "easy", 4),
  q("How many countries border Germany?", "easy", 27),
  q("How many days did it take to build the Empire State Building?", "hard", 463),
  q("How many Oscars did Ben-Hur win?", "hard", 19),
  q("How many calories are in a medium banana?", "easy", 504),
  q("A question with too few players", "easy", 1000, 3),
];

describe("generator feedback from real play", () => {
  it("judges each difficulty against what players actually scored", () => {
    const s = summarizePlay(played)!;
    expect(s.byDifficulty.find((d) => d.difficulty === "easy")).toMatchObject({ count: 4, verdict: "too_hard" });
    expect(s.good.map((x) => x.avgPoints)).toEqual([705, 667, 504, 463]);
    expect(s.flops[0].avgPoints).toBe(0);
    expect(s.falseEasy.map((x) => x.prompt)).toContain("How many countries border Germany?");
    // questions with too few players are ignored
    expect(JSON.stringify(s)).not.toContain("too few players");
  });

  it("stays quiet with too little data, but still lists recent questions", () => {
    expect(summarizePlay(played.slice(0, 3))).toBeNull();
    const text = feedbackText(played.slice(0, 3), ["How many Oscars did Forrest Gump win?"]);
    expect(text).not.toContain("How real players scored");
    expect(text).toContain("Forrest Gump");
  });

  it("ends up in the generator's request", () => {
    const feedback = feedbackText(played, ["What did the Sony Walkman cost at launch?"]);
    expect(feedback).toContain("TOO HARD");
    expect(feedback).toContain("Flops");
    const prompt = proposalUserPrompt({ count: 3, categories: ["food"], difficulty: { easy: 40, medium: 40, hard: 20 }, instructions: "", avoidSubjects: [], feedback });
    expect(prompt).toContain("Sony Walkman");
    expect(prompt).toContain("players averaged 667");
  });
});
