// @vitest-environment jsdom

import type { ReelView } from "@rc/modules/reels";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ReelCard } from "./reel-card";

// The Reel card of a market: the estimate dialog, progress, the finished Reel and its changes.
// The actions are mocked. Synthetic content only.

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  estimate: vi.fn(),
  generate: vi.fn(),
  changeHook: vi.fn(),
  redoShot: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/actions/reels", () => ({
  estimateReel: mocks.estimate,
  generateReel: mocks.generate,
  changeReelHook: mocks.changeHook,
  regenerateReelShot: mocks.redoShot,
}));

const t = en.review.reel;
const CAROUSEL = "11111111-1111-4111-8111-111111111111";
const REEL = "22222222-2222-4222-8222-222222222222";

const estimateOf = (model: string, total: number, shotsUsd = total - 0.1) => ({
  model,
  resolution: "720p",
  shots: 7,
  secondsPerShot: 3,
  shotsUsd,
  directorUsd: 0.1,
  totalUsd: total,
});
const ESTIMATES = {
  "alibaba/wan-3.0": estimateOf("alibaba/wan-3.0", 2.2, 2.1),
  "kling-video/v3.0/std": estimateOf("kling-video/v3.0/std", 2.35, 2.25),
  "bytedance/seedance-2.0": estimateOf("bytedance/seedance-2.0", 5.5, 5.4),
} as unknown as ReelView["estimates"];

const scene = (index: number, over: Record<string, unknown> = {}) => ({
  id: `s${index + 1}`,
  index,
  role: index === 0 ? "HOOK" : index === 1 ? "RULE" : "STEP",
  emotion: "AHA",
  beats: 4,
  card: index === 0 ? "Hot water on **bulgur?**" : `Card ${index + 1}`,
  shotPrompt: "Static camera. Steam rises.",
  shotAttempt: 0,
  shot: "READY",
  shotCostUsd: 0.3,
  ...over,
});

const reelOf = (over: Record<string, unknown> = {}): NonNullable<ReelView["reel"]> =>
  ({
    variantId: REEL,
    status: "READY_FOR_REVIEW",
    flags: [],
    lastError: null,
    stage: null,
    script: {
      id: "sc1",
      version: 1,
      model: "alibaba/wan-3.0",
      chosenHookId: "h1",
      flashOpener: "ON",
      hookOptions: [
        {
          id: "h1",
          hookType: "DIRECT_QUESTION",
          card: "Hot water on **bulgur?**",
          ruleCard: "Only if it's **fine.**",
          claimSlideIds: ["c1"],
          rationale: "r",
        },
        {
          id: "h2",
          hookType: "CURIOSITY_GAP",
          card: "Fine bulgur is **already cooked.**",
          ruleCard: "So skip the **boiling.**",
          claimSlideIds: ["c1"],
          rationale: "r",
        },
      ],
      scenes: [scene(0), scene(1), scene(2), scene(3, { shot: "RUNNING" })],
    },
    render: {
      state: "READY",
      renderId: "r1",
      durationMs: 14_880,
      width: 1080,
      height: 1920,
      bytes: 9_169_425,
      warnings: [],
      playUrl: "https://files.test/reel.mp4",
      downloadUrl: "https://files.test/reel.mp4?download=1",
      error: null,
    },
    costUsd: 2.4,
    changeable: true,
    ...over,
  }) as NonNullable<ReelView["reel"]>;

const viewOf = (over: Partial<ReelView> = {}): ReelView => ({
  carouselVariantId: CAROUSEL,
  enabled: true,
  blockedBy: null,
  estimates: ESTIMATES,
  reel: null,
  ...over,
});

