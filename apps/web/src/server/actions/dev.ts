"use server";

import { triggerJob } from "@rc/modules/core";
import { z } from "zod";
import { assertDevTools } from "../dev-tools";
import { serverEnv } from "../runtime";
import { defineAction } from "./_define";

// Dev-only actions (M0-14a); every one refuses outside APP_ENV=development.

/** Starts the `hello` job through ctx.jobs (inline or Trigger.dev, per JOBS_MODE). */
export const runHelloJob = defineAction({
  name: "runHelloJob",
  input: z.object({ name: z.string().trim().min(1).max(100).default("world") }),
  roles: ["owner"],
  handler: async (ctx, { name }) => {
    const env = serverEnv();
    assertDevTools(env.appEnv);
    const { runId } = await triggerJob(ctx, "hello", { name, fail: false });
    return { runId, mode: env.jobs.mode };
  },
});
