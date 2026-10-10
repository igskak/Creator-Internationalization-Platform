// @vitest-environment jsdom

import type { AllowedAction } from "@rc/modules/content";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ConflictBanner } from "./conflict-banner";
import { VariantActions } from "./variant-actions";
import { VariantProvider } from "./variant-state";

// The decision buttons of a draft (M4-06): what the server's allowed actions show, the approval
// checklist, and the reason dialogs. The server actions are mocked.

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  approve: vi.fn(),
  changes: vi.fn(),
  resubmit: vi.fn(),
  reject: vi.fn(),
  unapprove: vi.fn(),
  render: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/actions/content", () => ({
  approveVariant: mocks.approve,
  requestChanges: mocks.changes,
  resubmitVariant: mocks.resubmit,
  rejectVariant: mocks.reject,
  unapproveVariant: mocks.unapprove,
  triggerRender: mocks.render,
  editVariantField: vi.fn(),
  regenerateVariantField: vi.fn(),
}));
vi.mock("@/server/actions/statuses", () => ({ getStatuses: vi.fn() }));

const VARIANT = "22222222-2222-4222-8222-222222222222";
const reasons = [
  { code: "WEAK_HOOK", label: "Weak hook" },
  { code: "OFF_BRAND_VOICE", label: "Off brand voice" },
];
const slim = { ok: true as const, data: { status: "X", lockVersion: 5 } };

const action = (
  name: AllowedAction["action"],
  over: Partial<AllowedAction> = {},
): AllowedAction => ({ action: name, enabled: true, blockers: [], confirm: false, ...over });
const inReview = (approve: Partial<AllowedAction> = {}): AllowedAction[] => [
  action("edit"),
  action("regenerate"),
  action("requestChanges"),
  action("approve", { checklist: ["factsChecked"], ...approve }),
  action("reject"),
];

function show(allowed: AllowedAction[], lockVersion = 4) {
  return render(
    <I18nProvider locale="en" messages={en}>
      <VariantProvider
        variantId={VARIANT}
        lockVersion={lockVersion}
        editBlocker={null}
        confirmKind={null}
        reasons={reasons}
        templates={{}}
        regenerations={[]}
      >
        <ConflictBanner />
        <VariantActions allowed={allowed} flagLabels={en.review.flags} />
      </VariantProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.changes.mockResolvedValue(slim);
  mocks.reject.mockResolvedValue(slim);
  mocks.unapprove.mockResolvedValue(slim);
  mocks.resubmit.mockResolvedValue(slim);
  mocks.render.mockResolvedValue({ ok: true, data: { jobRunId: "j" } });
  mocks.approve.mockResolvedValue({
    ok: true,
    data: { status: "APPROVED", lockVersion: 5, versionId: "v1", versionNo: 2 },
  });
});
afterEach(cleanup);

describe("what the allowed actions show", () => {
  it("offers approve, request changes and reject in review, and nothing else", () => {
    show(inReview());
    for (const name of ["Approve", "Request changes", "Reject"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.queryByRole("button", { name: "Resubmit for review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw approval" })).toBeNull();
    expect(screen.queryByTestId("approve-blockers")).toBeNull();
  });

  it("lists what blocks approval and offers a new render when the images are out of date", async () => {
    const user = userEvent.setup();
    show(
      inReview({
        enabled: false,
        blockers: [
          { code: "RENDER_STALE", message: "x" },
          { code: "BLOCKING_FLAG", flag: "NUMERIC_MISMATCH", message: "x" },
          { code: "OFFER_MISSING", message: "x" },
        ],
      }),
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    const list = screen.getByTestId("approve-blockers");
    expect(list).toHaveTextContent("The images are out of date with the text: render again.");
    expect(list).toHaveTextContent("Fix first: Number does not match the cards.");
    expect(list).toHaveTextContent("This idea sells a product: this market needs an offer.");
    await user.click(screen.getByRole("button", { name: "Render again" }));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith({ variantId: VARIANT }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("does not offer a new render while one is running", () => {
    show(inReview({ enabled: false, blockers: [{ code: "RENDER_RUNNING", message: "x" }] }));
    expect(screen.queryByRole("button", { name: "Render again" })).toBeNull();
  });

  it("offers resubmit after changes were requested, and withdrawing an approval when approved", async () => {
    const user = userEvent.setup();
    const { unmount } = show([action("edit"), action("resubmit"), action("reject")]);
    await user.click(screen.getByRole("button", { name: "Resubmit for review" }));
    await waitFor(() => expect(mocks.resubmit).toHaveBeenCalledWith({ variantId: VARIANT }));
    expect(mocks.toast.success).toHaveBeenCalledWith("Back in review.");
    unmount();
    show([action("edit"), action("unapprove", { confirm: true }), action("schedule")]);
    expect(screen.getByRole("button", { name: "Withdraw approval" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("approving", () => {
  it("needs every box ticked, then sends the lock version and the checklist", async () => {
    const user = userEvent.setup();
    show(inReview({ checklist: ["factsChecked", "safetyChecked", "manychatConfigured"] }), 7);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Approve" });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByLabelText("Facts checked against the cards"));
    await user.click(within(dialog).getByLabelText("Safety statements checked"));
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByLabelText("ManyChat keyword flow set up"));
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledTimes(1));
    expect(mocks.approve).toHaveBeenCalledWith({
      variantId: VARIANT,
      lockVersion: 7,
      checklist: { factsChecked: true, safetyChecked: true, manychatConfigured: true },
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Approved as version 2.");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("asks only for the boxes that apply", async () => {
    const user = userEvent.setup();
    show(inReview());
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    await user.click(within(dialog).getByLabelText("Facts checked against the cards"));
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith(
        expect.objectContaining({ checklist: { factsChecked: true } }),
      ),
    );
  });

  it("shows the server's refusal in the dialog; a conflict also raises the banner", async () => {
    const user = userEvent.setup();
    mocks.approve.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "Changed by Sergey.", requestId: "r" },
    });
    show(inReview());
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByLabelText("Facts checked against the cards"));
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Changed by Sergey.");
    expect(screen.getAllByText(/Someone changed this draft/).length).toBeGreaterThan(0);
  });
});

describe("the reason dialogs", () => {
  it("request changes needs a reason code and a note", async () => {
    const user = userEvent.setup();
    show(inReview());
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Request changes" });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Reason"), "WEAK_HOOK");
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("What should change?"), "Too vague");
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.changes).toHaveBeenCalledWith({
        variantId: VARIANT,
        reasonCode: "WEAK_HOOK",
        reason: "Too vague",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Changes requested.");
  });

  it("reject needs a reason code, the details are optional, and it says it is final", async () => {
    const user = userEvent.setup();
    show(inReview());
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Rejecting is final/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Reject draft" });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Reason"), "OFF_BRAND_VOICE");
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.reject).toHaveBeenCalledWith({
        variantId: VARIANT,
        reasonCode: "OFF_BRAND_VOICE",
      }),
    );
  });

  it("withdrawing an approval needs a reason and explains the effect", async () => {
    const user = userEvent.setup();
    show([action("unapprove", { confirm: true })]);
    await user.click(screen.getByRole("button", { name: "Withdraw approval" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/any scheduled post is cancelled/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "Withdraw approval" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Why?"), "Wrong offer");
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.unapprove).toHaveBeenCalledWith({ variantId: VARIANT, reason: "Wrong offer" }),
    );
  });

  it("cancel closes the dialog without calling the server", async () => {
    const user = userEvent.setup();
    show(inReview());
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.reject).not.toHaveBeenCalled();
  });
});