function show(view: ReelView, canManage = true) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <ReelCard view={view} canManage={canManage} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({
    ok: true,
    data: { variantId: REEL, runId: "j", estimate: ESTIMATES["alibaba/wan-3.0"] },
  });
  mocks.estimate.mockImplementation(async ({ model }: { model: keyof typeof ESTIMATES }) => ({
    ok: true,
    data: { estimate: ESTIMATES[model], enabled: true, blockedBy: null, reelVariantId: null },
  }));
  mocks.changeHook.mockResolvedValue({
    ok: true,
    data: { variantId: REEL, runId: "j", scriptId: "sc2" },
  });
  mocks.redoShot.mockResolvedValue({
    ok: true,
    data: { variantId: REEL, runId: "j", scriptId: "sc2", estimateUsd: 0.3 },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a market without a Reel", () => {
  it("offers Generate Reel and asks for the estimate before anything is spent", async () => {
    const user = userEvent.setup();
    show(viewOf());
    expect(screen.getByText(t.subtitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: new RegExp(t.generate) }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/7 shots of 3 seconds/)).toBeInTheDocument();
    expect(within(dialog).getByText(`${t.dialog.estimate}: $2.20`)).toBeInTheDocument();
    expect(within(dialog).getByText(/\$2\.10 \+ the script about \$0\.10/)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /Wan 3\.0/ })).toBeChecked();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("re-reads the price when another model is chosen and confirms exactly that price", async () => {
    const user = userEvent.setup();
    show(viewOf());
    await user.click(screen.getByRole("button", { name: new RegExp(t.generate) }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Kling/ }));
    await waitFor(() =>
      expect(mocks.estimate).toHaveBeenCalledWith({
        carouselVariantId: CAROUSEL,
        model: "kling-video/v3.0/std",
      }),
    );
    expect(await within(dialog).findByText(`${t.dialog.estimate}: $2.35`)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Generate (about $2.35)" }));
    expect(mocks.generate).toHaveBeenCalledWith({
      carouselVariantId: CAROUSEL,
      model: "kling-video/v3.0/std",
      confirmEstimateUsd: 2.35,
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(t.dialog.queued));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("cancels without calling anything", async () => {
    const user = userEvent.setup();
    show(viewOf());
    await user.click(screen.getByRole("button", { name: new RegExp(t.generate) }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t.dialog.cancel }),
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it.each([
    ["reels_disabled", t.blocked.reels_disabled],
    ["carousel_not_ready", t.blocked.carousel_not_ready],
    ["no_pictures", t.blocked.no_pictures],
  ] as const)("is off with the reason when %s", (blockedBy, text) => {
    show(viewOf({ blockedBy }));
    expect(screen.getByRole("button", { name: new RegExp(t.generate) })).toBeDisabled();
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it("is off for someone who is not an owner or an editor", () => {
    show(viewOf(), false);
    expect(screen.getByRole("button", { name: new RegExp(t.generate) })).toBeDisabled();
    expect(screen.getAllByText(t.blocked.role).length).toBeGreaterThan(0);
  });
});

describe("a Reel being made", () => {
  it("shows the stages with the shots done so far, and no Generate button", () => {
    show(
      viewOf({
        blockedBy: "reel_generating",
        reel: reelOf({
          status: "GENERATING",
          script: null,
          render: { ...reelOf().render, state: "RENDERING", playUrl: null, downloadUrl: null },
          stage: {
            current: "SHOTS",
            completed: ["DIRECTION"],
            shotsReady: 3,
            shotsTotal: 7,
            startedAt: new Date().toISOString(),
          },
        }),
      }),
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "current", "todo"]);
    expect(screen.getByText("Shots 3 of 7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t.generate) })).not.toBeInTheDocument();
    expect(screen.queryByText(t.progress.slow)).not.toBeInTheDocument();
  });

  it("says it takes longer than usual after fifteen minutes", () => {
    show(
      viewOf({
        reel: reelOf({
          status: "GENERATING",
          script: null,
          stage: {
            current: "SHOTS",
            completed: ["DIRECTION"],
            shotsReady: 1,
            shotsTotal: 7,
            startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          },
        }),
      }),
    );
    expect(screen.getByText(t.progress.slow)).toBeInTheDocument();
  });

  it("waits for the job to start when the Reel exists but nothing has run", () => {
    show(
      viewOf({
        reel: reelOf({
          status: "DRAFT",
          script: null,
          render: { ...reelOf().render, state: "NONE", playUrl: null, downloadUrl: null },
        }),
      }),
    );
    expect(screen.getByText(t.progress.queued)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(t.generate) })).not.toBeInTheDocument();
  });
});

describe("a Reel that failed", () => {
  it("shows the message and lets the owner try again", () => {
    show(
      viewOf({
        reel: reelOf({
          status: "DRAFT",
          script: null,
          lastError: {
            code: "script_invalid",
            message: "The Reel director could not write a valid script.",
          },
        }),
      }),
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(t.failed.title)).toBeInTheDocument();
    expect(
      within(alert).getByText("The Reel director could not write a valid script."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t.generateAgain) })).toBeEnabled();
  });
});

describe("a finished Reel", () => {
  it("shows the video, its size and cost, the download and the checks", () => {
    show(
      viewOf({ reel: reelOf({ render: { ...reelOf().render, warnings: ["STATIC_OPENING"] } }) }),
    );
    const video = screen.getByLabelText(t.video.label);
    expect(video).toHaveAttribute("src", "https://files.test/reel.mp4");
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.getByText("14.9 s · 9.2 MB")).toBeInTheDocument();
    expect(screen.getByText("Cost so far: $2.40")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(t.video.download) })).toHaveAttribute(
      "href",
      "https://files.test/reel.mp4?download=1",
    );
    expect(screen.getByText("Checks found: STATIC_OPENING")).toBeInTheDocument();
  });

  it("says when the video is being rebuilt or lags behind the script", () => {
    const { rerender } = show(
      viewOf({ reel: reelOf({ render: { ...reelOf().render, state: "RENDERING" } }) }),
    );
    expect(screen.getByText(t.video.rebuilding)).toBeInTheDocument();
    rerender(
      <I18nProvider locale="en" messages={en}>
        <ReelCard
          view={viewOf({ reel: reelOf({ render: { ...reelOf().render, state: "STALE" } }) })}
          canManage
        />
      </I18nProvider>,
    );
    expect(screen.getByText(t.video.stale)).toBeInTheDocument();
  });

  it("shows a failed render without a player", () => {
    show(
      viewOf({
        reel: reelOf({
          render: {
            ...reelOf().render,
            state: "FAILED",
            playUrl: null,
            downloadUrl: null,
            error: "ffmpeg exploded",
          },
        }),
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The video could not be put together: ffmpeg exploded",
    );
    expect(screen.queryByLabelText(t.video.label)).not.toBeInTheDocument();
  });

  it("marks the hook in the Reel and changes to another one with one click", async () => {
    const user = userEvent.setup();
    show(viewOf({ reel: reelOf() }));
    const h1 = document.querySelector('[data-hook="h1"]') as HTMLElement;
    const h2 = document.querySelector('[data-hook="h2"]') as HTMLElement;
    expect(h1).toHaveAttribute("data-chosen", "true");
    expect(within(h1).getByText(t.hook.current)).toBeInTheDocument();
    expect(within(h1).queryByRole("button")).not.toBeInTheDocument();
    // The accent markers are not shown.
    expect(within(h2).getByText("Fine bulgur is already cooked.")).toBeInTheDocument();
    await user.click(within(h2).getByRole("button", { name: t.hook.use }));
    expect(mocks.changeHook).toHaveBeenCalledWith({ variantId: REEL, hookId: "h2" });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(t.hook.queued));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("lists the scenes with their shots and redoes one after a confirmation with its price", async () => {
    const user = userEvent.setup();
    show(viewOf({ reel: reelOf() }));
    const first = document.querySelector('[data-scene="s1"]') as HTMLElement;
    expect(within(first).getByText("1. HOOK · AHA · 4 beats")).toBeInTheDocument();
    expect(within(first).getByText("Hot water on bulgur?")).toBeInTheDocument();
    expect(within(first).getByText(t.scenes.shot.READY)).toBeInTheDocument();
    // A shot that is still running has no redo.
    const running = document.querySelector('[data-scene="s4"]') as HTMLElement;
    expect(within(running).getByText(t.scenes.shot.RUNNING)).toBeInTheDocument();
    expect(within(running).queryByRole("button")).not.toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: t.scenes.redo }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/new shot for scene 1/)).toBeInTheDocument();
    expect(mocks.redoShot).not.toHaveBeenCalled();
    // One shot on Wan: $2.10 / 7 = $0.30.
    await user.click(within(dialog).getByRole("button", { name: "Redo (about $0.30)" }));
    expect(mocks.redoShot).toHaveBeenCalledWith({
      variantId: REEL,
      sceneId: "s1",
      confirmEstimateUsd: 0.3,
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(t.scenes.redoQueued));
  });

  it("offers no change to a Reel that is approved, or to someone who may not", () => {
    const { unmount } = show(
      viewOf({ blockedBy: "reel_in_use", reel: reelOf({ changeable: false }) }),
    );
    expect(screen.getByRole("button", { name: t.hook.use })).toBeDisabled();
    expect(screen.queryByRole("button", { name: t.scenes.redo })).not.toBeInTheDocument();
    expect(screen.getAllByText(t.blocked.reel_in_use).length).toBeGreaterThan(0);
    unmount();
    show(viewOf({ reel: reelOf() }), false);
    expect(screen.getByRole("button", { name: t.hook.use })).toBeDisabled();
    expect(screen.queryByRole("button", { name: t.scenes.redo })).not.toBeInTheDocument();
  });
});
