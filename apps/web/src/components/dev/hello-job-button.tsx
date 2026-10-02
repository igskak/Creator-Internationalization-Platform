"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAction } from "@/hooks/use-action";
import { runHelloJob } from "@/server/actions/dev";

/** Triggers the hello job and shows the run id (dev only, owner role). */
export function HelloJobButton({ canRun }: { canRun: boolean }) {
  const [last, setLast] = useState<{ runId: string; mode: string } | null>(null);
  const { run, pending } = useAction(runHelloJob, { onSuccess: setLast });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run hello job</CardTitle>
        <CardDescription>
          {canRun ? "Triggers the job through the configured runner." : "Owners only."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button disabled={!canRun || pending} onClick={() => void run({ name: "web" })}>
            {pending ? "Starting…" : "Run hello job"}
          </Button>
        </div>
        {last ? (
          <p className="text-sm">
            Started run <code>{last.runId}</code> ({last.mode}).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
