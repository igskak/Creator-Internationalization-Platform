import type { ProcessingProgress } from "@rc/db/json";

/**
 * Progress of a source in percent from what the job reported (plan 05 §5.7), or null when it did
 * not report any. The last part is the finishing step: verification and embeddings.
 */
export function progressPercent(source: {
  processingStatus: string;
  processingProgress: ProcessingProgress;
}): number | null {
  if (source.processingStatus === "READY") return 100;
  const p = source.processingProgress;
  if (p.stage === "DONE") return 100;
  if (p.batchesTotal && p.batchesDone !== undefined) {
    return Math.min(95, Math.round((p.batchesDone / p.batchesTotal) * 90) + 5);
  }
  if (p.stage === "SNIFF") return 2;
  if (p.stage === "PARSE") return 3;
  if (p.stage === "PLAN") return 5;
  return source.processingStatus === "PROCESSING" || source.processingStatus === "QUEUED"
    ? 1
    : null;
}
