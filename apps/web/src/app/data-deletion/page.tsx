import { DELETION_CODE_PATTERN, getDeletionStatus } from "@rc/modules/instagram";
import { format } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { requestContext } from "@/server/context";

// The status page of a data deletion request (Meta's "data deletion request URL" answers with a
// link here). Public: the confirmation code is the only key, and the page says nothing but whether
// the request is known and when it was handled.
export const dynamic = "force-dynamic";

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, messages } = await getI18n();
  const t = messages.dataDeletion;
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const status = DELETION_CODE_PATTERN.test(code)
    ? await getDeletionStatus(await requestContext({ type: "SYSTEM" }), code)
    : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      {status ? (
        <>
          <p>{t.completed}</p>
          <p className="text-sm text-muted-foreground">
            {format(t.code, { code })} ·{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
              status.requestedAt,
            )}
          </p>
        </>
      ) : (
        <p role="alert">{t.unknown}</p>
      )}
    </main>
  );
}
