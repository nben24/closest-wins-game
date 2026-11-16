import { expect, type Page } from "@playwright/test";

export async function onboard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Let's play" }).click();
  await expect(page.getByRole("heading", { name: /Challenge #/ })).toBeVisible();
}

/** Type digits on the in-app keypad. */
export async function typeOnKeypad(page: Page, digits: string) {
  for (const d of digits) await page.getByRole("button", { name: d, exact: true }).click();
}

/** Type a guess that can be locked in: year questions only accept plausible years. */
export async function typeGuess(page: Page, digits: string) {
  const isYear = await page.getByText("Enter a year, like 1995").isVisible();
  await typeOnKeypad(page, isYear ? "1990" : digits);
}

export async function waitForAnswering(page: Page) {
  await expect(page.getByText("Answer now")).toBeVisible({ timeout: 8_000 });
}

/** Play one round: begin, wait for the reading phase, type, lock in, dismiss reveal. */
export async function playRound(page: Page, digits = "12", opts: { dismiss?: boolean } = {}) {
  await page.getByRole("button", { name: "Show the question" }).click();
  await expect(page.getByText("Reading", { exact: true })).toBeVisible();
  await waitForAnswering(page);
  await typeGuess(page, digits);
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByText("Your guess")).toBeVisible();
  if (opts.dismiss !== false) {
    await page.getByRole("button", { name: /Next question|See my results/ }).click();
  }
}
