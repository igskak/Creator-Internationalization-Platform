// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ConflictBanner } from "./conflict-banner";
import { EditableText } from "./editable-text";
import { IssueJump } from "./issue-jump";
import { RegenerationDiff } from "./regeneration-diff";
import {
  type ConfirmKind,
  type PendingRegenerationView,
  type TemplateInfo,
  VariantProvider,
} from "./variant-state";

// The key interactions of the review screen (M4-05): edit with a limit, conflict, confirmation
// before an approval is undone, regenerate, and Keep / Undo. The server actions are mocked.

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  edit: vi.fn(),
  regenerate: vi.fn(),
  statuses: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/actions/content", () => ({
  editVariantField: mocks.edit,
  regenerateVariantField: mocks.regenerate,
}));
vi.mock("@/server/actions/statuses", () => ({ getStatuses: mocks.statuses }));

const VARIANT = "11111111-1111-4111-8111-111111111111";
const reasons = [
  { code: "WEAK_HOOK", label: "Weak hook" },
  { code: "TOO_LONG", label: "Too long" },
];
const templates: TemplateInfo = {};
const ok = (data: object) => ({
  ok: true as const,
  data: { status: "READY_FOR_REVIEW", lockVersion: 1, reviewEventId: "e1", warnings: [], ...data },
});

function Harness({
  children,
  lockVersion = 0,
  editBlocker = null,
  confirmKind = null,
  regenerations = [],
}: {
  children: ReactNode;
  lockVersion?: number;
  editBlocker?: string | null;
  confirmKind?: ConfirmKind | null;
  regenerations?: PendingRegenerationView[];
}) {
  return (
    <I18nProvider locale="en" messages={en}>
      <VariantProvider
        variantId={VARIANT}
        lockVersion={lockVersion}
        editBlocker={editBlocker}
        confirmKind={confirmKind}
        reasons={reasons}
        templates={templates}
        regenerations={regenerations}
      >
        <ConflictBanner />
        {children}
      </VariantProvider>
    </I18nProvider>
  );
}

const hook = (props: Partial<Parameters<typeof EditableText>[0]> = {}) => (
  <EditableText path="hook" label="Hook" fieldLabel="hook" value="Hola" {...props} />
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.edit.mockResolvedValue(ok({}));
});
afterEach(cleanup);

