"use client";

import type { ReelView } from "@rc/modules/reels";
import { DownloadIcon, FilmIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { MarketInfo } from "@/components/calendar/calendar-dialogs";
import { PublishPanel } from "@/components/publishing/publish-panel";
import { PUBLISHABLE_STATUSES } from "@/components/publishing/statuses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import type { VariantPublicationsDto } from "@/lib/publication-dto";
import {
  changeReelHook,
  estimateReel,
  generateReel,
  regenerateReelShot,
} from "@/server/actions/reels";
import { VariantActions } from "./variant-actions";
import { VariantProvider } from "./variant-state";

// The Reel card of a market's column (plan 18 §18.2, M8-07): the Generate Reel button with its
// estimate dialog, the progress of a Reel being made, and, once it exists, the video, the hook
// options, the scenes with their shots, the cost and the download; then (M8-09) approve, reject,
// request changes and, once approved, the same publishing panel as a carousel (schedule, publish
// now, dry run). The page refreshes while the Reel is made (ReviewPoller).

type Detail = NonNullable<ReelView["reel"]>;
type ModelId = keyof ReelView["estimates"];
const SLOW_AFTER_MS = 15 * 60 * 1000;

/** `Hot water on **bulgur?**` as the reader sees it. */
const plain = (card: string) => card.replaceAll("**", "");

function useMoney() {
  const { locale } = useI18n();
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
}

function GenerateDialog({
  view,
  label,
  disabled,
  reason,
}: {
  view: ReelView;
  label: string;
  disabled: boolean;
  reason: string | undefined;
}) {
  const t = useI18n().messages.review.reel;
  const money = useMoney();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ModelId>("alibaba/wan-3.0");
  // The estimate is read again from the server when the model changes: rates are a setting.
  const [fresh, setFresh] = useState<Partial<Record<ModelId, ReelView["estimates"][ModelId]>>>({});
  const estimate = fresh[model] ?? view.estimates[model];
  const lookup = useAction(estimateReel, { toastOnError: false });
  const { run, pending } = useAction(generateReel, {
    onSuccess: () => {
      setOpen(false);
      toast(t.dialog.queued);
      router.refresh();
    },
  });

  const choose = async (next: ModelId) => {
    setModel(next);
    const result = await lookup.run({ carouselVariantId: view.carouselVariantId, model: next });
    if (result.ok) setFresh((f) => ({ ...f, [next]: result.data.estimate }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" disabled={disabled} title={reason} variant="default" />
        }
      >
        <FilmIcon /> {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.dialog.title}</DialogTitle>
          <DialogDescription>
            {format(t.dialog.description, {
              shots: estimate.shots,
              seconds: estimate.secondsPerShot,
            })}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t.dialog.model}</legend>
          {(Object.keys(view.estimates) as ModelId[]).map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`reel-model-${view.carouselVariantId}`}
                value={id}
                checked={model === id}
                onChange={() => void choose(id)}
              />
              {t.dialog.models[id]}
              <span className="ml-auto text-muted-foreground tabular-nums">
                {money.format((fresh[id] ?? view.estimates[id]).totalUsd)}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {t.dialog.estimate}: {money.format(estimate.totalUsd)}
          </p>
          <p className="text-muted-foreground">
            {format(t.dialog.estimateParts, {
              shots: estimate.shots,
              shotsCost: money.format(estimate.shotsUsd),
              scriptCost: money.format(estimate.directorUsd),
            })}
          </p>
          <p className="text-muted-foreground">{t.dialog.language}</p>
          <p className="text-muted-foreground">{t.dialog.wait}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t.dialog.cancel}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void run({
                carouselVariantId: view.carouselVariantId,
                model,
                confirmEstimateUsd: estimate.totalUsd,
              })
            }
          >
            {format(t.dialog.submit, { cost: money.format(estimate.totalUsd) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Progress({ reel }: { reel: Detail }) {
  const t = useI18n().messages.review.reel.progress;
  const stage = reel.stage;
  const slow = stage ? Date.now() - Date.parse(stage.startedAt) > SLOW_AFTER_MS : false;
  const order = ["DIRECTION", "SHOTS", "ASSEMBLY"] as const;
  if (!stage) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t.queued}
      </p>
    );
  }
  return (
    <section aria-label={t.title} className="flex flex-col gap-2" aria-live="polite">
      <h4 className="text-sm font-medium">{t.title}</h4>
      <ol className="flex flex-col gap-1 text-sm">
        {order.map((name) => {
          const done =
            stage.completed.includes(name) || order.indexOf(name) < order.indexOf(stage.current);
          const current = name === stage.current;
          return (
            <li
              key={name}
              data-state={done ? "done" : current ? "current" : "todo"}
              className={
                done
                  ? "text-muted-foreground line-through"
                  : current
                    ? "font-medium"
                    : "text-muted-foreground"
              }
            >
              {t.stages[name]}
              {name === "SHOTS" && stage.shotsTotal !== null && (current || done) ? (
                <span className="ml-2 tabular-nums">
                  {format(t.shots, {
                    done: done ? stage.shotsTotal : stage.shotsReady,
                    total: stage.shotsTotal,
                  })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {slow ? <p className="text-xs text-muted-foreground">{t.slow}</p> : null}
    </section>
  );
}

function RedoShot({
  reel,
  sceneId,
  index,
  price,
}: {
  reel: Detail;
  sceneId: string;
  index: number;
  price: number;
}) {
  const t = useI18n().messages.review.reel.scenes;
  const money = useMoney();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(regenerateReelShot, {
    onSuccess: () => {
      setOpen(false);
      toast(t.redoQueued);
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="xs" variant="outline" />}>
        {t.redo}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.redoTitle}</DialogTitle>
          <DialogDescription>{format(t.redoDescription, { n: index + 1 })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void run({ variantId: reel.variantId, sceneId, confirmEstimateUsd: price })
            }
          >
            {format(t.redoSubmit, { cost: money.format(price) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Ready({ view, reel, canManage }: { view: ReelView; reel: Detail; canManage: boolean }) {
  const t = useI18n().messages.review.reel;
  const money = useMoney();
  const router = useRouter();
  const script = reel.script;
  const { run: changeHook, pending: changing } = useAction(changeReelHook, {
    onSuccess: () => {
      toast(t.hook.queued);
      router.refresh();
    },
  });
  const model = (script?.model ?? "alibaba/wan-3.0") as ModelId;
  const estimate = view.estimates[model];
  const shotPrice = Math.round((estimate.shotsUsd / estimate.shots) * 10_000) / 10_000;
  const canChange = canManage && reel.changeable;
  const render = reel.render;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {render.playUrl && render.state !== "FAILED" ? (
          // biome-ignore lint/a11y/useMediaCaption: a silent-first Reel has no speech to caption
          <video
            controls
            playsInline
            preload="metadata"
            src={render.playUrl}
            aria-label={t.video.label}
            className="aspect-[9/16] w-full max-w-60 rounded-lg bg-black"
          />
        ) : null}
        {render.state === "RENDERING" ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t.video.rebuilding}
          </p>
        ) : render.state === "STALE" ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t.video.stale}
          </p>
        ) : render.state === "FAILED" ? (
          <p role="alert" className="text-sm text-destructive">
            {format(t.video.failed, { message: render.error ?? "" })}
          </p>
        ) : render.state === "NONE" ? (
          <p className="text-sm text-muted-foreground">{t.video.none}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {render.durationMs !== null && render.bytes !== null ? (
            <span>
              {format(t.video.details, {
                seconds: Math.round(render.durationMs / 100) / 10,
                size: (render.bytes / 1_000_000).toFixed(1),
              })}
            </span>
          ) : null}
          <span>
            {reel.costUsd === null
              ? t.video.noCost
              : format(t.video.cost, { cost: money.format(reel.costUsd) })}
          </span>
        </div>
        {render.warnings.length > 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {format(t.video.checks, { warnings: render.warnings.join(", ") })}
          </p>
        ) : null}
        {render.downloadUrl ? (
          <a
            href={render.downloadUrl}
            download
            className="flex w-fit items-center gap-1 text-sm underline underline-offset-2"
          >
            <DownloadIcon className="size-4" aria-hidden="true" /> {t.video.download}
          </a>
        ) : null}
      </div>

      {script ? (
        <section aria-label={t.hook.title} className="flex flex-col gap-2">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t.hook.title}
          </h4>
          <ul className="flex flex-col gap-2">
            {script.hookOptions.map((option) => {
              const chosen = option.id === script.chosenHookId;
              return (
                <li
                  key={option.id}
                  data-hook={option.id}
                  data-chosen={chosen ? "true" : "false"}
                  className="flex flex-col gap-1 rounded-lg border p-2 text-sm"
                >
                  <p className="font-medium">{plain(option.card)}</p>
                  <p className="text-muted-foreground">
                    {t.hook.rule}: {plain(option.ruleCard)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {option.hookType}
                    </span>
                    {chosen ? (
                      <Badge variant="secondary">{t.hook.current}</Badge>
                    ) : (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={!canChange || changing}
                        title={canChange ? undefined : t.hook.blocked}
                        onClick={() =>
                          void changeHook({ variantId: reel.variantId, hookId: option.id })
                        }
                      >
                        {t.hook.use}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {script ? (
        <section
          aria-label={format(t.scenes.title, { count: script.scenes.length })}
          className="flex flex-col gap-2"
        >
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {format(t.scenes.title, { count: script.scenes.length })}
          </h4>
          <ol className="flex flex-col gap-1.5">
            {script.scenes.map((scene) => (
              <li
                key={scene.id}
                data-scene={scene.id}
                className="flex flex-col gap-1 rounded-lg border p-2 text-sm"
              >
                <p className="text-xs text-muted-foreground">
                  {format(t.scenes.line, {
                    n: scene.index + 1,
                    role: scene.role,
                    emotion: scene.emotion,
                  })}{" "}
                  · {format(t.scenes.beats, { beats: scene.beats })}
                </p>
                <p className="font-medium">{plain(scene.card)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t.scenes.shot[scene.shot ?? "NONE"]}</Badge>
                  {canChange && scene.shot === "READY" ? (
                    <RedoShot
                      reel={reel}
                      sceneId={scene.id}
                      index={scene.index}
                      price={shotPrice}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/** What the Reel's review block needs from the page: reasons for the dialogs, publishing facts. */
export type ReelReviewProps = {
  reasons: { code: string; label: string }[];
  flagLabels: Record<string, string>;
  publish?: {
    ideaId: string;
    market: MarketInfo;
    canManage: boolean;
    publications: VariantPublicationsDto;
  };
};

/** Approve, reject, request changes; then schedule and publish, like a carousel. */
function ReelReview({ reel, review }: { reel: Detail; review: ReelReviewProps }) {
  const { messages } = useI18n();
  const t = messages.review.reel.review;
  const { publish } = review;
  const hook = reel.script?.hookOptions.find((h) => h.id === reel.script?.chosenHookId)?.card;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="reel-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{t.title}</h4>
        <Badge variant="outline">
          {format(t.status, {
            status: (messages.review.status as Record<string, string>)[reel.status] ?? reel.status,
          })}
        </Badge>
      </div>
      <VariantProvider
        variantId={reel.variantId}
        lockVersion={reel.lockVersion}
        editBlocker={null}
        confirmKind={null}
        reasons={review.reasons}
        templates={{}}
        regenerations={[]}
      >
        <VariantActions allowed={reel.allowed} flagLabels={review.flagLabels} kind="reel" />
        {publish && PUBLISHABLE_STATUSES.includes(reel.status) ? (
          <PublishPanel
            variantId={reel.variantId}
            ideaId={publish.ideaId}
            title={`${messages.review.reel.title}: ${hook ? plain(hook) : publish.market.name}`}
            variantStatus={reel.status}
            market={publish.market}
            canManage={publish.canManage}
            publications={publish.publications}
          />
        ) : null}
      </VariantProvider>
    </div>
  );
}

export function ReelCard({
  view,
  canManage,
  review,
}: {
  view: ReelView;
  canManage: boolean;
  /** Absent in tests that only look at generating. */
  review?: ReelReviewProps;
}) {
  const t = useI18n().messages.review.reel;
  const reel = view.reel;
  const failed = reel !== null && reel.status === "DRAFT" && reel.lastError !== null;
  const generating = reel?.status === "GENERATING";
  const queued = reel !== null && reel.status === "DRAFT" && !reel.script && !reel.lastError;
  const reason = !canManage
    ? t.blocked.role
    : view.blockedBy
      ? t.blocked[view.blockedBy]
      : undefined;
  const blocked = reason !== undefined;

  return (
    <section
      aria-label={t.title}
      data-reel-state={
        generating || queued ? "making" : failed ? "failed" : reel ? "ready" : "none"
      }
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t.title}
        </h3>
        {!reel ? <p className="text-sm text-muted-foreground">{t.subtitle}</p> : null}
      </div>

      {generating || queued ? <Progress reel={reel as Detail} /> : null}

      {failed && reel ? (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950/40">
          <p className="font-medium">{t.failed.title}</p>
          <p>{format(t.failed.body, { message: reel.lastError?.message ?? "" })}</p>
        </div>
      ) : null}

      {reel && !generating && !queued && !failed ? (
        <Ready view={view} reel={reel} canManage={canManage} />
      ) : null}

      {reel && review && !generating && !queued && reel.script ? (
        <ReelReview reel={reel} review={review} />
      ) : null}

      {!generating && !queued ? (
        <div className="flex flex-col items-start gap-1">
          <GenerateDialog
            view={view}
            label={reel ? t.generateAgain : t.generate}
            disabled={blocked}
            reason={reason}
          />
          {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
