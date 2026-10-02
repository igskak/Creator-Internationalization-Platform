import { notFound } from "next/navigation";
import { HelloJobButton } from "@/components/dev/hello-job-button";
import { requireUser } from "@/server/auth/session";
import { isDevToolsEnabled } from "@/server/dev-tools";
import { serverEnv } from "@/server/runtime";

// /dev/jobs (M0-14a): development only; 404 elsewhere.
export default async function DevJobsPage() {
  const env = serverEnv();
  if (!isDevToolsEnabled(env.appEnv)) notFound();
  const user = await requireUser();

  return (
    <main className="flex max-w-3xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dev: jobs</h1>
        <p className="text-muted-foreground">
          Starts the hello job (jobs mode: {env.jobs.mode}). It writes a job.hello row to
          audit_events. With Trigger.dev, run pnpm jobs:dev first.
        </p>
      </div>
      <HelloJobButton canRun={user.role === "owner"} />
    </main>
  );
}
