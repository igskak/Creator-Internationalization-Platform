"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { format, plural } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { disconnectInstagramAccount } from "@/server/actions/instagram";

export type AccountHealth = "NOT_CONNECTED" | "OK" | "EXPIRING" | "NEEDS_REAUTH" | "DISCONNECTED";

/** What the card shows, with dates as ISO strings (it crosses from the server component). */
export type InstagramCardData = {
  marketId: string;
  marketName: string;
  marketCode: string;
  flagEmoji: string | null;
  health: AccountHealth;
  account: {
    id: string;
    username: string;
    accountType: string | null;
    connectedAt: string;
  } | null;
  daysLeft: number | null;
  lastPublish: { publishedAt: string; permalink: string | null } | null;
  lastError: { code: string; message: string; occurredAt: string | null } | null;
  quota: { used: number; total: number } | null;
};

const HEALTH_STYLE: Record<AccountHealth, string> = {
  NOT_CONNECTED: "bg-muted text-muted-foreground",
  OK: "bg-green-200 text-green-950 dark:bg-green-950 dark:text-green-200",
  EXPIRING: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200",
  NEEDS_REAUTH: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  DISCONNECTED: "bg-muted text-muted-foreground",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function InstagramMarketCard({
  data,
  canManage,
  canConnect,
}: {
  data: InstagramCardData;
  /** The person is an owner. */
  canManage: boolean;
  /** The environment has a Meta app. */
  canConnect: boolean;
}) {
  const { locale, messages } = useI18n();
  const t = messages.instagram;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const disconnect = useAction(disconnectInstagramAccount, {
    successMessage: t.results.disconnected,
    onSuccess: () => {
      setConfirming(false);
      router.refresh();
    },
  });

  const { account } = data;
  const connected = data.health !== "NOT_CONNECTED" && data.health !== "DISCONNECTED";
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );
  const token =
    data.daysLeft === null
      ? t.tokenUnknown
      : data.daysLeft < 0
        ? t.tokenExpired
        : plural(locale, t.tokenDays, data.daysLeft);
  const connectHref = `/api/instagram/oauth/start?marketId=${encodeURIComponent(data.marketId)}`;

  return (
    <section
      aria-label={data.marketName}
      className="flex flex-col gap-4 rounded-lg border p-4"
      data-testid={`instagram-card-${data.marketCode}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden>{data.flagEmoji}</span>
          {data.marketName}
        </h2>
        <Badge className={cn("border-0", HEALTH_STYLE[data.health])}>{t.health[data.health]}</Badge>
      </header>

      {account && connected ? (
        <dl className="flex flex-col gap-2">
          <Row label={t.fields.account}>@{account.username}</Row>
          {account.accountType && <Row label={t.fields.type}>{account.accountType}</Row>}
          <Row label={t.fields.token}>
            <span className={cn(data.health === "NEEDS_REAUTH" && "text-destructive")}>
              {token}
            </span>
          </Row>
          <Row label={t.fields.quota}>
            {data.quota
              ? format(t.quota, { used: data.quota.used, total: data.quota.total })
              : t.quotaUnknown}
          </Row>
          <Row label={t.fields.lastPublish}>
            {data.lastPublish ? (
              <>
                {date(data.lastPublish.publishedAt)}
                {data.lastPublish.permalink && (
                  <a
                    href={data.lastPublish.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 underline underline-offset-4"
                  >
                    {t.viewPost}
                  </a>
                )}
              </>
            ) : (
              t.never
            )}
          </Row>
          <Row label={t.fields.lastError}>
            {data.lastError ? (
              <span className="text-destructive">
                {data.lastError.message}
                {data.lastError.occurredAt && (
                  <span className="ml-2 text-muted-foreground">
                    {date(data.lastError.occurredAt)}
                  </span>
                )}
              </span>
            ) : (
              t.noProblem
            )}
          </Row>
          <Row label={t.fields.connectedAt}>{date(account.connectedAt)}</Row>
        </dl>
      ) : null}

      {canManage && canConnect && (
        <div className="flex flex-wrap gap-2">
          {(!connected || data.health === "NEEDS_REAUTH" || data.health === "EXPIRING") && (
            // A full navigation: the route answers with a redirect to Instagram.
            <a href={connectHref} className={buttonVariants({ variant: "default" })}>
              {connected ? t.actions.reconnect : t.actions.connect}
            </a>
          )}
          {account && connected && (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              {t.actions.disconnect}
            </Button>
          )}
        </div>
      )}

      {account && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {format(t.disconnectDialog.title, { username: account.username })}
              </DialogTitle>
              <DialogDescription>{t.disconnectDialog.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {t.disconnectDialog.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={disconnect.pending}
                onClick={() => void disconnect.run({ socialAccountId: account.id })}
              >
                {t.disconnectDialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
