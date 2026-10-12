// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { RegeneratePicturesButton } from "./regenerate-pictures-button";
import { VariantProvider } from "./variant-state";

// "Regenerate pictures" under the carousel: one market's pictures only. The action is mocked.

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  regenerate: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/server/actions/content", () => ({ regenerateVisuals: mocks.regenerate }));
vi.mock("@/server/actions/statuses", () => ({ getStatuses: vi.fn() }));

const VARIANT = "22222222-2222-4222-8222-222222222222";
const t = en.review.viewer;

function show(props: { enabled?: boolean; renderId?: string | null; renderBusy?: boolean } = {}) {
  const tree = (p: typeof props) => (
    <I18nProvider locale="en" messages={en}>
      <VariantProvider
        variantId={VARIANT}
        lockVersion={3}
        editBlocker={null}
        confirmKind={null}
        reasons={[]}
        templates={{}}
        regenerations={[]}
      >
        <RegeneratePicturesButton
          enabled={p.enabled ?? true}
          renderId={p.renderId === undefined ? "r1" : p.renderId}
          renderBusy={p.renderBusy ?? false}
        />
      </VariantProvider>
    </I18nProvider>
  );
  const view = render(tree(props));
  return { rerender: (next: typeof props) => view.rerender(tree(next)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.regenerate.mockResolvedValue({ ok: true, data: { jobRunId: "j", requestId: "q" } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RegeneratePicturesButton", () => {
  it("is disabled for a draft that is not in review", () => {
    show({ enabled: false });
    expect(screen.getByRole("button", { name: t.regenerate })).toBeDisabled();
  });

  it("asks first, queues this market's pictures and waits for the new render", async () => {
    const user = userEvent.setup();
    const view = show();
    await user.click(screen.getByRole("button", { name: t.regenerate }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t.regenerateDescription)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t.regenerateSubmit }));
    expect(mocks.regenerate).toHaveBeenCalledWith({ variantId: VARIANT });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(t.regenerateQueued));
    expect(screen.getByText(t.regenerating)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.regenerate })).toBeDisabled();

    // The page is refreshed until a new render arrives.
    vi.useFakeTimers();
    view.rerender({});
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(mocks.refresh).toHaveBeenCalled();
    view.rerender({ renderId: "r2" });
    expect(screen.queryByText(t.regenerating)).toBeNull();
    expect(screen.getByRole("button", { name: t.regenerate })).toBeEnabled();
  });
});
