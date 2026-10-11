// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { PublishingIndicator } from "@/components/shell/publishing-indicator";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { PublishingSwitch } from "./publishing-switch";

const setEnabled = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/publishing", () => ({ setPublishingEnabled: setEnabled }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const wrap = (node: React.ReactNode, locale: "en" | "ru" = "en") =>
  render(
    <I18nProvider locale={locale} messages={locale === "en" ? en : ru}>
      {node}
    </I18nProvider>,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("publishing switch", () => {
  it("asks for a reason before switching on, then calls the action and refreshes", async () => {
    const user = userEvent.setup();
    setEnabled.mockResolvedValue({ ok: true, data: { enabled: true } });
    wrap(<PublishingSwitch enabled={false} mode="live" allowlist={["1784"]} isOwner />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Accounts this environment may post to: 1784")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch on" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "First posts approved");
    await user.click(confirm);
    await waitFor(() =>
      expect(setEnabled).toHaveBeenCalledWith({ enabled: true, reason: "First posts approved" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("switches off the other way round", async () => {
    const user = userEvent.setup();
    setEnabled.mockResolvedValue({ ok: true, data: { enabled: false } });
    wrap(<PublishingSwitch enabled mode="live" allowlist={[]} isOwner />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText(/No account is allowed in this environment yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch off" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Switch publishing off?")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Reason"), "Wrong caption");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(setEnabled).toHaveBeenCalledWith({ enabled: false, reason: "Wrong caption" }),
    );
  });

  it("shows a refusal from the server in the dialog and keeps it open", async () => {
    const user = userEvent.setup();
    setEnabled.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Only an owner can do this.", requestId: "r1" },
    });
    wrap(<PublishingSwitch enabled={false} mode="live" allowlist={["1784"]} isOwner />);
    await user.click(screen.getByRole("button", { name: "Switch on" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("Only an owner can do this.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("gives no button to people who are not owners and explains the environment's limits", () => {
    wrap(
      <PublishingSwitch enabled={false} mode="dry_run_only" allowlist={["1784"]} isOwner={false} />,
    );
    expect(screen.queryByRole("button", { name: "Switch on" })).not.toBeInTheDocument();
    expect(screen.getByText("Only owners can use the switch.")).toBeInTheDocument();
    expect(screen.getByText(/only allows dry runs/)).toBeInTheDocument();
    cleanup();
    wrap(<PublishingSwitch enabled mode="off" allowlist={[]} isOwner />, "ru");
    expect(screen.getByText(/вообще не публикует/)).toBeInTheDocument();
  });
});

describe("publishing indicator", () => {
  it.each([
    ["off", "Publishing: Off here"],
    ["paused", "Publishing: Paused"],
    ["dryRun", "Publishing: Dry runs only"],
    ["live", "Publishing: Live"],
  ] as const)("shows %s in the header and links to the switch", (state, text) => {
    wrap(<PublishingIndicator state={state} />);
    const link = screen.getByTestId("publishing-indicator");
    expect(link).toHaveAttribute("href", "/settings/instagram");
    expect(link).toHaveAttribute("data-state", state);
    expect(link.textContent?.replace(/\s+/g, " ")).toBe(text);
  });
});
