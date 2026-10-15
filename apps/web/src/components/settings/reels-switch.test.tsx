// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { ReelsSwitch } from "./reels-switch";

const setSetting = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/settings", () => ({ setAppSetting: setSetting }));
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

describe("Reels switch", () => {
  it("switches generation on with one click and refreshes the page", async () => {
    const user = userEvent.setup();
    setSetting.mockResolvedValue({ ok: true, data: { key: "reels.enabled", value: true } });
    wrap(<ReelsSwitch enabled={false} isOwner />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch on" }));
    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith({ key: "reels.enabled", value: true }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("switches it off the other way round", async () => {
    const user = userEvent.setup();
    setSetting.mockResolvedValue({ ok: true, data: { key: "reels.enabled", value: false } });
    wrap(<ReelsSwitch enabled isOwner />);
    expect(screen.getByText("On")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch off" }));
    await waitFor(() =>
      expect(setSetting).toHaveBeenCalledWith({ key: "reels.enabled", value: false }),
    );
  });

  it("gives no button to anyone but an owner", () => {
    wrap(<ReelsSwitch enabled={false} isOwner={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(en.reelsSwitch.ownersOnly)).toBeInTheDocument();
  });

  it("speaks Russian", () => {
    wrap(<ReelsSwitch enabled isOwner />, "ru");
    expect(screen.getByRole("button", { name: "Выключить" })).toBeInTheDocument();
    expect(screen.getByText("Генерация Reels")).toBeInTheDocument();
  });
});
