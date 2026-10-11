"use client";

import {
  formatLocalDateTime,
  offsetLabel,
  parseLocalDateTime,
  zonedToUtc,
} from "@rc/modules/publishing/time";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { FieldBlock } from "@/components/knowledge/field-block";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { format } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import {
  cancelPublication,
  reschedulePublication,
  schedulePublication,
} from "@/server/actions/publishing";

export type MarketInfo = { code: string; name: string; flagEmoji: string | null; timeZone: string };

const MIN_LEAD_MS = 5 * 60_000;

/** A time as the market's clock shows it, with the zone: "2026-10-20 13:00 (UTC+2)". */
function slot(at: Date, timeZone: string): string {
  return `${formatLocalDateTime(at, timeZone).replace("T", " ")} (${offsetLabel(at, timeZone)})`;
}

/** The date-and-time input of the dialogs: the market's wall clock, turned into UTC for the server. */
function useTimePicker(market: MarketInfo, initial: Date | null) {
  const { locale } = useI18n();
  const [value, setValue] = useState(initial ? formatLocalDateTime(initial, market.timeZone) : "");
  const resolved = useMemo(() => {
    const local = parseLocalDateTime(value);
    return local ? zonedToUtc(local, market.timeZone) : null;
  }, [value, market.timeZone]);
  const mine = resolved
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        resolved.utc,
      )
    : null;
  return { value, setValue, resolved, mine };
}

function Warnings({ warnings }: { warnings: { code: string; message: string }[] }) {
  const t = useI18n().messages.calendar;
  if (warnings.length === 0) return null;
  return (
    <div role="status" className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
      <p className="font-medium">{t.dialog.warnings}</p>
      <ul className="list-disc pl-5">
        {warnings.map((w) => (
          <li key={w.code}>{(t.warnings as Record<string, string>)[w.code] ?? w.message}</li>
        ))}
      </ul>
    </div>
  );
}

function TimeField({
  id,
  market,
  picker,
  error,
}: {
  id: string;
  market: MarketInfo;
  picker: ReturnType<typeof useTimePicker>;
  error?: string | undefined;
}) {
  const t = useI18n().messages.calendar.dialog;
  const { resolved, mine, value, setValue } = picker;
  return (
    <FieldBlock
      label={`${t.when} · ${market.timeZone}`}
      htmlFor={id}
      error={error}
      hint={
        resolved
          ? resolved.adjusted
            ? format(t.adjusted, { time: slot(resolved.utc, market.timeZone) })
            : format(t.yourTime, { time: mine ?? "" })
          : undefined
      }
    >
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required
      />
    </FieldBlock>
  );
}

