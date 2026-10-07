import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import {
  E2E_EMAIL,
  ensureE2eUser,
  removeIdeasOfSource,
  removeSourceByTitle,
  seedApprovedCards,
} from "./support";

// E2E spec 2 (plan 13 §13.4, M2-08): generate ideas from approved cards → open one → accept it;
// write an idea by hand with the card picker → reject it with a reason. The model is the scripted
// fake of the E2E server. The cards are seeded straight into the database (their ingestion is
// spec 1) and removed afterwards together with the ideas made here.

const SOURCE = `E2E source ideas ${Date.now()}`;
const MANUAL_TOPIC = "E2E manual idea about the water ratio";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureE2eUser();
  await seedApprovedCards(SOURCE);
});
test.afterAll(async () => {
  await removeIdeasOfSource(SOURCE);
  await removeSourceByTitle(SOURCE);
});

test("generate ideas, accept one, write one by hand and reject it", async ({
  page,
  context,
}, info) => {
  await context.addCookies([{ name: "rc-locale", value: "en", url: "http://localhost:3100" }]);
  const login = await page.request.post("/auth/test-login", {
    headers: { "x-e2e-secret": E2E_SECRET },
    data: { email: E2E_EMAIL },
  });
  expect(login.ok()).toBe(true);

  // --- generate -----------------------------------------------------------------------------
  await page.goto("/content/ideas");
  await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate ideas" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("How many ideas").fill("1");
  await dialog.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(dialog.getByText("1 idea added to Proposed.")).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: info.outputPath("generate-done.png") });
  await dialog.getByRole("button", { name: "Done" }).click();

  // --- the generated idea -------------------------------------------------------------------
  const generated = page.getByRole("link", { name: /Idea from E2E card/ }).first();
  await expect(generated).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: info.outputPath("ideas-list.png") });
  await generated.click();
  await expect(page.getByText("Suggested by the model")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "E2E card A: rinsing rice", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("the surface starch makes it creamy")).toBeVisible();
  await page.screenshot({ path: info.outputPath("idea-detail.png"), fullPage: true });

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Idea accepted.")).toBeVisible();
  await expect(page.getByText("Accepted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate ES + EN drafts" })).toBeDisabled();

  // --- a manual idea ------------------------------------------------------------------------
  await page.goto("/content/ideas/new");
  await page.getByLabel("Topic").fill(MANUAL_TOPIC);
  await page
    .getByLabel("Core message")
    .fill("Two parts of water to one part of long-grain rice keep it fluffy.");
  await page.getByLabel("Find a card").fill("E2E card B");
  await page.getByRole("button", { name: /Add: E2E card B/ }).click();
  await expect(page.getByLabel(/E2E card B.*Primary/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("idea-form.png"), fullPage: true });
  await page.getByRole("button", { name: "Create idea" }).click();
  await expect(page.getByText("Idea created.")).toBeVisible();
  await expect(page.getByRole("heading", { name: MANUAL_TOPIC })).toBeVisible();
  await expect(page.getByText("Written by hand")).toBeVisible();

  // --- reject it ----------------------------------------------------------------------------
  await page.getByRole("button", { name: "Reject" }).click();
  const reject = page.getByRole("dialog");
  await expect(reject.getByRole("button", { name: "Reject" })).toBeDisabled();
  await reject.getByLabel("Reason").fill("Too basic");
  await reject.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Idea rejected.")).toBeVisible();
  await expect(page.getByText("Rejected: Too basic")).toBeVisible();

  await page.goto("/content/ideas?status=REJECTED");
  await expect(page.getByRole("link", { name: MANUAL_TOPIC })).toBeVisible();
});
