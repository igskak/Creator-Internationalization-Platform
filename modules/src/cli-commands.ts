import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { schema } from "@rc/db";
import { SOURCE_TYPES, type SourceType } from "@rc/db/json";
import { eq, sql } from "@rc/db/orm";
import { ValidationError } from "@rc/lib/errors";
import { importVoiceExamples, parseCsv } from "./content/voice";
import type { CliCommands } from "./core/cli";
import { runJobHandler } from "./core/job-runner";
import { helloJob } from "./job-handlers";
import { embedAndSuggest, indexSourceChunks } from "./knowledge/embedding";
import { canProcessWithAI } from "./knowledge/rights";
import { completeSourceUpload, createSourceUpload, getSourceReport } from "./knowledge/sources";
import { transcribeSourcePages } from "./knowledge/transcription";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
};

/** `--name value` options and `--flag` switches after the positional arguments. */
function parseOptions(args: string[], flags: string[]) {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
    } else if (flags.includes(arg.slice(2))) {
      options.set(arg.slice(2), true);
    } else {
      options.set(arg.slice(2), args[++i] ?? "");
    }
  }
  return { positional, options };
}

// Dev CLI commands (`pnpm rc <name>`, plan 15 M0-21). Later tasks add `generate`, `eval`.
// Like jobs and server actions, commands stay thin: validate → call one service.
export const cliCommands: CliCommands = {
  hello: {
    description: "Run the hello job in-process; writes one audit event",
    usage: "hello [name]",
    run: async (ctx, args) => {
      const result = (await runJobHandler(helloJob, ctx, { name: args[0] ?? "world" })) as {
        auditEventId: number;
      };
      console.log(`rc hello: wrote audit event ${result.auditEventId}`);
    },
  },
  "voice-import": {
    description:
      "Import voice examples (Sergey's edits, rules, examples) from a .json array or a .csv file",
    usage: "voice-import <file>",
    run: async (ctx, args) => {
      const file = args[0];
      if (!file) throw new ValidationError("Usage: voice-import <file.json|file.csv>");
      const text = await readFile(file, "utf8");
      const rows =
        extname(file).toLowerCase() === ".csv" ? parseCsv(text) : (JSON.parse(text) as unknown[]);
      const result = await importVoiceExamples(ctx, rows);
      console.log(`rc voice-import: ${result.created} created, ${result.skipped} already there`);
    },
  },
  embed: {
    description: "Embed every card without a current vector and suggest duplicates (J3 backfill)",
    usage: "embed",
    run: async (ctx) => {
      const result = await embedAndSuggest(ctx, {});
      console.log(
        `rc embed: ${result.embedded} cards embedded, ${result.skipped} already current, ${result.duplicates.length} duplicates suspected (model ${ctx.embeddings.model})`,
      );
      for (const d of result.duplicates) {
        console.log(`  ${d.id} ~ ${d.duplicateOfId} (${d.similarity})`);
      }
    },
  },
  "index-chunks": {
    description:
      "Cut ready sources into chunks and embed them for source search (all sources, or one id)",
    usage: "index-chunks [sourceAssetId]",
    run: async (ctx, args) => {
      const sources = (
        await ctx.db
          .select()
          .from(schema.sourceAssets)
          .where(eq(schema.sourceAssets.processingStatus, "READY"))
      ).filter((s) => !s.archivedAt && (args[0] ? s.id === args[0] : canProcessWithAI(s)));
      if (sources.length === 0) console.log("rc index-chunks: no ready source to index");
      for (const source of sources) {
        const result = await indexSourceChunks(ctx, source.id);
        console.log(
          `rc index-chunks: ${source.title}: ${result.chunks} chunks, ${result.embedded} embedded, ${result.reused} kept (model ${ctx.embeddings.model})`,
        );
      }
    },
  },
  "transcribe-pages": {
    description:
      "Transcribe the scanned pages (no text layer) of ready PDF sources and re-check their cards' quotes (all, or one id)",
    usage: "transcribe-pages [sourceAssetId]",
    run: async (ctx, args) => {
      const sources = (
        await ctx.db
          .select()
          .from(schema.sourceAssets)
          .where(eq(schema.sourceAssets.processingStatus, "READY"))
      ).filter((s) => !s.archivedAt && (args[0] ? s.id === args[0] : canProcessWithAI(s)));
      if (sources.length === 0) console.log("rc transcribe-pages: no ready source to check");
      for (const source of sources) {
        const result = await transcribeSourcePages(ctx, { sourceAssetId: source.id });
        console.log(
          `rc transcribe-pages: ${source.title}: ${result.transcribed} pages transcribed, ${result.quotesVerified} quotes now verified, ${result.illegible.length} not fully legible, ${result.failed.length} failed`,
        );
      }
    },
  },
  "source-report": {
    description:
      "Print the M1 acceptance numbers of a source: pages, cards, verified quotes, model cost and time (all ready sources, or one id)",
    usage: "source-report [sourceAssetId]",
    run: async (ctx, args) => {
      const sources = (
        await ctx.db
          .select({ id: schema.sourceAssets.id })
          .from(schema.sourceAssets)
          .where(eq(schema.sourceAssets.processingStatus, "READY"))
      ).filter((s) => !args[0] || s.id === args[0]);
      if (sources.length === 0) console.log("rc source-report: no ready source");
      for (const { id } of sources) {
        console.log(JSON.stringify({ id, ...(await getSourceReport(ctx, id)) }, null, 2));
      }
    },
  },
  ingest: {
    description:
      "Upload a file as a source and ingest it in-process (options: --type, --language, --title)",
    usage: "ingest <file> --ai-allowed",
    run: async (ctx, args) => {
      const { positional, options } = parseOptions(args, ["ai-allowed"]);
      const path = positional[0];
      if (!path) throw new ValidationError("Give a file: ingest <file> --ai-allowed");
      if (!options.has("ai-allowed")) {
        throw new ValidationError(
          "Ingestion sends the file to the language model. Pass --ai-allowed to confirm that you may send this material.",
        );
      }
      const type = String(options.get("type") ?? "GUIDE").toUpperCase();
      if (!(SOURCE_TYPES as readonly string[]).includes(type)) {
        throw new ValidationError(
          `Unknown source type "${type}". Use one of: ${SOURCE_TYPES.join(", ")}.`,
        );
      }
      const mimeType = MIME_BY_EXTENSION[extname(path).toLowerCase()];
      if (!mimeType) throw new ValidationError(`Unsupported file extension "${extname(path)}".`);
      const bytes = new Uint8Array(await readFile(path));

      const { sourceAssetId } = await createSourceUpload(ctx, {
        type: type as SourceType,
        title: String(options.get("title") ?? basename(path)),
        fileName: basename(path),
        mimeType,
        sizeBytes: bytes.byteLength,
        originalLanguage: String(options.get("language") ?? "ru"),
        rights: {
          use: "UNKNOWN",
          translate: "UNKNOWN",
          adapt: "UNKNOWN",
          visuallyTransform: "UNKNOWN",
          sell: "UNKNOWN",
          aiProcessing: "ALLOWED",
          improvePrompts: "UNKNOWN",
          notes: "Set by the dev CLI (--ai-allowed).",
        },
      });
      const [created] = await ctx.db
        .select({ fileKey: schema.sourceAssets.fileKey })
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      await ctx.storage.put(created?.fileKey ?? "", bytes, { contentType: mimeType });
      await completeSourceUpload(ctx, { sourceAssetId });

      const [source] = await ctx.db
        .select()
        .from(schema.sourceAssets)
        .where(eq(schema.sourceAssets.id, sourceAssetId));
      const cards = await ctx.db
        .select({
          status: schema.knowledgeItems.reviewStatus,
          flags: schema.knowledgeItems.reviewFlags,
          hasVector: sql<boolean>`${schema.knowledgeItems.embedding} is not null`,
        })
        .from(schema.knowledgeItems)
        .where(eq(schema.knowledgeItems.sourceAssetId, sourceAssetId));
      const runs = await ctx.db
        .select({ cost: schema.generationRuns.costUsd, usage: schema.generationRuns.usage })
        .from(schema.generationRuns)
        .where(eq(schema.generationRuns.sourceAssetId, sourceAssetId));
      const cost = runs.reduce((sum, run) => sum + Number(run.cost ?? 0), 0);
      const tokens = runs.reduce(
        (sum, run) => ({
          input: sum.input + (run.usage?.inputTokens ?? 0),
          output: sum.output + (run.usage?.outputTokens ?? 0),
        }),
        { input: 0, output: 0 },
      );
      const embedded = cards.filter((c) => c.hasVector).length;
      const unverified = cards.filter((c) => c.flags.includes("QUOTE_UNVERIFIED")).length;
      console.log(
        [
          `rc ingest: source ${sourceAssetId}`,
          `  status:  ${source?.processingStatus}${source?.processingError ? ` (${source.processingError.code}: ${source.processingError.message})` : ""}`,
          `  pages:   ${source?.pageCount ?? 0}`,
          `  vectors: ${embedded}/${cards.length} cards embedded, duplicates suspected: ${cards.filter((c) => c.flags.includes("DUPLICATE_SUSPECTED")).length}`,
          `  cards:   ${cards.length} (quote unverified: ${unverified}, safety-sensitive: ${cards.filter((c) => c.flags.includes("SAFETY_SENSITIVE")).length})`,
          `  model:   ${runs.length} calls, ${tokens.input} in / ${tokens.output} out tokens, $${cost.toFixed(4)}`,
          ...(source?.processingProgress?.failedBatches?.length
            ? [`  failed batches: ${JSON.stringify(source.processingProgress.failedBatches)}`]
            : []),
        ].join("\n"),
      );
    },
  },
};
