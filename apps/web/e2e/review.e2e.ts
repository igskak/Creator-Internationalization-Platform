import { expect, type Page, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import {
  E2E_EDITOR_EMAIL,
  ensureE2eUser,
  removeIdeasOfSource,
  removeSourceByTitle,
  seedApprovedCards,
} from "./support";

// E2E spec 3 (plan 13 §13.4, M4-10): edit the hook → regenerate a slide → approve with the
// checklist → schedule → the calendar shows it (then move it and call it off). The model is the
// scripted fake of the E2E server; pictures and renders use the fakes of that server too.

const SOURCE = `E2E source review ${Date.now()}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureE2eUser(E2E_EDITOR_EMAIL, "editor");
  await seedApprovedCards(SOURCE);
});
test.afterAll(async () => {
  await removeIdeasOfSource(SOURCE);
  await removeSourceByTitle(SOURCE);
});

const signIn = async (page: Page, email: string) => {
  await page
    .context()
    .addCookies([{ name: "rc-locale", value: "en", url: "http://localhost:3100" }]);
  const login = await page.request.post("/auth/test-login", {
    headers: { "x-e2e-secret": E2E_SECRET },
    data: { email },
  });
  expect(login.ok()).toBe(true);
};

/** A date `days` from now as "2099-…"-style `YYYY-MM-DD`, in UTC (the day is what matters, not the hour). */
const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test("edit the hook, regenerate a slide, approve, schedule and see it in the calendar", async ({
  page,
}, info) => {
  await signIn(page, E2E_EDITOR_EMAIL);

  // --- an accepted idea with drafts for both markets ------------------------------------------
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
  await page.getByRole("button", { name: "Generate ES + EN drafts" }).click();
  await expect(page.getByText("Drafts are being written.")).toBeVisible();

  await page.goto(`/content/review/${ideaId}`);
  const spain = page.locator("[data-market='es-ES']");
  await expect(spain.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });
  // The drafts show up in the queue and as a counter on the dashboard.
  await page.goto("/content/drafts");
  await expect(page.locator("tr[data-market='es-ES']").first()).toContainText("Ready for review");
  await page.goto("/dashboard");
  await expect(page.locator("[data-counter='draftsReady']")).toBeVisible();
  await page.goto(`/content/review/${ideaId}`);

  // --- edit the hook ----------------------------------------------------------------------------
  await spain.getByRole("button", { name: "Edit: hook" }).click();
  const hook = spain.getByRole("textbox", { name: "Hook" });
  await hook.fill("Gancho editado a mano");
  await spain.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(spain.getByText("Gancho editado a mano", { exact: true })).toBeVisible();

  // --- regenerate slide 2 -----------------------------------------------------------------------
  await spain.getByRole("button", { name: "Regenerate the slide 2" }).click();
  await page.getByLabel("What should change?").fill("Say it more simply.");
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(page.getByText("Redoing the slide 2…")).toBeVisible();
  const diff = spain.getByTestId("regeneration-diff");
  await expect(diff).toBeVisible({ timeout: 60_000 });
  await expect(diff).toContainText("(redone)");
  await diff.getByRole("button", { name: "Keep" }).click();
  await expect(diff).toBeHidden();

  // --- approve ----------------------------------------------------------------------------------
  // The carousel is rendered again after the edits; approval waits for the current render.
  const approve = spain.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeEnabled({ timeout: 180_000 });
  await page.screenshot({ path: info.outputPath("review-edited.png"), fullPage: true });
  await approve.click();
  const approveDialog = page.getByRole("dialog");
  await approveDialog.getByLabel("Facts checked against the cards").check();
  await approveDialog.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved as version 1/)).toBeVisible();
  await expect(spain.getByText("Approved", { exact: true }).first()).toBeVisible();

  // --- schedule from the calendar -----------------------------------------------------------------
  const day = dateIn(3);
  await page.goto("/content/calendar");
  const waiting = page.getByTestId("approved-sidebar");
  await expect(waiting).toContainText("Gancho editado a mano");
  await waiting.getByRole("button", { name: "Schedule…" }).first().click();
  const schedule = page.getByRole("dialog");
  await schedule.getByLabel(/Date and time/).fill(`${day}T11:00`);
  await schedule.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByText(/Scheduled for/)).toBeVisible();
  // Publishing is switched off and no account is connected: the dialog says so.
  await expect(schedule.getByRole("status")).toContainText("Publishing is switched off.");
  await schedule.getByRole("button", { name: "Close" }).click();

  await page.goto(`/content/calendar?week=${day}`);
  const post = page.locator(`[data-date='${day}']`).getByRole("button", { name: /Gancho editado/ });
  await expect(post).toBeVisible();
  await expect(waiting).toContainText("Every approved draft has a time.");
  await page.screenshot({ path: info.outputPath("calendar.png"), fullPage: true });

  // --- move it, then call it off ------------------------------------------------------------------
  await post.click();
  const postDialog = page.getByRole("dialog");
  await postDialog.getByLabel(/Date and time/).fill(`${day}T15:30`);
  await postDialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText(/Moved to/)).toBeVisible();
  await postDialog.getByRole("button", { name: "Call off this post" }).click();
  await postDialog.getByLabel("Why?").fill("Test over");
  await postDialog.getByRole("button", { name: "Call off the post" }).click();
  await expect(page.getByText("Post called off.")).toBeVisible();
  await page.goto("/content/calendar");
  await expect(page.getByTestId("approved-sidebar")).toContainText("Gancho editado a mano");
});
