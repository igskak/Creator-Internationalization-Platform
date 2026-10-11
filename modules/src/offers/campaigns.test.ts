import { describe, expect, it } from "vitest";
import { CAMPAIGN_ID, campaignDate, campaignMarket, createCampaignId } from "./campaigns";
import { buildUtm, buildUtmUrl, shortVariantId } from "./utm";

describe("campaign ids", () => {
  it("has the shape rc-{market}-{yymmdd}-{6 chars}", () => {
    const id = createCampaignId("es-ES", new Date("2026-10-11T23:59:00Z"));
    expect(id).toMatch(CAMPAIGN_ID);
    expect(id).toMatch(/^rc-es-261011-[a-z0-9]{6}$/);
  });

  it("uses the language part of the market, the UTC date and the random source it is given", () => {
    expect(campaignMarket("es-ES")).toBe("es");
    expect(campaignMarket("en")).toBe("en");
    expect(campaignMarket("FR-fr")).toBe("fr");
    expect(campaignDate(new Date("2027-01-02T00:00:00Z"))).toBe("270102");
    expect(campaignDate(new Date("2026-12-31T23:59:59Z"))).toBe("261231");
    let n = 0;
    expect(createCampaignId("en", new Date("2026-10-11T00:00:00Z"), () => n++)).toBe(
      "rc-en-261011-abcdef",
    );
  });

  it("does not repeat in practice", () => {
    const date = new Date("2026-10-11T00:00:00Z");
    const ids = new Set(Array.from({ length: 2000 }, () => createCampaignId("es-ES", date)));
    expect(ids.size).toBe(2000);
  });
});

describe("UTM links", () => {
  const tags = {
    source: "instagram",
    medium: "social",
    campaign: "rc-es-261011-k3f9qa",
    content: "ab12cd34",
  } as const;

  it("adds the four tags to a plain landing URL", () => {
    expect(buildUtmUrl("https://example.test/guide", tags)).toBe(
      "https://example.test/guide?utm_source=instagram&utm_medium=social&utm_campaign=rc-es-261011-k3f9qa&utm_content=ab12cd34",
    );
  });

  it("keeps other parameters and the fragment, replaces old UTM tags and encodes values", () => {
    const url = new URL(
      buildUtmUrl("https://example.test/p?ref=a%20b&utm_source=old&utm_term=x#top", {
        ...tags,
        campaign: "a b&c",
      }) as string,
    );
    expect(url.searchParams.get("ref")).toBe("a b");
    expect(url.searchParams.get("utm_source")).toBe("instagram");
    expect(url.searchParams.has("utm_term")).toBe(false);
    expect(url.searchParams.get("utm_campaign")).toBe("a b&c");
    expect(url.hash).toBe("#top");
    expect(url.toString()).toContain("utm_campaign=a+b%26c");
  });

  it("refuses what is not an http(s) URL", () => {
    for (const bad of ["", "not a url", "javascript:alert(1)", "ftp://example.test/x"]) {
      expect(buildUtmUrl(bad, tags)).toBeNull();
    }
    expect(buildUtmUrl("http://example.test/x", tags)).toMatch(/^http:/);
  });

  it("builds the utm_json: the tags always, the URL when there is a landing page", () => {
    const variantId = "0f3a9c21-7b64-4d0e-9a55-123456789abc";
    expect(shortVariantId(variantId)).toBe("0f3a9c21");
    expect(buildUtm({ campaignId: "rc-es-261011-k3f9qa", variantId })).toEqual({
      source: "instagram",
      medium: "social",
      campaign: "rc-es-261011-k3f9qa",
      content: "0f3a9c21",
    });
    const withUrl = buildUtm({
      campaignId: "rc-es-261011-k3f9qa",
      variantId,
      landingUrl: "https://example.test/guide",
    });
    expect(withUrl.url).toBe(
      "https://example.test/guide?utm_source=instagram&utm_medium=social&utm_campaign=rc-es-261011-k3f9qa&utm_content=0f3a9c21",
    );
    expect(buildUtm({ campaignId: "x", variantId, landingUrl: "nope" }).url).toBeUndefined();
  });
});
