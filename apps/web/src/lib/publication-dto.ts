import type {
  PublicationDetails,
  PublicationSummary,
  VariantPublications,
} from "@rc/modules/publishing";

// Publication data as it crosses from the server to client components: dates become ISO strings.

type Iso<T, K extends keyof T> = Omit<T, K> & { [P in K]: string | null };

export type PublicationDto = Omit<
  PublicationDetails,
  "scheduledAt" | "publishedAt" | "createdAt" | "attempts"
> & {
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  attempts: (Omit<PublicationDetails["attempts"][number], "at"> & { at: string })[];
};

export type PublicationSummaryDto = Iso<PublicationSummary, "scheduledAt" | "publishedAt">;
export type VariantPublicationsDto = {
  current: PublicationSummaryDto | null;
  lastDryRun: PublicationSummaryDto | null;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toPublicationDto(d: PublicationDetails): PublicationDto {
  return {
    ...d,
    scheduledAt: iso(d.scheduledAt),
    publishedAt: iso(d.publishedAt),
    createdAt: d.createdAt.toISOString(),
    attempts: d.attempts.map((a) => ({ ...a, at: a.at.toISOString() })),
  };
}

const summaryDto = (s: PublicationSummary | null): PublicationSummaryDto | null =>
  s ? { ...s, scheduledAt: iso(s.scheduledAt), publishedAt: iso(s.publishedAt) } : null;

export function toVariantPublicationsDto(
  v: VariantPublications | undefined,
): VariantPublicationsDto {
  return { current: summaryDto(v?.current ?? null), lastDryRun: summaryDto(v?.lastDryRun ?? null) };
}
