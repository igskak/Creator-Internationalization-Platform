import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import {
  E2E_EMAIL,
  ensureE2eUser,
  removeIdeasOfSource,
  removeSourceByTitle,
  seedApprovedCards,
} from "./support";

// E2E spec 3 (plan 13 §13.4, M2-15): generate an idea → accept → generate ES + EN drafts → the review
// screen shows both markets with their flags and critic panel → regenerate all. The model is the
// scripted fake of the E2E server (adapter, writer and critic answer from the cards of the request).

const SOURCE = `E2E source drafts ${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureE2eUser();
  await seedApprovedCards(SOURCE);
});
test.afterAll(async () => {
  await removeIdeasOfSource(SOURCE);
  await removeSourceByTitle(SOURCE);
});

test("accept an idea, write the drafts, read both markets, regenerate all", async ({
  page,
  context,
}, info) => {
  await context.addCookies([{ name: "rc-locale", value: "en", url: "http://localhost:3100" }]);
  const login = await page.request.post("/auth/test-login", {
    headers: { "x-e2e-secret": E2E_SECRET },
    data: { email: E2E_EMAIL },
  });
  expect(login.ok()).toBe(true);

  // --- an accepted idea ---------------------------------------------------------------------
  await page.goto("/content/ideas");
  await page.getByRole("button", { name: "Generate ideas" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("How many ideas").fill("1");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByText("1 idea added to Proposed.")).toBeVisible({ timeout: 120_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page
    .getByRole("link", { name: /Idea from E2E card/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Idea accepted.")).toBeVisible();
  const ideaId = /\/content\/ideas\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  expect(ideaId).not.toBe("");

  // --- the drafts ---------------------------------------------------------------------------
  await page.getByRole("button", { name: "Generate ES + EN drafts" }).click();
  await expect(page.getByText("Drafts are being written.")).toBeVisible();
  await page.goto(`/content/review/${ideaId}`);
  const spain = page.locator("[data-market='es-ES']");
  const english = page.locator("[data-market='en']");
  await expect(spain.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });
  await expect(english.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });

  // Each market reads as its own post: a different hook, a plan of its own length.
  await expect(spain.getByText("Texto hook", { exact: true }).first()).toBeVisible();
  await expect(english.getByText("Copy hook", { exact: true }).first()).toBeVisible();
  await expect(spain.getByRole("listitem").filter({ hasText: /^Slide \d/ })).toHaveCount(5);
  await expect(english.getByRole("listitem").filter({ hasText: /^Slide \d/ })).toHaveCount(6);
  // Critic panel, quality score and the comparison of the two markets.
  await expect(spain.getByText("Quality 4.42")).toBeVisible();
  await expect(spain.getByRole("region", { name: "Critic" }).getByText("Pass")).toBeVisible();
  await expect(english.getByText("Scripted note of the E2E model.")).toBeVisible();
  await expect(spain.getByText("Different enough")).toBeVisible();
  // The idea column keeps the approved cards next to the drafts.
  await expect(page.getByText("Knowledge cards (approved text)")).toBeVisible();
  await expect(page.getByText(/E2E card [AB]: /).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("review.png"), fullPage: true });

  // --- regenerate all -----------------------------------------------------------------------
  await page.getByRole("button", { name: "Regenerate all" }).click();
  const regenerate = page.getByRole("dialog");
  await regenerate.getByLabel("Instruction for the writer").fill("Open with a question.");
  await regenerate.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.getByText("Regenerating all drafts.")).toBeVisible();
  await expect(spain.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });
  await expect(english.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });
});
