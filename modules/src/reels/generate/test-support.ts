import { writeFile } from "node:fs/promises";
import { schema } from "@rc/db";
import type { Slide } from "@rc/db/json";
import { eq } from "@rc/db/orm";
import { createFakeLLMProvider, type LLMProvider } from "@rc/lib/providers/llm";
import type { VideoProvider } from "@rc/lib/providers/video";
import { createFakeVideoProvider } from "@rc/lib/providers/video";
import { REEL_POSTS } from "@rc/prompts/fixtures/reel-director";
import sharp from "sharp";
import {
  type ReviewFixture,
  recordingJobs,
  reviewFixture,
  testLogger,
} from "../../content/variants/test-support";
import { createServiceContext, type JobRunner, type ServiceContext } from "../../core";
import type { AssembledReel, AssembleInput } from "../render";
import { assemblyInputHash } from "../render";

// Fixtures for the tests of the Reel generation (M8-06): a finished carousel with six pictures in
// storage, the scripted director of the synthetic risotto post, the fake video provider, and an
// assembly that writes a small file instead of running ffmpeg. Synthetic content only.

type Db = ServiceContext["db"];
const POST = REEL_POSTS[0];

export type ReelFixture = ReviewFixture & {
  carouselId: string;
  /** Visual asset ids of the pictures p1 … p6 of the synthetic post. */
  assetIds: string[];
  jobs: ReturnType<typeof recordingJobs>;
  /** A context that can do everything the job needs. */
  jobCtx: (parts?: {
    llm?: LLMProvider;
    video?: VideoProvider;
    jobs?: JobRunner;
  }) => ServiceContext;
  setEnabled: (on: boolean) => Promise<void>;
};

/** The synthetic director answer with the real asset ids in place of p1 … p6. */
export function directorAnswer(assetIds: readonly string[]) {
  if (!POST) throw new Error("missing synthetic post");
  const swap = (id: string) => assetIds[Number(id.slice(1)) - 1] ?? id;
  const output = structuredClone(POST.output);
  for (const scene of output.scenes) scene.sourcePictureId = swap(scene.sourcePictureId);
  return output;
}

export function scriptedLlm(answer: unknown): ReturnType<typeof createFakeLLMProvider> {
  return createFakeLLMProvider({ handler: () => answer });
}

const png = (color: string) =>
  sharp({ create: { width: 540, height: 675, channels: 3, background: color } })
    .png()
    .toBuffer();

export async function reelFixture(db: Db): Promise<ReelFixture> {
  if (!POST) throw new Error("missing synthetic post");
  const jobs = recordingJobs();
  const fx = await reviewFixture(db, { jobs: jobs.runner });
  const { variantId: carouselId } = await fx.makeVariant({ status: "READY_FOR_REVIEW" });
  const [brand] = await db.select().from(schema.brands);

  // The six pictures of the synthetic post, in storage, as READY assets.
  const assetIds: string[] = [];
  for (const [i, picture] of POST.input.pictures.entries()) {
    const key = `assets/test/${i + 1}.png`;
    await fx.storage.put(
      key,
      await png(["#d9a441", "#8aa05a", "#c46a3a", "#e8d8b0", "#a36a4a", "#cfae62"][i] ?? "#888888"),
      {
        contentType: "image/png",
      },
    );
    const [asset] = await db
      .insert(schema.visualAssets)
      .values({
        brandId: brand?.id ?? "",
        kind: "GENERATED",
        status: "READY",
        contentVariantId: carouselId,
        storageKey: key,
        mimeType: "image/png",
        width: 540,
        height: 675,
        description: picture.description,
      })
      .returning({ id: schema.visualAssets.id });
    assetIds.push(asset?.id ?? "");
  }

  // The carousel of the synthetic post: its slide ids c1 … c6 and its pictures.
  const imageOf = (slideId: string) =>
    Object.fromEntries(
      POST.input.pictures
        .map((p, index) => ({ p, index }))
        .filter(({ p }) => p.slideId === slideId)
        .map(({ index }, n) => [`image${n}`, { assetId: assetIds[index] ?? "" }]),
    );
  const slides: Slide[] = POST.input.carousel.slides.map((s, index) => ({
    id: s.id,
    index,
    role: s.role as Slide["role"],
    templateId: s.role === "HOOK" ? "A" : s.role === "CTA" ? "F" : "B",
    slots: s.role === "HOOK" ? { headline: s.text } : { body: s.text },
    images: imageOf(s.id),
    knowledgeIds: [...s.knowledgeIds],
    factual: s.factual,
    altText: "A picture.",
  }));
  await db
    .update(schema.contentVariants)
    .set({
      slidesJson: slides,
      hook: POST.input.carousel.hook,
      hookType: POST.input.carousel.hookType,
      ctaType: "SAVE",
    })
    .where(eq(schema.contentVariants.id, carouselId));

  const jobCtx: ReelFixture["jobCtx"] = (parts = {}) =>
    createServiceContext({
      db,
      logger: testLogger,
      clock: fx.clock,
      storage: fx.storage,
      llm: parts.llm ?? scriptedLlm(directorAnswer(assetIds)),
      video: parts.video ?? createFakeVideoProvider(),
      jobs: parts.jobs ?? jobs.runner,
      actor: { type: "JOB", jobRunId: "run-test" },
    });
  const setEnabled = async (on: boolean) => {
    await db
      .insert(schema.appSettings)
      .values({ key: "reels.enabled", value: on })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: on } });
  };
  return { ...fx, carouselId, assetIds, jobs, jobCtx, setEnabled };
}

/** Writes a small file where ffmpeg would write the Reel, and answers like the assembly. */
export function stubAssemble() {
  const calls: AssembleInput[] = [];
  const assemble = async (input: AssembleInput): Promise<AssembledReel> => {
    calls.push(input);
    await writeFile(input.outPath, "reel-bytes");
    return {
      path: input.outPath,
      inputHash: assemblyInputHash(input),
      plan: { segments: [], flashSeconds: 0.88, totalSeconds: 14 },
      audioKind: "NONE",
      durationMs: 14_880,
      width: 1080,
      height: 1920,
      bytes: 10,
      sha256: "f".repeat(64),
      qa: {
        durationMs: 14_880,
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        fileBytes: 10,
        blackFrames: 0,
        safeZoneOk: true,
        firstSecondMotion: 3,
        warnings: [],
      },
      cards: {},
    };
  };
  return { assemble, calls };
}
