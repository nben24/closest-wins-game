import { expect, test } from "@playwright/test";
import { onboard, playRound, typeOnKeypad, waitForAnswering } from "./helpers";

test("a guest plays all five with practice, refresh, timeout auto-submit and sharing", async ({ page, context, browserName }) => {
  const exposed: string[] = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/play/begin") || url.includes("/api/play/state")) {
      const body = await res.text().catch(() => "");
      const data = JSON.parse(body || "{}") as { rounds?: { status: string; reveal: unknown }[] };
      for (const r of data.rounds ?? []) if (r.status === "open" && r.reveal) exposed.push(url);
      if (/"answer"\s*:/.test(body) && (data.rounds ?? []).every((r) => r.status === "open")) exposed.push(url);
    }
  });

  await onboard(page);

  // Optional practice (untimed)
  await page.getByRole("link", { name: "Try a practice question first" }).click();
  await expect(page.getByText("Practice · no timer")).toBeVisible();
  await typeOnKeypad(page, "1440");
  await page.getByRole("button", { name: "Check my guess" }).click();
  await expect(page.getByText("Exactly right!")).toBeVisible();
  await page.getByRole("link", { name: "Play today's five" }).click();

  // Q1: input disabled while reading, then answer
  await page.getByRole("button", { name: "Show the question" }).click();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeDisabled();
  await waitForAnswering(page);
  await typeOnKeypad(page, "100");
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByText("Your guess")).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  // Q2: refresh mid-round must not reset the timer
  await page.getByRole("button", { name: "Show the question" }).click();
  await waitForAnswering(page);
  await page.waitForTimeout(3_000);
  const before = Number((await page.getByRole("timer").textContent())!.replace("s", ""));
  await page.reload();
  await expect(page.getByText("Answer now")).toBeVisible();
  const after = Number((await page.getByRole("timer").textContent())!.replace("s", ""));
  expect(after).toBeLessThanOrEqual(before);
  expect(after).toBeLessThan(10);
  await typeOnKeypad(page, "5");
  await page.getByRole("button", { name: "Lock it in" }).click();
  await page.getByRole("button", { name: "Next question" }).click();

  // Q3: type but never press submit — the entry is submitted at the deadline
  await page.getByRole("button", { name: "Show the question" }).click();
  await waitForAnswering(page);
  await typeOnKeypad(page, "7");
  await expect(page.getByText("Your guess")).toBeVisible({ timeout: 16_000 });
  await expect(page.locator("section").filter({ hasText: "Your guess" }).getByText(/^7/).first()).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();

  await playRound(page, "3");
  await playRound(page, "20", { dismiss: false });
  await page.getByRole("button", { name: "See my results" }).click();

  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText(/out of 5,000/)).toBeVisible();
  await expect(page.getByText("Your five")).toBeVisible();

  // Share (clipboard fallback on desktop; mobile has a coarse pointer and uses the share sheet if present)
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    // force the clipboard path for a deterministic test
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await page.getByRole("button", { name: "Share results" }).click();
  await expect(page.getByText("Copied! Paste it in your group chat.")).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toMatch(/^Closest Wins #\d+ · /);
  expect(shared).toMatch(/\/ 5,000/);
  expect(shared.split("\n")[2]).toMatch(/^[🎯🟢🟡🟠⚪➖]{5}$/u);
  expect(shared).not.toMatch(/bones|keys|answer/i);

  // Persistence: returning to home shows the completed score
  await page.goto("/");
  await expect(page.getByRole("link", { name: "See results & share" })).toBeVisible();
  await page.goto("/history");
  await expect(page.getByText(/#\d+ ·/).first()).toBeVisible();

  expect(exposed).toEqual([]);
});
