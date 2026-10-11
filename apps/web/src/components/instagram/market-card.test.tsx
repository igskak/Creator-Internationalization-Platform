// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { type InstagramCardData, InstagramMarketCard } from "./market-card";

const disconnect = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/instagram", () => ({ disconnectInstagramAccount: disconnect }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const base: InstagramCardData = {
  marketId: "m-es",
  marketName: "Spain",
  marketCode: "es-ES",
  flagEmoji: "🇪🇸",
  health: "OK",
  account: {
    id: "acc-1",
    username: "kitchen_es",
    accountType: "BUSINESS",
    connectedAt: "2026-10-01T10:00:00.000Z",
  },
  daysLeft: 41,
  lastPublish: {
    publishedAt: "2026-10-09T09:00:00.000Z",
    permalink: "https://www.instagram.com/p/abc/",
  },
  lastError: null,
  quota: { used: 3, total: 100 },
};

const show = (
  data: InstagramCardData,
  opts: { canManage?: boolean; canConnect?: boolean; ru?: boolean } = {},
) =>
  render(
    <I18nProvider locale={opts.ru ? "ru" : "en"} messages={opts.ru ? ru : en}>
      <InstagramMarketCard
        data={data}
        canManage={opts.canManage ?? true}
        canConnect={opts.canConnect ?? true}
      />
    </I18nProvider>,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Instagram market card", () => {
  it("shows a healthy account with token, quota and last post", () => {
    show(base);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("@kitchen_es")).toBeInTheDocument();
    expect(screen.getByText("valid for 41 more days")).toBeInTheDocument();
    expect(screen.getByText("3 of 100 posts in the last 24 hours")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open on Instagram" })).toHaveAttribute(
      "href",
      "https://www.instagram.com/p/abc/",
    );
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("offers Connect for a market without an account", () => {
    show({
      ...base,
      health: "NOT_CONNECTED",
      account: null,
      daysLeft: null,
      lastPublish: null,
      quota: null,
    });
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute(
      "href",
      "/api/instagram/oauth/start?marketId=m-es",
    );
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("asks to reconnect when Instagram no longer accepts the token, and shows the problem", () => {
    show({
      ...base,
      health: "NEEDS_REAUTH",
      daysLeft: -2,
      lastError: { code: "190", message: "Token expired", occurredAt: "2026-10-10T08:00:00.000Z" },
    });
    expect(screen.getByText("Needs to be reconnected")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText("Token expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("warns when the token expires soon and still allows reconnecting", () => {
    show({ ...base, health: "EXPIRING", daysLeft: 3 });
    expect(screen.getByText("Token expires soon")).toBeInTheDocument();
    expect(screen.getByText("valid for 3 more days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument();
  });

  it("says the quota is not checked yet and that no post exists yet", () => {
    show({ ...base, quota: null, lastPublish: null });
    expect(screen.getByText("not checked yet")).toBeInTheDocument();
    expect(screen.getByText("No post yet")).toBeInTheDocument();
  });

  it("hides the buttons from people who may not manage accounts, and when Instagram is not set up", () => {
    const { unmount } = show(base, { canManage: false });
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    unmount();
    show({ ...base, health: "NOT_CONNECTED", account: null }, { canConnect: false });
    expect(screen.queryByRole("link", { name: "Connect" })).not.toBeInTheDocument();
  });

  it("disconnects after a confirmation and refreshes the page", async () => {
    const user = userEvent.setup();
    disconnect.mockResolvedValue({ ok: true, data: { socialAccountId: "acc-1" } });
    show(base);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Disconnect @kitchen_es?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ socialAccountId: "acc-1" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not disconnect when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    show(base);
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("speaks Russian with the right plural", () => {
    show({ ...base, daysLeft: 3 }, { ru: true });
    expect(screen.getByText("Подключён")).toBeInTheDocument();
    expect(screen.getByText("действует ещё 3 дня")).toBeInTheDocument();
  });
});