/** "Schedule…" for an approved draft: the time is typed in the market's time zone. */
export function ScheduleButton({
  variantId,
  title,
  market,
  canSchedule,
  children,
}: {
  variantId: string;
  title: string;
  market: MarketInfo;
  canSchedule: boolean;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const t = messages.calendar.dialog;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const picker = useTimePicker(market, null);
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const { run, pending, fieldErrors, error } = useAction(schedulePublication, {
    toastOnError: false,
    onSuccess: (data) => {
      setWarnings(data.warnings);
      toast.success(
        format(t.scheduled, { time: slot(new Date(data.scheduledAt ?? 0), market.timeZone) }),
      );
      if (data.warnings.length === 0) setOpen(false);
      router.refresh();
    },
  });
  const tooSoon = picker.resolved
    ? picker.resolved.utc.getTime() < Date.now() + MIN_LEAD_MS
    : false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={!canSchedule} />}>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(t.scheduleTitle, { title })}</DialogTitle>
          <DialogDescription>
            {format(t.scheduleDescription, { market: market.name, zone: market.timeZone })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!picker.resolved) return;
            void run({ variantId, scheduledAt: picker.resolved.utc.toISOString() });
          }}
        >
          <TimeField
            id={`schedule-${variantId}`}
            market={market}
            picker={picker}
            error={fieldErrors?.scheduledAt?.[0]}
          />
          {error && !fieldErrors ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          <Warnings warnings={warnings} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={!picker.resolved || tooSoon || pending}>
              {pending ? t.working : t.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type PostInfo = {
  publicationId: string;
  variantId: string;
  ideaId: string;
  title: string;
  market: MarketInfo;
  /** ISO. */
  at: string;
  status: string;
  warnings: string[];
  permalink: string | null;
};

/** A post of the calendar: its details, and for owners and editors moving it or calling it off. */
export function PostButton({
  post,
  canSchedule,
  className,
  children,
}: {
  post: PostInfo;
  canSchedule: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const t = messages.calendar.dialog;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const at = new Date(post.at);
  const picker = useTimePicker(post.market, at);
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const movable = post.status === "SCHEDULED";
  const cancellable = post.status === "SCHEDULED" || post.status === "QUEUED";

  const move = useAction(reschedulePublication, {
    toastOnError: false,
    onSuccess: (data) => {
      setWarnings(data.warnings);
      toast.success(
        format(t.moved, { time: slot(new Date(data.scheduledAt ?? 0), post.market.timeZone) }),
      );
      router.refresh();
    },
  });
  const cancel = useAction(cancelPublication, {
    toastOnError: false,
    onSuccess: () => {
      toast.success(t.cancelled);
      setOpen(false);
      setCancelling(false);
      setReason("");
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={className} />}>
        {children}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(t.postTitle, { market: post.market.name })}</DialogTitle>
          <DialogDescription>
            {post.title} · {slot(at, post.market.timeZone)}
          </DialogDescription>
        </DialogHeader>
        <Warnings
          warnings={[...post.warnings, ...warnings.map((w) => w.code)]
            .filter((code, i, all) => all.indexOf(code) === i)
            .map((code) => ({ code, message: code }))}
        />
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/content/review/${post.ideaId}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t.openReview}
          </Link>
          {post.permalink ? (
            <a
              href={post.permalink}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t.permalink}
            </a>
          ) : null}
        </div>

        {!canSchedule && (movable || cancellable) ? (
          <p className="text-sm text-muted-foreground">{t.readOnly}</p>
        ) : null}

        {canSchedule && movable ? (
          <form
            className="flex flex-col gap-3 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!picker.resolved) return;
              void move.run({
                publicationId: post.publicationId,
                scheduledAt: picker.resolved.utc.toISOString(),
              });
            }}
          >
            <p className="font-medium">{t.moveTitle}</p>
            <TimeField
              id={`move-${post.publicationId}`}
              market={post.market}
              picker={picker}
              error={
                move.fieldErrors?.scheduledAt?.[0] ??
                (move.error && !move.fieldErrors ? move.error.message : undefined)
              }
            />
            <div>
              <Button type="submit" size="sm" disabled={!picker.resolved || move.pending}>
                {move.pending ? t.working : t.move}
              </Button>
            </div>
          </form>
        ) : null}

        {canSchedule && cancellable ? (
          <form
            className="flex flex-col gap-3 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void cancel.run({ publicationId: post.publicationId, reason: reason.trim() });
            }}
          >
            {cancelling ? (
              <>
                <p className="text-sm text-muted-foreground">{t.cancelHint}</p>
                <FieldBlock
                  label={t.cancelReason}
                  htmlFor={`cancel-${post.publicationId}`}
                  error={
                    cancel.fieldErrors?.reason?.[0] ??
                    (cancel.error && !cancel.fieldErrors ? cancel.error.message : undefined)
                  }
                >
                  <Textarea
                    id={`cancel-${post.publicationId}`}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </FieldBlock>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    disabled={!reason.trim() || cancel.pending}
                  >
                    {cancel.pending ? t.working : t.cancelSubmit}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCancelling(false)}
                  >
                    {t.cancel}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelling(true)}
                >
                  {t.cancelTitle}
                </Button>
              </div>
            )}
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
