import { describe, expect, it } from "vitest";
import { hasErrors, runContentChecks, type QuestionDraft } from "@/lib/content-checks";
import { excerptInText, htmlToText, textMentionsNumber } from "@/lib/server/source-check";

const base: QuestionDraft = {
  prompt: "How many keys are on a standard modern piano?",
  answer: 88, unit: "keys", category: "everyday", difficulty: "easy", scoringType: "ratio", tolerance: 1.25,
  allowDecimal: false, allowNegative: false, explanation: "52 white and 36 black.",
  sourceUrl: "https://example.org/piano", sourceTitle: "Piano", sourceExcerpt: "A modern piano has 88 keys.", referencePeriod: null,
};

describe("content checks", () => {
  it("passes a good question", () => {
    expect(hasErrors(runContentChecks(base))).toBe(false);
  });
  it("blocks missing sources, long prompts, net worth and unsuitable topics", () => {
    expect(hasErrors(runContentChecks({ ...base, sourceUrl: null }))).toBe(true);
    expect(hasErrors(runContentChecks({ ...base, sourceExcerpt: "" }))).toBe(true);
    expect(hasErrors(runContentChecks({ ...base, prompt: `${"word ".repeat(30)}?` }))).toBe(true);
    expect(hasErrors(runContentChecks({ ...base, prompt: "What is the net worth of a famous singer?" }))).toBe(true);
    expect(hasErrors(runContentChecks({ ...base, prompt: "How many beers are sold at a stadium each year?" }))).toBe(true);
  });
  it("warns about undefined averages and relative time", () => {
    const r = runContentChecks({ ...base, prompt: "How tall is the average giraffe?" });
    expect(r.some((x) => x.code === "vague_average")).toBe(true);
    const r2 = runContentChecks({ ...base, prompt: "How much does a stamp currently cost?" });
    expect(r2.some((x) => x.code === "relative_time")).toBe(true);
  });
  it("rejects invalid scoring setups", () => {
    expect(hasErrors(runContentChecks({ ...base, scoringType: "ratio", answer: 0 }))).toBe(true);
    expect(hasErrors(runContentChecks({ ...base, scoringType: "year", answer: 1997, allowDecimal: true, tolerance: 4 }))).toBe(true);
  });
});

describe("source excerpt verification", () => {
  const page = htmlToText(`<html><head><title>Piano facts</title><script>ignore("88 keys")</script></head>
    <body><p>The modern piano has <b>88&nbsp;keys</b>: 52 white and 36 black.[3]</p><p>Population: 1,234,567 people.</p></body></html>`);
  it("strips scripts and finds real quotes", () => {
    expect(page.title).toBe("Piano facts");
    expect(excerptInText("The modern piano has 88 keys: 52 white and 36 black.", page.text)).toBe(true);
    expect(excerptInText("The modern piano has 92 keys: 52 white and 40 black.", page.text)).toBe(false);
    expect(excerptInText("88", page.text)).toBe(false); // too short to count as evidence
  });
  it("matches numbers in common formats", () => {
    expect(textMentionsNumber("The modern piano has 88 keys", 88)).toBe(true);
    expect(textMentionsNumber("The modern piano has 188 keys", 88)).toBe(false);
    expect(textMentionsNumber("about 1,234,567 people", 1234567)).toBe(true);
    expect(textMentionsNumber("roughly 1.5 million visitors", 1_500_000)).toBe(true);
    expect(textMentionsNumber("an octopus has three hearts", 3)).toBe(true);
    expect(textMentionsNumber("it is 26.2 miles long", 26.2)).toBe(true);
  });
});
