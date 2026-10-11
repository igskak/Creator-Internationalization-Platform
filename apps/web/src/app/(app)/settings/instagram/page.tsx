import { getInstagramOverview } from "@rc/modules/instagram";
import { getPublishingStatus } from "@rc/modules/publishing";
import { InstagramMarketCard } from "@/components/instagram/market-card";
import { PublishingSwitch } from "@/components/instagram/publishing-switch";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { requestContext } from "@/server/context";

// /settings/instagram (plan 10 §10.2, M5-03): one card per market with the account, the token's
// state, the publishing quota, the last post and the last problem. Connecting is a redirect to
// Instagram (/api/instagram/oauth/start); the result comes back here as ?connected= or ?error=.
export const dynamic = "force-dynamic";

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const ctx = await requestContext({ type: "USER", userId: user.id, role: user.role });
  const { messages } = await getI18n();
  const t = messages.instagram;
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const connected = first(params.connected);
  const error = first(params.error);

  const [overview, publishing] = await Promise.all([
    getInstagramOverview(ctx),
    getPublishingStatus(ctx),
  ]);
  const isOwner = user.role === "owner";

  return (
    <main className="flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <p className="text-muted-foreground">{t.subtitle}</p>
        <p className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t.mode.label}:</span>
          <Badge variant={overview.publishMode === "live" ? "default" : "secondary"}>
            {t.mode[overview.publishMode]}
          </Badge>
        </p>
      </header>

      {connected && (
        <div role="status" className="rounded-md bg-green-50 p-3 text-sm dark:bg-green-950/40">
          {format(t.results.connected, { username: connected })}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-950 dark:bg-red-950/40 dark:text-red-100"
        >
          {(t.errors as Record<string, string>)[error] ?? t.errors.exchange_failed}
        </div>
      )}
      {!overview.configured && (
        <p role="note" className="rounded-md bg-muted p-3 text-sm">
          {t.notConfigured}
        </p>
      )}
      {!isOwner && <p className="text-sm text-muted-foreground">{t.ownersOnly}</p>}

      <PublishingSwitch
        enabled={publishing.enabled}
        mode={publishing.mode}
        allowlist={publishing.allowlist}
        isOwner={isOwner}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {overview.markets.map((row) => (
          <InstagramMarketCard
            key={row.market.id}
            canManage={isOwner}
            canConnect={overview.configured}
            data={{
              marketId: row.market.id,
              marketName: row.market.displayName,
              marketCode: row.market.code,
              flagEmoji: row.market.flagEmoji,
              health: row.health,
              account: row.account
                ? {
                    id: row.account.id,
                    username: row.account.username,
                    accountType: row.account.accountType,
                    connectedAt: row.account.connectedAt.toISOString(),
                  }
                : null,
              daysLeft: row.daysLeft,
              lastPublish: row.lastPublish
                ? {
                    publishedAt: row.lastPublish.publishedAt.toISOString(),
                    permalink: row.lastPublish.permalink,
                  }
                : null,
              lastError: row.lastError
                ? {
                    code: row.lastError.code,
                    message: row.lastError.message,
                    occurredAt: row.lastError.occurredAt?.toISOString() ?? null,
                  }
                : null,
              quota: row.quota,
            }}
          />
        ))}
      </div>
    </main>
  );
}
