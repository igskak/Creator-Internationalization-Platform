// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { CampaignPanel } from "./campaign-panel";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const campaign = {
  campaignId: "rc-es-261011-k3f9qa",
  keyword: "GUIA",
  url: "https://example.test/guide?utm_source=instagram&utm_campaign=rc-es-261011-k3f9qa",
};
const show = (value: Parameters<typeof CampaignPanel>[0]["campaign"]) =>
  render(
    <I18nProvider locale="en" messages={en}>
      <CampaignPanel campaign={value} />
    </I18nProvider>,
  );

let written: string[] = [];
/** user-event installs its own clipboard when it is set up, so ours goes in after that. */
const mockClipboard = (writeText?: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText:
        writeText ??
        vi.fn(async (text: string) => {
          written.push(text);
        }),
    },
  });
beforeEach(() => {
  written = [];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("campaign panel", () => {
  it("shows the keyword, the link and the flow name and copies each", async () => {
    const user = userEvent.setup();
    mockClipboard();
    show(campaign);
    expect(screen.getByText("GUIA")).toBeInTheDocument();
    expect(screen.getByText("rc-es-261011-k3f9qa")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy Keyword" }));
    await user.click(screen.getByRole("button", { name: "Copy DM link with UTM tags" }));
    await user.click(screen.getByRole("button", { name: "Copy ManyChat flow name" }));
    await waitFor(() => expect(written).toHaveLength(3));
    expect(written).toEqual(["GUIA", campaign.url, "rc-es-261011-k3f9qa"]);
    expect(toast.success).toHaveBeenCalledWith("Copied.");
  });

  it("says what is missing instead of offering to copy it", () => {
    show({ ...campaign, keyword: null, url: null });
    expect(screen.getByText("This CTA has no keyword.")).toBeInTheDocument();
    expect(screen.getByText(/The offer has no landing page/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Keyword" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy ManyChat flow name" })).toBeInTheDocument();
  });

  it("before approval only says when the campaign is made", () => {
    show(null);
    expect(screen.getByText(/made when you approve/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("tells the person when the clipboard is not available", async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    show(campaign);
    await user.click(screen.getByRole("button", { name: "Copy Keyword" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
