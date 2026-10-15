// @vitest-environment jsdom
import type { ExperimentListItem } from "@rc/modules/analytics";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/setup-dom";
import { ExperimentArmPicker } from "@/components/review/experiment-arm-picker";
import { en } from "@/lib/i18n/en";
import { I18nProvider } from "@/lib/i18n/provider";
import { ru } from "@/lib/i18n/ru";
import { ExperimentList } from "./experiment-list";

// /experiments (M7-06): "insufficient data" before both arms reach the minimum, the comparison
// after, the status buttons and the completion outcome; the arm picker of the review screen.

const actions = vi.hoisted(() => ({
  upsertExperimentAction: vi.fn(),
  setExperimentStatusAction: vi.fn(),
  assignExperimentArmAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/experiments", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const ID = "00000000-0000-4000-8000-000000000001";
const MARKET = "00000000-0000-4000-8000-000000000002";
const experiment = (over: Partial<ExperimentListItem> = {}): ExperimentListItem => ({
  id: ID,
  name: "Warm or bright",
  hypothesis: "Bright photos get more saves in Spain.",
  marketId: MARKET,
  marketCode: "es-ES",
  dimension: "visual_style",
  variantA: "WARM",
  variantB: "BRIGHT",
  primaryMetric: "save_rate",
  minPostsPerArm: 3,
  status: "RUNNING",
  startAt: new Date("2026-09-01T00:00:00Z"),
  endAt: null,
  notes: null,
  visualHypothesisId: "bright",
  createdBy: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  result: {
    experimentId: ID,
    metric: "save_rate",
    minPostsPerArm: 3,
    a: { assigned: 3, n: 3, median: 0.025 },
    b: { assigned: 3, n: 2, median: 0.045 },
    sufficient: false,
    difference: null,
    pValue: null,
    method: null,
  },
  ...over,
});
const markets = [
  {
    id: MARKET,
    label: "España",
    hypotheses: [{ id: "bright", description: "Bright daylight photos", status: "TESTING" }],
  },
];
const dimensions = [{ value: "visual_style", label: "Visual style" }];

function show(items: ExperimentListItem[], locale: "en" | "ru" = "en", canManage = true) {
  const messages = locale === "en" ? en : ru;
  return render(
    <I18nProvider locale={locale} messages={messages}>
      <ExperimentList
        experiments={items}
        markets={markets}
        dimensions={dimensions}
        canManage={canManage}
        t={messages.experiments}
        locale={locale}
      />
    </I18nProvider>,
  );
}

describe("ExperimentList", () => {
  it("says insufficient data until both arms reach the minimum", () => {
    show([experiment()]);
    expect(screen.getByTestId("experiment-result")).toHaveTextContent(
      "Insufficient data: each arm needs 3 posts with numbers at day 7.",
    );
    expect(screen.getByText("Arm A: WARM")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 with numbers · median 4.5%")).toBeInTheDocument();
  });

  it("shows the difference and the p-value once both arms are measured", () => {
    show([
      experiment({
        result: {
          experimentId: ID,
          metric: "save_rate",
          minPostsPerArm: 3,
          a: { assigned: 3, n: 3, median: 0.025 },
          b: { assigned: 3, n: 3, median: 0.05 },
          sufficient: true,
          difference: 0.025,
          pValue: 0.1,
          method: "exact",
        },
      }),
    ]);
    expect(screen.getByTestId("experiment-result")).toHaveTextContent(
      "B − A: +2.5% · p = 0.100 (Mann–Whitney U, two-sided) · could be chance",
    );
  });

  it("completes with an outcome when the experiment tests a hypothesis", async () => {
    const user = userEvent.setup();
    actions.setExperimentStatusAction.mockResolvedValue({
      ok: true,
      data: { id: ID, status: "COMPLETED" },
    });
    show([experiment()]);
    await user.click(screen.getByRole("button", { name: "Complete" }));
    const group = screen.getByRole("group", { name: "What did the data say?" });
    await user.click(
      within(group).getByRole("button", { name: "B is better: confirm the hypothesis" }),
    );
    await waitFor(() =>
      expect(actions.setExperimentStatusAction).toHaveBeenCalledWith({
        id: ID,
        status: "COMPLETED",
        outcome: "CONFIRMED",
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("shows no buttons to a chef, and the empty state in Russian", () => {
    show([experiment({ status: "DRAFT" })], "en", false);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    cleanup();
    show([], "ru");
    expect(screen.getByText("Экспериментов пока нет.")).toBeInTheDocument();
  });
});

describe("ExperimentArmPicker", () => {
  const wrap = (node: React.ReactNode) =>
    render(
      <I18nProvider locale="en" messages={en}>
        {node}
      </I18nProvider>,
    );
  const open = [
    {
      id: ID,
      name: "Warm or bright",
      variantA: "WARM",
      variantB: "BRIGHT",
      status: "RUNNING" as const,
    },
  ];

  it("puts the draft into the chosen arm", async () => {
    const user = userEvent.setup();
    actions.assignExperimentArmAction.mockResolvedValue({
      ok: true,
      data: { experimentId: ID, arm: "B" },
    });
    wrap(<ExperimentArmPicker variantId="v1" choice={{ current: null, open }} canManage />);
    expect(screen.getByText("Not in an experiment")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Arm" }), "B");
    await user.click(screen.getByRole("button", { name: "Put in arm" }));
    await waitFor(() =>
      expect(actions.assignExperimentArmAction).toHaveBeenCalledWith({
        variantId: "v1",
        experimentId: ID,
        arm: "B",
      }),
    );
  });

  it("shows the current arm and takes the draft out", async () => {
    const user = userEvent.setup();
    actions.assignExperimentArmAction.mockResolvedValue({
      ok: true,
      data: { experimentId: null, arm: null },
    });
    wrap(
      <ExperimentArmPicker
        variantId="v1"
        choice={{ current: { experimentId: ID, name: "Warm or bright", arm: "A" }, open }}
        canManage
      />,
    );
    expect(screen.getByText("Arm A of “Warm or bright”")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take out" }));
    await waitFor(() =>
      expect(actions.assignExperimentArmAction).toHaveBeenCalledWith({
        variantId: "v1",
        experimentId: null,
      }),
    );
  });

  it("says when the market has no open experiment", () => {
    wrap(<ExperimentArmPicker variantId="v1" choice={{ current: null, open: [] }} canManage />);
    expect(screen.getByText("No open experiment for this market.")).toBeInTheDocument();
  });
});
