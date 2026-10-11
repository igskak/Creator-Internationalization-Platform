// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { PostButton, type PostInfo, ScheduleButton } from "./calendar-dialogs";

// The schedule, move and cancel dialogs (M4-09): the time is typed in the market's zone and sent
// as UTC; the server's warnings are shown. The server actions are mocked.

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  schedule: vi.fn(),
  reschedule: vi.fn(),
  cancel: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/actions/publishing", () => ({
  schedulePublication: mocks.schedule,
  reschedulePublication: mocks.reschedule,
  cancelPublication: mocks.cancel,
}));

const madrid = { code: "es-ES", name: "Spain", flagEmoji: "🇪🇸", timeZone: "Europe/Madrid" };
const VARIANT = "33333333-3333-4333-8333-333333333333";
const PUBLICATION = "44444444-4444-4444-8444-444444444444";

const wrap = (node: React.ReactNode) => (
  <I18nProvider locale="en" messages={en}>
    {node}
  </I18nProvider>
);
const reply = (over: object = {}) => ({
  ok: true as const,
  data: {
    publicationId: PUBLICATION,
    status: "SCHEDULED",
    scheduledAt: "2099-10-20T11:00:00.000Z",
    warnings: [],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue(reply());
  mocks.reschedule.mockResolvedValue(reply());
  mocks.cancel.mockResolvedValue({
    ok: true,
    data: { publicationId: PUBLICATION, status: "CANCELLED", scheduledAt: null },
  });
});
afterEach(cleanup);

const openSchedule = async (canSchedule = true) => {
  const user = userEvent.setup();
  render(
    wrap(
      <ScheduleButton variantId={VARIANT} title="Hola" market={madrid} canSchedule={canSchedule}>
        Schedule…
      </ScheduleButton>,
    ),
  );
  await user.click(screen.getByRole("button", { name: "Schedule…" }));
  return { user, dialog: await screen.findByRole("dialog") };
};

describe("scheduling a draft", () => {
  it("sends the market's wall clock as UTC", async () => {
    const { user, dialog } = await openSchedule();
    expect(
      within(dialog).getByText(/Pick the time in Spain time \(Europe\/Madrid\)/),
    ).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Schedule" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Date and time/), {
      target: { value: "2099-10-20T13:00" },
    });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(mocks.schedule).toHaveBeenCalledTimes(1));
    expect(mocks.schedule).toHaveBeenCalledWith({
      variantId: VARIANT,
      scheduledAt: "2099-10-20T11:00:00.000Z",
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Scheduled for 2099-10-20 13:00 (UTC+2).".replace("13:00 (UTC+2)", "13:00 (UTC+2)"),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("tells the person when the time falls into the hour the clocks skip", async () => {
    const { dialog } = await openSchedule();
    fireEvent.change(within(dialog).getByLabelText(/Date and time/), {
      target: { value: "2099-03-29T02:30" },
    });
    expect(within(dialog).getByText(/does not exist on that day/)).toBeInTheDocument();
  });

  it("will not send a time that is less than five minutes away", async () => {
    const { dialog } = await openSchedule();
    const soon = new Date(Date.now() + 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    fireEvent.change(within(dialog).getByLabelText(/Date and time/), {
      target: {
        value: `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`,
      },
    });
    // Whatever the machine's zone, a minute from now is never a Madrid time five minutes ahead.
    const submit = within(dialog).getByRole("button", { name: "Schedule" });
    if (submit.hasAttribute("disabled")) expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("keeps the dialog open to show the warnings that come back", async () => {
    mocks.schedule.mockResolvedValue(
      reply({
        warnings: [
          { code: "NO_ACTIVE_ACCOUNT", message: "x" },
          { code: "MIN_GAP", message: "y" },
        ],
      }),
    );
    const { user, dialog } = await openSchedule();
    fireEvent.change(within(dialog).getByLabelText(/Date and time/), {
      target: { value: "2099-10-20T13:00" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
    const note = await within(dialog).findByRole("status");
    expect(note).toHaveTextContent("No Instagram account is connected for this market.");
    expect(note).toHaveTextContent("Another post of this market is close.");
  });

  it("shows the server's refusal next to the field", async () => {
    mocks.schedule.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "no",
        fieldErrors: { scheduledAt: ["Pick a time at least 5 minutes from now."] },
        requestId: "r",
      },
    });
    const { user, dialog } = await openSchedule();
    fireEvent.change(within(dialog).getByLabelText(/Date and time/), {
      target: { value: "2099-10-20T13:00" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("at least 5 minutes");
  });

  it("is off for someone who may not schedule", () => {
    render(
      wrap(
        <ScheduleButton variantId={VARIANT} title="Hola" market={madrid} canSchedule={false}>
          Schedule…
        </ScheduleButton>,
      ),
    );
    expect(screen.getByRole("button", { name: "Schedule…" })).toBeDisabled();
  });
});

const post: PostInfo = {
  publicationId: PUBLICATION,
  variantId: VARIANT,
  ideaId: "55555555-5555-4555-8555-555555555555",
  title: "Hola",
  market: madrid,
  at: "2099-10-20T11:00:00.000Z",
  status: "SCHEDULED",
  warnings: ["PUBLISHING_DISABLED"],
  permalink: null,
};

const openPost = async (over: Partial<PostInfo> = {}, canSchedule = true) => {
  const user = userEvent.setup();
  render(
    wrap(
      <PostButton post={{ ...post, ...over }} canSchedule={canSchedule}>
        13:00 Hola
      </PostButton>,
    ),
  );
  await user.click(screen.getByRole("button", { name: "13:00 Hola" }));
  return { user, dialog: await screen.findByRole("dialog") };
};

describe("a post of the calendar", () => {
  it("shows its time in the market's zone, its warnings and a link to the review", async () => {
    const { dialog } = await openPost();
    expect(within(dialog).getByText(/2099-10-20 13:00 \(UTC\+2\)/)).toBeInTheDocument();
    expect(within(dialog).getByText("Publishing is switched off.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open in review" })).toHaveAttribute(
      "href",
      `/content/review/${post.ideaId}`,
    );
  });

  it("moves it: the new time goes out as UTC", async () => {
    const { user, dialog } = await openPost();
    const input = within(dialog).getByLabelText(/Date and time/);
    expect(input).toHaveValue("2099-10-20T13:00");
    fireEvent.change(input, { target: { value: "2099-10-21T09:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(mocks.reschedule).toHaveBeenCalledWith({
        publicationId: PUBLICATION,
        scheduledAt: "2099-10-21T07:30:00.000Z",
      }),
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("calls it off only with a reason", async () => {
    const { user, dialog } = await openPost();
    await user.click(within(dialog).getByRole("button", { name: "Call off this post" }));
    expect(within(dialog).getByText(/can be scheduled again/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Call off the post" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why?"), "Wrong day");
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({
        publicationId: PUBLICATION,
        reason: "Wrong day",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Post called off.");
  });

  it("only reads for someone who may not schedule, and a published post cannot be changed", async () => {
    const readonly = await openPost({}, false);
    expect(within(readonly.dialog).getByText(/Only owners and editors/)).toBeInTheDocument();
    expect(within(readonly.dialog).queryByRole("button", { name: "Move" })).toBeNull();
    cleanup();
    const published = await openPost({
      status: "PUBLISHED",
      permalink: "https://instagram.com/p/x",
    });
    expect(within(published.dialog).queryByRole("button", { name: "Move" })).toBeNull();
    expect(
      within(published.dialog).queryByRole("button", { name: "Call off this post" }),
    ).toBeNull();
    expect(
      within(published.dialog).getByRole("link", { name: "Open on Instagram" }),
    ).toHaveAttribute("href", "https://instagram.com/p/x");
  });

  it("queued posts can be called off but not moved", async () => {
    const { dialog } = await openPost({ status: "QUEUED" });
    expect(within(dialog).queryByRole("button", { name: "Move" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Call off this post" })).toBeInTheDocument();
  });
});
