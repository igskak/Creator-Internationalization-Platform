import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import { E2E_EMAIL, ensureE2eUser, removeSourceByTitle } from "./support";

// E2E spec 1 (plan 13 §13.4): add a source → cards appear → edit → approve (chef). The model is
// the scripted fake of the E2E server; the file storage is in memory, so the source is added as
// pasted text (a presigned browser upload needs a real bucket).

const TITLE = `E2E source ${Date.now()}`;
const TEXT =
  "Buckwheat is covered with hot water in the ratio one to two and cooked under a lid for fifteen minutes. Do not lift the lid: the steam finishes the grain.";
const FIRST_SENTENCE =
  "Buckwheat is covered with hot water in the ratio one to two and cooked under a lid for fifteen minutes.";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureE2eUser();
});
test.afterAll(async () => {
  await removeSourceByTitle(TITLE);
});

test("add a source, review its card, edit it and approve it as the chef", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "rc-locale", value: "en", url: "http://localhost:3100" }]);
  const login = await page.request.post("/auth/test-login", {
    headers: { "x-e2e-secret": E2E_SECRET },
    data: { email: E2E_EMAIL },
  });
  expect(login.ok()).toBe(true);

  // --- add the source ---------------------------------------------------------------------
  await page.goto("/knowledge/sources");
  await page.getByRole("button", { name: "Add source" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Pasted text" }).click();
  await dialog.getByLabel("Title").fill(TITLE);
  await dialog.getByLabel("Language of the source").selectOption("en");
  await dialog.getByLabel("Text").fill(TEXT);
  await dialog.getByLabel("AI processing").selectOption("ALLOWED");
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded. Processing has started.")).toBeVisible();

  // The job runs inline, so the source is ready after the page refreshes.
  const row = page.getByRole("row", { name: new RegExp(TITLE) });
  // Every database round trip counts on a slow network, so the job gets a long time.
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 120_000 });
  await expect(row.getByRole("link", { name: "1", exact: true })).toBeVisible();

  // --- the source screen ------------------------------------------------------------------
  await row.getByRole("link", { name: TITLE }).click();
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByText("1 to review, 0 approved")).toBeVisible();

  // --- the card ---------------------------------------------------------------------------
  await page.getByRole("link", { name: "Open the cards" }).click();
  await page
    .getByRole("link", { name: FIRST_SENTENCE.slice(0, 40) })
    .first()
    .click();
  await expect(page.getByText("Needs review", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("The quote was found in the cited pages")).toBeVisible();

  // Edit the claim, save, then approve.
  const claim = page.getByLabel("Claim");
  await claim.fill(`${FIRST_SENTENCE} (checked by the chef)`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Card approved")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Approved as version 1")).toBeVisible();
});
