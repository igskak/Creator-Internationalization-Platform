import type { UtmSpec } from "@rc/db/json";

// UTM links of the commercial posts (plan 11 §11.7, M4-11): the landing URL of the offer with the
// five-field campaign tags, so a visit can be traced back to the exact post.

/** The variant's short id: the first eight characters of its uuid, for `utm_content`. */
export const shortVariantId = (variantId: string): string =>
  variantId.replaceAll("-", "").slice(0, 8);

/**
 * `landingUrl` with `utm_source=instagram&utm_medium=social&utm_campaign=…&utm_content=…`. A UTM
 * tag the URL already carries is replaced, every other query parameter and the fragment stay;
 * values are encoded by `URLSearchParams`. Returns null for anything but an http(s) URL.
 */
export function buildUtmUrl(landingUrl: string, utm: Omit<UtmSpec, "url">): string | null {
  let url: URL;
  try {
    url = new URL(landingUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_")) url.searchParams.delete(key);
  }
  url.searchParams.set("utm_source", utm.source);
  url.searchParams.set("utm_medium", utm.medium);
  url.searchParams.set("utm_campaign", utm.campaign);
  url.searchParams.set("utm_content", utm.content);
  return url.toString();
}

/** The `utm_json` of a variant: the tags, and the full URL when the offer has a landing page. */
export function buildUtm(input: {
  campaignId: string;
  variantId: string;
  landingUrl?: string | null | undefined;
}): UtmSpec {
  const tags = {
    source: "instagram",
    medium: "social",
    campaign: input.campaignId,
    content: shortVariantId(input.variantId),
  } as const;
  const url = input.landingUrl ? buildUtmUrl(input.landingUrl, tags) : null;
  return { ...tags, ...(url ? { url } : {}) };
}