describe("editing a field", () => {
  it("saves the new text with the lock version and refreshes the page", async () => {
    const user = userEvent.setup();
    render(<Harness lockVersion={3}>{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    const box = screen.getByRole("textbox", { name: "Hook" });
    await user.clear(box);
    await user.type(box, "Nuevo gancho");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit).toHaveBeenCalledWith({
      variantId: VARIANT,
      lockVersion: 3,
      field: "hook",
      value: "Nuevo gancho",
    });
    expect(mocks.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("keeps Save off until the text changed and cancel restores it", async () => {
    const user = userEvent.setup();
    render(<Harness>{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Hook" }), "!");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Hola")).toBeInTheDocument();
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("shows the counter and refuses text over the slot limit", async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {hook({ path: "slides.s1.slots.headline", maxChars: 10, maxLines: 2, value: "Hi" })}
      </Harness>,
    );
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    const box = screen.getByRole("textbox", { name: "Hook" });
    await user.clear(box);
    await user.type(box, "12345678901");
    expect(screen.getByText(/11 \/ 10 · 1 over the limit · up to 2 lines/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(box, "{Backspace}");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows the server's refusal next to the field and keeps the editor open", async () => {
    mocks.edit.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "no",
        fieldErrors: { value: ["A slide contains a link."] },
        requestId: "r1",
      },
    });
    const user = userEvent.setup();
    render(<Harness>{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    await user.type(screen.getByRole("textbox", { name: "Hook" }), " www.x.com");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A slide contains a link.");
    expect(screen.getByRole("textbox", { name: "Hook" })).toHaveValue("Hola www.x.com");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("on a conflict keeps the typed text, shows the banner and reloads on request", async () => {
    mocks.edit.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "This draft was changed by Sergey.", requestId: "r2" },
    });
    const user = userEvent.setup();
    render(<Harness>{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    await user.type(screen.getByRole("textbox", { name: "Hook" }), " mío");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const banner = await screen.findByText(/Someone changed this draft/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Hook" })).toHaveValue("Hola mío");
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "This draft was changed by Sergey.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Reload" }) }),
    );
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByText(/Someone changed this draft/)).toBeNull();
  });

  it("disables editing with the reason when the draft cannot be edited", () => {
    render(<Harness editBlocker="The carousel is rendering.">{hook()}</Harness>);
    const button = screen.getByRole("button", { name: "Edit: hook" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "The carousel is rendering.");
  });
});

describe("an approved draft", () => {
  it("asks before undoing the approval and sends the confirmation", async () => {
    const user = userEvent.setup();
    render(<Harness confirmKind="scheduled">{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    await user.type(screen.getByRole("textbox", { name: "Hook" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cancels the scheduled post/)).toBeInTheDocument();
    expect(mocks.edit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save and send back to review" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true }));
  });

  it("does nothing when the person declines", async () => {
    const user = userEvent.setup();
    render(<Harness confirmKind="approved">{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Edit: hook" }));
    await user.type(screen.getByRole("textbox", { name: "Hook" }), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.edit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Hook" })).toHaveValue("Hola!");
  });
});

describe("regenerating a field", () => {
  it("sends the instruction and the reason, then waits for the draft to change", async () => {
    mocks.regenerate.mockResolvedValue({ ok: true, data: { jobRunId: "j1", requestId: "q1" } });
    mocks.statuses.mockResolvedValue({
      ok: true,
      data: { [VARIANT]: { status: "READY_FOR_REVIEW", lockVersion: 1 } },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness lockVersion={0}>{hook()}</Harness>);
    await user.click(screen.getByRole("button", { name: "Regenerate the hook" }));
    await user.type(screen.getByLabelText("What should change?"), "Start with the verb");
    await user.selectOptions(screen.getByLabelText("Why"), "WEAK_HOOK");
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(mocks.regenerate).toHaveBeenCalledTimes(1));
    expect(mocks.regenerate).toHaveBeenCalledWith({
      variantId: VARIANT,
      lockVersion: 0,
      field: "hook",
      instruction: "Start with the verb",
      reasonCode: "WEAK_HOOK",
    });
    expect(mocks.toast).toHaveBeenCalledWith("Redoing the hook…");
    await vi.advanceTimersByTimeAsync(3000);
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("The hook was redone. Keep it or undo it."),
    );
    expect(mocks.refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("old versus new after a regeneration", () => {
  const pending: PendingRegenerationView = {
    reviewEventId: "evt-1",
    field: "hook",
    original: "Hola",
    edited: "Deja de lavar el arroz.",
  };

  it("shows both values; Undo is an edit back to the old one", async () => {
    const user = userEvent.setup();
    render(
      <Harness regenerations={[pending]}>
        <RegenerationDiff path="hook" />
      </Harness>,
    );
    const box = screen.getByTestId("regeneration-diff");
    expect(box).toHaveTextContent("Was: Hola");
    expect(box).toHaveTextContent("Now: Deja de lavar el arroz.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledTimes(1));
    expect(mocks.edit).toHaveBeenCalledWith(
      expect.objectContaining({ field: "hook", value: "Hola", lockVersion: 0 }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("The previous value is back.");
  });

  it("Keep hides the box and remembers it on this device", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Harness regenerations={[pending]}>
        <RegenerationDiff path="hook" />
      </Harness>,
    );
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByTestId("regeneration-diff")).toBeNull();
    expect(mocks.edit).not.toHaveBeenCalled();
    unmount();
    render(
      <Harness regenerations={[pending]}>
        <RegenerationDiff path="hook" />
      </Harness>,
    );
    await waitFor(() => expect(screen.queryByTestId("regeneration-diff")).toBeNull());
  });

  it("offers only Keep for a picture", () => {
    render(
      <Harness
        regenerations={[
          {
            reviewEventId: "evt-2",
            field: "slides.s2.images.side",
            original: { prompt: "a" },
            edited: { prompt: "b" },
          },
        ]}
      >
        <RegenerationDiff path="slides.s2.images.side" />
      </Harness>,
    );
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByText(/new picture is being made/)).toBeInTheDocument();
  });
});

describe("jumping from a critic issue", () => {
  it("scrolls to the field and highlights it", async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        {hook()}
        <IssueJump path="hook" />
        <IssueJump path="not a field" />
      </Harness>,
    );
    expect(screen.getAllByRole("button", { name: /Go to the field/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Go to the field: hook" }));
    await waitFor(() =>
      expect(document.getElementById(`field-${VARIANT}-hook`)).toHaveClass("ring-2"),
    );
  });
});
