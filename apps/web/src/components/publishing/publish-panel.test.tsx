// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import type { PublicationDto, VariantPublicationsDto } from "@/lib/publication-dto";
import { PublishPanel } from "./publish-panel";

const actions = vi.hoisted(() => ({
  schedulePublication: vi.fn(),
  retryPublication: vi.fn(),
  getPublication: vi.fn(),
  reschedulePublication: vi.fn(),
  cancelPublication: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/publishing", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const market = { code: "es-ES", name: "Spain", flagEmoji: "🇪🇸", timeZone: "Europe/Madrid" };
const none: VariantPublicationsDto = { current: null, lastDryRun: null };
const summary = (over: Partial<NonNullable<VariantPublicationsDto["current"]>> = {}) => ({
  id: "pub-1",
  status: "SCHEDULED" as const,
  dryRun: false,
  step: null,
  scheduledAt: "2026-10-20T11:00:00.000Z",
  publishedAt: null,
  permalink: null,
  error: null,
  ...over,
});
const details = (over: Partial<PublicationDto> = {}): PublicationDto => ({
  id: "pub-1",
  variantId: "v-1",
  ideaId: "idea-1",
  title: "Hola",
  status: "FAILED",
  mode: "IMMEDIATE",
  dryRun: false,
  step: "PUBLISH",
  retryNo: 1,
  attemptCount: 5,
  scheduledAt: null,
  publishedAt: null,
  createdAt: "2026-10-10T12:00:00.000Z",
  permalink: null,
  market: { code: "es-ES", name: "Spain", flagEmoji: "🇪🇸", timezone: "Europe/Madrid" },
  account: { username: "kitchen_es" },
  error: {
    kind: "GUARD_PUBLISHING_OFF",
    classification: "PERMANENT",
    message: "Publishing is switched off (the kill switch).",
    code: null,
    subcode: null,
    fbtraceId: null,
  },
  attempts: [
    {
      id: 1,
      at: "2026-10-10T12:00:01.000Z",
      attemptNo: 1,
      step: "GUARDS",
      endpoint: "/1784/content_publishing_limit",
      httpStatus: 200,
      outcome: "OK",
      errorCode: null,
      errorSubcode: null,
      fbtraceId: null,
      durationMs: 120,
    },
    {
      id: 2,
      at: "2026-10-10T12:00:09.000Z",
      attemptNo: 1,
      step: "PUBLISH",
      endpoint: "/1784/media_publish",
      httpStatus: 400,
      outcome: "PERMANENT_ERROR",
      errorCode: "190",
      errorSubcode: "463",
      fbtraceId: "T1",
      durationMs: 80,
    },
  ],
  canRetry: true,
  canCancel: false,
  ...over,
});

const show = (
  props: Partial<Parameters<typeof PublishPanel>[0]> = {},
  locale: "en" | "ru" = "en",
) =>
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : ru}>
      <PublishPanel
        variantId="v-1"
        ideaId="idea-1"
        title="Hola"
        variantStatus="APPROVED"
        market={market}
        canManage
        publications={none}
        {...props}
      />
    </I18nProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  actions.getPublication.mockResolvedValue({ ok: true, data: details() });
});
afterEach(cleanup);

