import { schema } from "@rc/db";
import { and, eq, gte, lt, sql } from "@rc/db/orm";
import { audit, type ServiceContext } from "../core";
import { STAGE_CONFIG } from "./config";

// AI cost and the monthly budget (plan 12 §12.9, plan 05 §5.11 getAiSettings, H-05). Every model
// and video call is a `generation_runs` row with its list-price cost; the month is the UTC
// calendar month. The budget is the setting `ai.monthly_budget_usd` (0 or missing = no budget).
// Health: green under 80 % of the budget, amber from 80 % to 100 %, red above. J24 checks it daily
// and raises an alert once per month and level: an audit event, and the job reports it to Sentry,
// whose alert rule sends the e-mail (docs/runbooks/sentry.md).

export const BUDGET_SETTING = "ai.monthly_budget_usd";
/** Internal: the highest level already alerted this month, so an alert is sent once. */
const ALERT_STATE_KEY = "ai.budget_alert_state";
export const AMBER_SHARE = 0.8;

export type BudgetState = "NONE" | "GREEN" | "AMBER" | "RED";
const LEVEL: Record<BudgetState, number> = { NONE: 0, GREEN: 0, AMBER: 1, RED: 2 };

export type AiCostOverview = {
  /** `YYYY-MM`, UTC. */
  month: string;
  monthToDateUsd: number;
  budgetUsd: number | null;
  /** Month to date over the budget; null without a budget. */
  share: number | null;
  state: BudgetState;
  byStage: { stage: string; runs: number; failed: number; costUsd: number }[];
  /** The active configuration of every stage (read-only in the MVP). */
  stages: {
    stage: string;
    promptId: string;
    version: number;
    model: string;
    effort: string;
    maxTokens: number;
  }[];
  last24h: { runs: number; failed: number; refused: number; invalid: number };
};

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const monthKey = (now: Date) => now.toISOString().slice(0, 7);
const round = (n: number) => Math.round(n * 100) / 100;

export function budgetState(spentUsd: number, budgetUsd: number | null): BudgetState {
  if (!budgetUsd || budgetUsd <= 0) return "NONE";
  const share = spentUsd / budgetUsd;
  return share > 1 ? "RED" : share >= AMBER_SHARE ? "AMBER" : "GREEN";
}

async function readSetting(ctx: ServiceContext, key: string): Promise<unknown> {
  const [row] = await ctx.db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key));
  return row?.value;
}

export async function getMonthlyBudget(ctx: ServiceContext): Promise<number | null> {
  const value = await readSetting(ctx, BUDGET_SETTING);
  return typeof value === "number" && value > 0 ? value : null;
}

export async function getAiCostOverview(ctx: ServiceContext): Promise<AiCostOverview> {
  const now = ctx.clock.now();
  const g = schema.generationRuns;
  const failed = sql<number>`count(*) filter (where ${g.status} in ('FAILED', 'REFUSED', 'INVALID_OUTPUT'))::int`;
  const rows = await ctx.db
    .select({
      stage: g.stage,
      runs: sql<number>`count(*)::int`,
      failed,
      cost: sql<string | null>`sum(${g.costUsd})`,
    })
    .from(g)
    .where(and(gte(g.createdAt, monthStart(now)), lt(g.createdAt, new Date(now.getTime() + 1))))
    .groupBy(g.stage);
  const [day] = await ctx.db
    .select({
      runs: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${g.status} = 'FAILED')::int`,
      refused: sql<number>`count(*) filter (where ${g.status} = 'REFUSED')::int`,
      invalid: sql<number>`count(*) filter (where ${g.status} = 'INVALID_OUTPUT')::int`,
    })
    .from(g)
    .where(gte(g.createdAt, new Date(now.getTime() - 86_400_000)));
  const byStage = rows
    .map((r) => ({
      stage: r.stage,
      runs: Number(r.runs),
      failed: Number(r.failed),
      costUsd: round(Number(r.cost ?? 0)),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.stage.localeCompare(b.stage));
  const monthToDateUsd = round(rows.reduce((s, r) => s + Number(r.cost ?? 0), 0));
  const budgetUsd = await getMonthlyBudget(ctx);
  return {
    month: monthKey(now),
    monthToDateUsd,
    budgetUsd,
    share: budgetUsd ? monthToDateUsd / budgetUsd : null,
    state: budgetState(monthToDateUsd, budgetUsd),
    byStage,
    stages: Object.entries(STAGE_CONFIG).map(([stage, c]) => ({
      stage,
      promptId: c.promptId,
      version: c.version,
      model: c.model,
      effort: c.effort,
      maxTokens: c.maxTokens,
    })),
    last24h: {
      runs: Number(day?.runs ?? 0),
      failed: Number(day?.failed ?? 0),
      refused: Number(day?.refused ?? 0),
      invalid: Number(day?.invalid ?? 0),
    },
  };
}

export type BudgetAlert = {
  level: "AMBER" | "RED";
  month: string;
  monthToDateUsd: number;
  budgetUsd: number;
};

/**
 * J24: the budget state now, and an alert when the month has reached a level (amber, then red)
 * that was not alerted yet. The alert is remembered, so the next run is quiet until the next
 * level or the next month.
 */
export async function checkAiBudget(
  ctx: ServiceContext,
): Promise<{ state: BudgetState; monthToDateUsd: number; alert: BudgetAlert | null }> {
  const overview = await getAiCostOverview(ctx);
  const { state, month, monthToDateUsd, budgetUsd } = overview;
  if (!budgetUsd || (state !== "AMBER" && state !== "RED")) {
    return { state, monthToDateUsd, alert: null };
  }
  const previous = (await readSetting(ctx, ALERT_STATE_KEY)) as
    | { month?: string; level?: BudgetState }
    | undefined;
  const alerted = previous?.month === month ? LEVEL[previous.level ?? "NONE"] : 0;
  if (LEVEL[state] <= alerted) return { state, monthToDateUsd, alert: null };
  const value = { month, level: state };
  await ctx.db
    .insert(schema.appSettings)
    .values({ key: ALERT_STATE_KEY, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: ctx.clock.now() },
    });
  const alert: BudgetAlert = { level: state, month, monthToDateUsd, budgetUsd };
  await audit(ctx, { action: "ai.budget_alert", entityType: "ai_budget", data: { ...alert } });
  ctx.logger.warn({ ...alert }, "AI cost budget alert");
  return { state, monthToDateUsd, alert };
}
