import { expect as baseExpect, type Page, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import {
  deactivateE2eUser,
  E2E_OWNER_EMAIL,
  ensureE2eUser,
  readSetting,
  removeIdeasOfSource,
  removeSourceByTitle,
  seedApprovedCards,
  writeSetting,
} from "./support";

// E2E spec 4 (plan 13 §13.4, M8-07a): the Reel card from the switch to the approval. Settings → AI
// switches Reel generation on; the Reel is made for real by the E2E server (the scripted director,
// a video provider that returns small real clips, ffmpeg and Chromium for the assembly): estimate,
// confirm, progress, video; change hook; redo a shot; approve; the drafts queue and the calendar
// show it with a Reel badge; schedule, call off, withdraw the approval, reject.
// Needs ffmpeg on the machine that runs the server. The database is a shared dev project that a
// deployment may use as well, so the test never switches a live switch off: when `reels.enabled`
// is already on, the off-to-on part is skipped (the component tests cover it); when it is off, the
// test switches it on through Settings and puts it back at the end.

// The jobs run inside the web server of this test (JOBS_MODE=inline): while the Reel is assembled
// (ffmpeg, Chromium, the beat) the page answers slowly, so every expectation waits longer.
const expect = baseExpect.configure({ timeout: 60_000 });

const SOURCE = `E2E source reels ${Date.now()}`;

test.describe.configure({ mode: "serial" });

let originalSwitch: unknown;
test.beforeAll(async () => {
  await ensureE2eUser(E2E_OWNER_EMAIL, "owner");
  await seedApprovedCards(SOURCE);
  originalSwitch = await readSetting("reels.enabled");
});
test.afterAll(async () => {
  if (originalSwitch !== true) await writeSetting("reels.enabled", originalSwitch);
  await removeIdeasOfSource(SOURCE);
  await removeSourceByTitle(SOURCE);
  // An owner account on a shared project must not stay usable after the test.
  await deactivateE2eUser(E2E_OWNER_EMAIL);
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

const dateIn = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The dollars in "Cost so far: $2.31". */
const costOf = async (text: string | null) =>
  Number(/\$([\d.,]+)/.exec(text ?? "")?.[1] ?? Number.NaN);

test("switch Reels on, make a Reel, change its hook, redo a shot, approve, schedule, withdraw and reject", async ({
  page,
}, info) => {
  test.setTimeout(900_000);
  await signIn(page, E2E_OWNER_EMAIL);

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

  const review = `/content/review/${ideaId}`;
  await page.goto(review);
  const spain = page.locator("[data-market='es-ES']");
  await expect(spain.getByText("Ready for review")).toBeVisible({ timeout: 120_000 });
  const reel = spain.getByRole("region", { name: "Reel", exact: true });
  const generate = reel.getByRole("button", { name: /Generate Reel/ });

  await page.goto("/settings/ai");
  const switchBox = page.getByRole("region", { name: "Reel generation" });
  if (originalSwitch === true) {
    await expect(switchBox.getByText("On", { exact: true })).toBeVisible();
  } else {
    // --- the switch is off: the button says why ---------------------------------------------------
    // The pictures of the carousel come from inline jobs; until they are there the reason is another.
    await page.goto(review);
    await expect(async () => {
      await page.reload();
      await expect(
        spain
          .getByRole("region", { name: "Reel", exact: true })
          .getByText("Reel generation is switched off in Settings."),
      ).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 180_000 });
    await expect(generate).toBeDisabled();

    // --- Settings → AI: switch it on ----------------------------------------------------------------
    await page.goto("/settings/ai");
    await expect(switchBox.getByText("Off", { exact: true })).toBeVisible();
    await switchBox.getByRole("button", { name: "Switch on" }).click();
    await expect(page.getByText("Reel generation is on.")).toBeVisible();
    await expect(switchBox.getByText("On", { exact: true })).toBeVisible();
  }

  // --- generate: the estimate, the confirmation, the progress, the video ------------------------
  await page.goto(review);
  // The pictures of the carousel come from inline jobs: the button opens when they are there.
  await expect(async () => {
    await page.reload();
    await expect(generate).toBeEnabled({ timeout: 3_000 });
  }).toPass({ timeout: 180_000 });
  await generate.click();
  const estimate = page.getByRole("dialog");
  await expect(estimate.getByText(/Estimated cost: \$2\.20/)).toBeVisible();
  await estimate.getByRole("button", { name: /Generate \(about \$2\.20\)/ }).click();
  await expect(page.getByText(/Making the Reel\./)).toBeVisible();
  await expect(reel).toHaveAttribute("data-reel-state", /making|ready/);
  // Director, seven shots, assembly with ffmpeg and Chromium: the page follows it by itself.
  await expect(reel).toHaveAttribute("data-reel-state", "ready", { timeout: 420_000 });
  const video = reel.getByLabel("Reel preview");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", /.+/);
  await expect(reel.getByRole("link", { name: /Download mp4/ })).toBeVisible();
  await expect(reel.getByText(/Scenes \(7\)/)).toBeVisible();
  await expect(reel.locator("[data-hook]")).toHaveCount(3);
  await expect(reel.locator("[data-hook='h1']")).toHaveAttribute("data-chosen", "true");
  await expect(reel.getByText("Shot ready")).toHaveCount(7);
  await expect(reel.getByText(/Cost so far: \$/)).toBeVisible();
  // Nothing is posted by making a Reel; the carousel next to it is untouched.
  await expect(spain.getByText("Ready for review").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("reel-ready.png"), fullPage: true });

  /** The video follows the newest script again (nothing is being rebuilt). */
  const upToDate = async () => {
    await expect(reel).toHaveAttribute("data-reel-state", "ready", { timeout: 300_000 });
    await expect(reel.getByText(/being rebuilt|does not show the latest script/)).toHaveCount(0, {
      timeout: 300_000,
    });
  };

  // --- change the hook: free, the shots are reused ----------------------------------------------
  const costBefore = await costOf(await reel.getByText(/Cost so far: \$/).textContent());
  await reel.locator("[data-hook='h2']").getByRole("button", { name: "Use this hook" }).click();
  await expect(page.getByText(/Rebuilding the video with the new hook/)).toBeVisible();
  await expect(reel.locator("[data-hook='h2']")).toHaveAttribute("data-chosen", "true");
  await upToDate();
  expect(await costOf(await reel.getByText(/Cost so far: \$/).textContent())).toBe(costBefore);

  // --- redo one shot: it is a new shot and costs one ----------------------------------------------
  await reel.locator("[data-scene='s1']").getByRole("button", { name: "Redo shot" }).click();
  const redo = page.getByRole("dialog");
  await expect(redo.getByText(/new shot for scene 1/)).toBeVisible();
  await redo.getByRole("button", { name: /Redo \(about \$/ }).click();
  await expect(page.getByText(/Making a new shot/)).toBeVisible();
  await expect(async () => {
    const now = await costOf(await reel.getByText(/Cost so far: \$/).textContent());
    expect(now).toBeGreaterThan(costBefore);
  }).toPass({ timeout: 300_000 });
  await upToDate();

  // --- approve: this exact video is frozen ------------------------------------------------------
  const block = reel.getByTestId("reel-review");
  await expect(block.getByText("Reel status: Ready for review")).toBeVisible();
  await block.getByRole("button", { name: "Approve", exact: true }).click();
  const approve = page.getByRole("dialog");
  await expect(approve.getByText(/this exact video/)).toBeVisible();
  await approve.getByLabel("Facts checked against the cards").check();
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved as version 1/)).toBeVisible();
  await expect(block.getByText("Reel status: Approved")).toBeVisible();
  await expect(reel.getByText(/This Reel is approved or scheduled/).first()).toBeVisible();
  // The publishing panel of the Reel: it can be scheduled, published or tried (the E2E server
  // posts nothing: INSTAGRAM_PUBLISH_MODE=off).
  await expect(block.getByTestId("publish-panel")).toBeVisible();
  await expect(block.getByRole("button", { name: "Schedule…" })).toBeVisible();
  await expect(block.getByRole("button", { name: "Dry run" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("reel-approved.png"), fullPage: true });

  // --- the queue and the calendar know it is a Reel ---------------------------------------------
  // The second hook option of the Spanish script, as the calendar shows it.
  const hook = "¿Es un error?";
  await page.goto("/content/drafts?tab=APPROVED");
  const row = page.locator("tr[data-market='es-ES']").filter({ hasText: "Reel" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Approved");

  const day = dateIn(3);
  await page.goto("/content/calendar");
  const waiting = page.getByTestId("approved-sidebar");
  await expect(waiting).toContainText(hook);
  await expect(waiting).toContainText("Reel");
  await waiting.getByRole("button", { name: "Schedule…" }).first().click();
  const schedule = page.getByRole("dialog");
  await schedule.getByLabel(/Date and time/).fill(`${day}T11:00`);
  await schedule.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.getByText(/Scheduled for/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(schedule).toBeHidden();
  await page.goto(`/content/calendar?week=${day}`);
  const post = page.locator(`[data-date='${day}']`).getByRole("button", { name: /¿Es un error\?/ });
  await expect(post).toBeVisible();
  await expect(post).toContainText("Reel");
  await page.screenshot({ path: info.outputPath("reel-calendar.png"), fullPage: true });
  await post.click();
  const postDialog = page.getByRole("dialog");
  await postDialog.getByRole("button", { name: "Call off this post" }).click();
  await postDialog.getByLabel("Why?").fill("Test over");
  await postDialog.getByRole("button", { name: "Call off the post" }).click();
  await expect(page.getByText("Post called off.")).toBeVisible();

  // --- withdraw the approval, then reject the Reel: the slot is free again ----------------------------
  await page.goto(review);
  await expect(block.getByText("Reel status: Approved")).toBeVisible();
  await block.getByRole("button", { name: "Withdraw approval" }).first().click();
  const withdraw = page.getByRole("dialog");
  await withdraw.getByLabel("Why?").fill("Wrong hook.");
  await withdraw.getByRole("button", { name: "Withdraw approval" }).click();
  await expect(page.getByText("Approval withdrawn.")).toBeVisible();
  await expect(block.getByText("Reel status: Ready for review")).toBeVisible();

  await block.getByRole("button", { name: "Reject", exact: true }).click();
  const reject = page.getByRole("dialog");
  await reject.getByLabel("Reason").selectOption({ index: 1 });
  await reject.getByRole("button", { name: "Reject draft" }).click();
  await expect(page.getByText("Draft rejected.")).toBeVisible();
  await expect(reel).toHaveAttribute("data-reel-state", "none");
  await expect(generate).toBeEnabled();
});
