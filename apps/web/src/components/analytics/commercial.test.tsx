// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { CommercialTab } from "./commercial";
import {
  attributionEventsFixture,
  attributionImportsFixture,
  commercialFixture,
  unknownCampaignsFixture,
} from "./fixtures";

// The Commercial tab (M6-08) on the fixture whose numbers the module test computes: tiles per
// currency, the campaign table, the reconciliation list with its form, events and imports.

const actions = vi.hoisted(() => ({
  recordAttributionEventAction: vi.fn(),
  importAttributionCsvAction: vi.fn(),
  reassignCampaignAction: vi.fn(),
  deleteAttributionEventAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/analytics", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const markets = [
  { id: "00000000-0000-4000-8000-0000000000e1", code: "es-ES", label: "España" },
  { id: "00000000-0000-4000-8000-0000000000e2", code: "en", label: "English" },
];

function show(
  opts: { locale?: "en" | "ru"; canEdit?: boolean; isOwner?: boolean; empty?: boolean } = {},
) {
  const locale = opts.locale ?? "en";
  const messages = locale === "en" ? en : ru;
  const commercial = commercialFixture();
  if (opts.empty) {
    commercial.campaigns = [];
    commercial.offers = [];
    commercial.totals = {
      leads: 0,
      sales: 0,
      refunds: 0,
      revenue: [],
      reachD7: null,
      revenuePer1kReach: null,
    };
  }
  return render(
    <I18nProvider locale={locale} messages={messages}>
      <CommercialTab
        commercial={commercial}
        unknown={opts.empty ? [] : unknownCampaignsFixture()}
        events={attributionEventsFixture()}
        imports={attributionImportsFixture()}
        markets={markets}
        knownCampaigns={["rc-en-261001-ccc333"]}
        canEdit={opts.canEdit ?? true}
        isOwner={opts.isOwner ?? true}
        t={messages.analytics}
        locale={locale}
      />
    </I18nProvider>,
  );
}
const tile = (name: string) => screen.getByRole("group", { name });

describe("Commercial tab", () => {
  it("shows the totals, revenue per currency and per 1,000 reach", () => {
    show();
    expect(within(tile("Leads")).getByText("7")).toBeInTheDocument();
    expect(within(tile("Sales")).getByText("4")).toBeInTheDocument();
    expect(within(tile("Sales")).getByText("1 refunded.")).toBeInTheDocument();
    expect(within(tile("Revenue")).getByText("€60.00 · $25.00")).toBeInTheDocument();
    expect(
      within(tile("Revenue per 1,000 reach")).getByText("€20.00 · $10.00"),
    ).toBeInTheDocument();
  });

  it("lists campaigns with their post, reach and rate; a campaign without reach has a dash", () => {
    show();
    const table = screen.getByTestId("campaigns-table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(
      within(rows[1] as HTMLElement).getByRole("link", { name: "El error que arruina tu risotto" }),
    ).toHaveAttribute("href", "/content/published/00000000-0000-4000-8000-0000000000a1");
    expect(within(rows[1] as HTMLElement).getByText("€25.00")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(within(rows[4] as HTMLElement).getByText("Without a campaign id")).toBeInTheDocument();
  });

  it("moves the events of an unknown campaign id and refreshes", async () => {
    const user = userEvent.setup();
    actions.reassignCampaignAction.mockResolvedValue({ ok: true, data: { moved: 2 } });
    show();
    const list = screen.getByTestId("reconcile");
    expect(within(list).getByText("rc-en-261001-typo00")).toBeInTheDocument();
    await user.type(within(list).getByLabelText("Right campaign id"), "rc-en-261001-ccc333");
    await user.click(within(list).getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(actions.reassignCampaignAction).toHaveBeenCalledWith({
        from: "rc-en-261001-typo00",
        to: "rc-en-261001-ccc333",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the imports with their result, and a running one", () => {
    show();
    expect(screen.getByText("7 added, 1 already there, 1 refused")).toBeInTheDocument();
    expect(screen.getByText("running…")).toBeInTheDocument();
    expect(screen.getByText("10: Unknown market.")).toBeInTheDocument();
  });

  it("hides the forms from a chef and the delete button from an editor", () => {
    show({ canEdit: false, isOwner: false });
    expect(screen.queryByRole("button", { name: /Add an event/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("says what to do when nothing was recorded, in Russian too", () => {
    show({ empty: true, locale: "ru" });
    expect(screen.getAllByText(/нет ни лидов, ни продаж/).length).toBeGreaterThan(0);
    expect(screen.getByText("У всех id кампаний в событиях есть пост.")).toBeInTheDocument();
  });
});
