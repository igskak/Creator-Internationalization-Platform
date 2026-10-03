import { createHash } from "node:crypto";
import type { LLMContent, StructuredRequest } from "./types";

/**
 * SHA-256 of what the model is asked: model, system blocks, user content (binary documents by their
 * own hash) and effort. Stored as `generation_runs.input_hash` and used to key fake fixtures.
 */
export function llmInputHash(
  request: Pick<StructuredRequest<unknown>, "model" | "system" | "messages" | "effort">,
): string {
  const digest = (data: string) => createHash("sha256").update(data).digest("hex");
  const content = (part: LLMContent) =>
    part.type === "text"
      ? ["text", part.text]
      : part.type === "pdf"
        ? ["pdf", digest(part.base64)]
        : ["image", part.mediaType, digest(part.base64)];
  return digest(
    JSON.stringify([
      request.model,
      request.system.map((b) => [b.text, b.cache === true]),
      request.messages.map((m) => [m.role, m.content.map(content)]),
      request.effort ?? null,
    ]),
  );
}