describe("publish panel", () => {
  it("offers Publish now, Schedule and Dry run for an approved draft", () => {
    show();
    expect(screen.getByText("Approved, not scheduled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
    expect(screen.getByText(/publishes nothing/)).toBeInTheDocument();
  });

  it("asks before publishing now, then starts it and opens the details", async () => {
    const user = userEvent.setup();
    actions.schedulePublication.mockResolvedValue({
      ok: true,
      data: { publicationId: "pub-9", status: "QUEUED", scheduledAt: null, warnings: [] },
    });
    actions.getPublication.mockResolvedValue({
      ok: true,
      data: details({ id: "pub-9", status: "QUEUED", error: null, canRetry: false, attempts: [] }),
    });
    show();
    await user.click(screen.getByRole("button", { name: "Publish now" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Publish to Instagram now?")).toBeInTheDocument();
    expect(actions.schedulePublication).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Publish now" }));
    await waitFor(() =>
      expect(actions.schedulePublication).toHaveBeenCalledWith({
        variantId: "v-1",
        mode: "IMMEDIATE",
      }),
    );
    await waitFor(() =>
      expect(actions.getPublication).toHaveBeenCalledWith({ publicationId: "pub-9" }),
    );
    expect(await screen.findByTestId("publication-drawer")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal inside the confirmation", async () => {
    const user = userEvent.setup();
    actions.schedulePublication.mockResolvedValue({
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "Publishing is switched off (the kill switch). Switch it on to publish.",
        requestId: "r1",
      },
    });
    show();
    await user.click(screen.getByRole("button", { name: "Publish now" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish now" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("kill switch");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not publish when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Publish now" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(actions.schedulePublication).not.toHaveBeenCalled();
  });

  it("starts a dry run without a confirmation and opens its details", async () => {
    const user = userEvent.setup();
    actions.schedulePublication.mockResolvedValue({
      ok: true,
      data: { publicationId: "pub-d", status: "QUEUED", scheduledAt: null, warnings: [] },
    });
    show();
    await user.click(screen.getByRole("button", { name: "Dry run" }));
    await waitFor(() =>
      expect(actions.schedulePublication).toHaveBeenCalledWith({
        variantId: "v-1",
        mode: "IMMEDIATE",
        dryRun: true,
      }),
    );
    await waitFor(() =>
      expect(actions.getPublication).toHaveBeenCalledWith({ publicationId: "pub-d" }),
    );
  });

  it("shows the last dry run", () => {
    show({
      publications: {
        current: null,
        lastDryRun: summary({ id: "d", dryRun: true, status: "DRY_RUN_PASSED" }),
      },
    });
    expect(screen.getByText("Last dry run: passed")).toBeInTheDocument();
  });

  it("explains a failed post in words and retries it", async () => {
    const user = userEvent.setup();
    actions.retryPublication.mockResolvedValue({
      ok: true,
      data: { publicationId: "pub-1", status: "QUEUED", scheduledAt: null },
    });
    show({
      variantStatus: "FAILED",
      publications: {
        current: summary({
          status: "FAILED",
          scheduledAt: null,
          error: {
            kind: "GUARD_PUBLISHING_OFF",
            classification: "PERMANENT",
            message: "raw",
            code: null,
            subcode: null,
            fbtraceId: null,
          },
        }),
        lastDryRun: null,
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Publishing is switched off.");
    expect(screen.getByRole("alert")).toHaveTextContent("Ask an owner to switch it on");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(actions.retryPublication).toHaveBeenCalledWith({ publicationId: "pub-1" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the time and the link of a published post", () => {
    show({
      variantStatus: "PUBLISHED",
      publications: {
        current: summary({
          status: "PUBLISHED",
          publishedAt: "2026-10-20T11:00:00.000Z",
          permalink: "https://www.instagram.com/p/abc/",
        }),
        lastDryRun: null,
      },
    });
    expect(screen.getByText(/^Published /)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open on Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/p/abc/",
    );
    expect(screen.queryByRole("button", { name: "Publish now" })).not.toBeInTheDocument();
  });

  it("offers a scheduled post's time and the move/cancel dialog", () => {
    show({ variantStatus: "SCHEDULED", publications: { current: summary(), lastDryRun: null } });
    expect(screen.getByText(/^Scheduled for /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move or call off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dry run" })).toBeInTheDocument();
  });

  it("is read-only for people who may not publish", () => {
    show({ canManage: false, publications: none });
    expect(screen.queryByRole("button", { name: "Publish now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dry run" })).not.toBeInTheDocument();
    expect(screen.getByText("Only owners and editors can publish.")).toBeInTheDocument();
  });

  it("speaks Russian", () => {
    show({}, "ru");
    expect(screen.getByRole("button", { name: "Опубликовать сейчас" })).toBeInTheDocument();
    expect(screen.getByText("Утверждён, не запланирован")).toBeInTheDocument();
  });
});

describe("publication drawer", () => {
  async function open() {
    const user = userEvent.setup();
    show({
      variantStatus: "FAILED",
      publications: { current: summary({ status: "FAILED", scheduledAt: null }), lastDryRun: null },
    });
    await user.click(screen.getByRole("button", { name: "Details" }));
    return { user, drawer: await screen.findByTestId("publication-drawer") };
  }

  it("shows the status, the readable error with the next step, and the calls in order", async () => {
    const { drawer } = await open();
    expect(await within(drawer).findByTestId("publication-error")).toHaveTextContent(
      "Publishing is switched off.",
    );
    expect(within(drawer).getByTestId("publication-error")).toHaveTextContent("What to do");
    expect(within(drawer).getByText("@kitchen_es")).toBeInTheDocument();
    const calls = within(within(drawer).getByTestId("publication-timeline")).getAllByRole(
      "listitem",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveTextContent("/1784/content_publishing_limit");
    expect(calls[0]).toHaveTextContent("OK · 200 · 120 ms");
    expect(calls[1]).toHaveTextContent("Refused · 400");
    expect(calls[1]).toHaveTextContent("Code 190 / subcode 463");
  });

  it("retries a failed post from the drawer", async () => {
    const { user, drawer } = await open();
    actions.retryPublication.mockResolvedValue({
      ok: true,
      data: { publicationId: "pub-1", status: "QUEUED", scheduledAt: null },
    });
    await user.click(await within(drawer).findByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(actions.retryPublication).toHaveBeenCalledWith({ publicationId: "pub-1" }),
    );
  });

  it("links to the review and to the post, and says when it cannot load", async () => {
    actions.getPublication.mockResolvedValue({
      ok: true,
      data: details({
        status: "PUBLISHED",
        error: null,
        canRetry: false,
        permalink: "https://www.instagram.com/p/x/",
      }),
    });
    const { drawer } = await open();
    expect(await within(drawer).findByRole("link", { name: "Open in review" })).toHaveAttribute(
      "href",
      "/content/review/idea-1",
    );
    expect(within(drawer).getByRole("link", { name: "Open on Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/p/x/",
    );
    expect(within(drawer).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    cleanup();
    actions.getPublication.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Not found.", requestId: "r" },
    });
    const again = await open();
    expect(await within(again.drawer).findByRole("alert")).toHaveTextContent(
      "Could not load the details.",
    );
  });
});
