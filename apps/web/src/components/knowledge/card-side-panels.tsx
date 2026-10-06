import type { CardDetail } from "@rc/modules/knowledge";
import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";

/** Every approval is a version; the newest is first. */
export function VersionHistory({
  versions,
  locale,
  t,
}: {
  versions: CardDetail["versions"];
  locale: Locale;
  t: Messages["card"];
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section aria-labelledby="versions-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 id="versions-title" className="text-base font-medium">
        {t.versions.title}
      </h2>
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.versions.none}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {versions.map((v) => (
            <li key={v.version} className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{format(t.version, { version: v.version })}</Badge>
                <span className="text-xs text-muted-foreground">
                  {format(t.versions.by, {
                    who: v.changedBy ?? t.versions.system,
                    date: date.format(v.createdAt),
                  })}
                </span>
              </div>
              {v.changeNote ? (
                <p className="text-xs text-muted-foreground">{v.changeNote}</p>
              ) : null}
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t.versions.showText}
                </summary>
                <p className="mt-1 font-medium">{v.title}</p>
                <p className="text-muted-foreground">{v.claim}</p>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Ideas that use the card (empty until ideas exist). */
export function UsedByIdeas({
  ideas,
  t,
}: {
  ideas: CardDetail["usedByIdeas"];
  t: Messages["card"];
}) {
  return (
    <section aria-labelledby="used-title" className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 id="used-title" className="text-base font-medium">
        {t.usedBy.title}
      </h2>
      {ideas.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.usedBy.none}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {ideas.map((idea) => (
            <li key={idea.id}>{idea.topic}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
