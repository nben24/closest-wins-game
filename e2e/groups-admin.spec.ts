import { expect, test } from "@playwright/test";
import { onboard, playRound } from "./helpers";

test.skip(({ isMobile }) => isMobile, "covered once on desktop");

test("a second player joins a group by link and appears in the rankings", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await onboard(a);
  await a.goto("/groups");
  await a.getByRole("button", { name: "Create group" }).click();
  await expect(a).toHaveURL(/\/groups\/[0-9a-f-]{36}/);
  const code = (await a.getByLabel(/Invite code/).textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);

  const bCtx = await browser.newContext();
  const b = await bCtx.newPage();
  await b.goto(`/join/${code}`);
  await expect(b.getByText("You're invited to")).toBeVisible();
  await b.getByRole("button", { name: "Join group" }).click();
  await expect(b).toHaveURL(/\/groups\/[0-9a-f-]{36}/);

  // B plays all five
  await b.goto("/play");
  for (let i = 0; i < 5; i++) await playRound(b, String(10 + i), { dismiss: i < 4 });
  await b.getByRole("button", { name: "See my results" }).click();
  await expect(b.getByText(/finished today/)).toBeVisible();

  // A sees B in today's standings (A hasn't played yet)
  await a.reload();
  await expect(a.getByLabel("Today's standings").getByText(/\(you\)/)).toHaveCount(0);
  await expect(a.getByLabel("Today's standings").locator("li")).toHaveCount(1);

  // A outsider can't see the group
  const c = await (await browser.newContext()).newPage();
  await onboard(c);
  const groupUrl = a.url();
  await c.goto(groupUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(c.getByText("Group not available")).toBeVisible();
});

test("the admin can add a question manually; non-admins are refused", async ({ page, request }) => {
  const res = await request.post("/api/admin/jobs/00000000-0000-4000-8000-000000000000/advance");
  expect(res.status()).toBe(403);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("AI generation unavailable")).toBeVisible();

  await page.goto("/admin/questions/new");
  await page.getByLabel(/^Prompt/).fill("How many strings does a standard violin have?");
  await page.getByLabel("Answer", { exact: true }).fill("4");
  await page.getByLabel("Unit").fill("strings");
  await page.getByLabel("Scoring").selectOption("absolute");
  await page.getByLabel("Tolerance").fill("1.5");
  await page.getByLabel("Reveal explanation").fill("Four strings, tuned G, D, A and E.");
  await page.getByLabel("Source URL").fill("https://example.org/violin");
  await page.getByLabel("Source title").fill("Violin");
  await page.getByLabel(/Supporting excerpt/).fill("A standard violin has four strings.");
  await page.getByRole("button", { name: "Add to review queue" }).click();
  await expect(page).toHaveURL(/\/admin\/questions\/[0-9a-f-]{36}/);
  await page.getByLabel(/I opened the source/).check();
  await page.getByLabel(/I reviewed the warnings/).check();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/^Approved \d{4}-\d{2}-\d{2} by admin:local/)).toBeVisible();

  await page.goto("/admin/generate");
  await expect(page.getByText("AI generation is unavailable.")).toBeVisible();
});
