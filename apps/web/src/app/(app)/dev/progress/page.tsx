import type { DraftProgress, ProgressStep } from "@rc/modules/content";
import { notFound } from "next/navigation";
import { ProgressPanelView } from "@/components/review/progress-panel";
import { requireUser } from "@/server/auth/session";
import { isDevToolsEnabled } from "@/server/dev-tools";
import { serverEnv } from "@/server/runtime";

// /dev/progress: the progress panel in each of its states, on synthetic data, so that it can be
// looked at without waiting for a real run. Development only; 404 elsewhere.
export const dynamic = "force-dynamic";

const KEYS = ["ADAPT", "WRITE", "CRITIC", "VISUAL", "PICTURES", "RENDER"] as const;
const steps = (...states: ProgressStep["state"][]): ProgressStep[] =>
  KEYS.map((key, i) => ({ key, state: states[i] ?? "todo" }));

export default async function DevProgressPage() {
  if (!isDevToolsEnabled(serverEnv().appEnv)) notFound();
  await requireUser();
  const now = Date.now();
  const base = {
    variantId: "v",
    marketCode: "es-ES",
    status: "GENERATING",
    lastProgressAt: new Date(now - 20_000).toISOString(),
    stalled: false,
    error: null,
  } satisfies Partial<DraftProgress>;
  const cases: { title: string; progress: DraftProgress; usualMs: number | null }[] = [
    {
      title: "Waiting to start",
      usualMs: 240_000,
      progress: {
        ...base,
        status: "DRAFT",
        phase: "queued",
        steps: steps(),
        startedAt: null,
      },
    },
    {
      title: "Writing (with the usual time)",
      usualMs: 240_000,
      progress: {
        ...base,
        phase: "running",
        steps: steps("done", "current"),
        startedAt: new Date(now - 95_000).toISOString(),
      },
    },
    {
      title: "Critic after a rewrite",
      usualMs: 240_000,
      progress: {
        ...base,
        phase: "running",
        steps: steps("done", "done").map((s) =>
          s.key === "CRITIC" ? { ...s, state: "current" as const, rewrite: 1 } : s,
        ),
        startedAt: new Date(now - 200_000).toISOString(),
      },
    },
    {
      title: "Pictures, 2 of 5",
      usualMs: null,
      progress: {
        ...base,
        status: "READY_FOR_REVIEW",
        phase: "running",
        steps: steps("done", "done", "done", "done", "current").map((s) =>
          s.key === "PICTURES" ? { ...s, count: { done: 2, total: 5 } } : s,
        ),
        startedAt: new Date(now - 60_000).toISOString(),
      },
    },
    {
      title: "Taking longer than usual",
      usualMs: 240_000,
      progress: {
        ...base,
        phase: "running",
        stalled: true,
        steps: steps("done", "done", "current"),
        startedAt: new Date(now - 17 * 60_000).toISOString(),
      },
    },
    {
      title: "Failed",
      usualMs: null,
      progress: {
        ...base,
        status: "DRAFT",
        phase: "failed",
        steps: steps("done", "failed"),
        startedAt: null,
        error: {
          code: "INVALID_OUTPUT",
          message: "The WRITE:0 step did not produce a valid answer.",
        },
      },
    },
  ];
  return (
    <main className="flex max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Dev: progress panel</h1>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {cases.map((c) => (
          <section key={c.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{c.title}</h2>
            <ProgressPanelView progress={c.progress} usualMs={c.usualMs} />
          </section>
        ))}
      </div>
    </main>
  );
}
