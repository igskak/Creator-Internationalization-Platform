import { describe, expect, it } from "vitest";
import { AccountHealthSnapshot, ApprovedSnapshot, InstagramError } from "./review";

const snapshot = {
  hook: "Why fish dries out",
  hookType: "QUESTION",
  caption: "Caption",
  cta: { type: "COMMENT_KEYWORD", text: "Comment GUIDE", keyword: "GUIDE" },
  hashtags: ["#cooking"],
  slides: [
    {
      id: "s1",
      index: 0,
      role: "HOOK",
      templateId: "A",
      slots: { headline: "Hello" },
      images: {},
      knowledgeIds: [],
      factual: false,
    },
  ],
  visualStyle: "WARM",
  templateSequence: ["A"],
  renderId: "r1",
  renderedSlideKeys: ["renders/v/r1/0.jpg"],
  knowledge: [{ id: "k1", version: 2 }],
  generationVersion: "1.2.0",
};

describe("review JSON shapes", () => {
  it("accepts an approved snapshot with and without the commercial fields", () => {
    expect(ApprovedSnapshot.parse(snapshot)).toEqual(snapshot);
    const commercial = {
      ...snapshot,
      offerId: "o1",
      campaignId: "rc-es-261011-k3f9qa",
      utm: {
        source: "instagram",
        medium: "social",
        campaign: "rc-es-261011-k3f9qa",
        content: "ab",
      },
    };
    expect(ApprovedSnapshot.parse(commercial)).toEqual(commercial);
  });

  it("rejects a snapshot without a render or with a bad knowledge version", () => {
    const { renderId: _renderId, ...noRender } = snapshot;
    expect(ApprovedSnapshot.safeParse(noRender).success).toBe(false);
    expect(
      ApprovedSnapshot.safeParse({ ...snapshot, knowledge: [{ id: "k1", version: 0 }] }).success,
    ).toBe(false);
  });

  it("classifies an Instagram error and refuses an unknown class", () => {
    const error = { message: "Rate limit", httpStatus: 429, code: 4, classification: "RATE_LIMIT" };
    expect(InstagramError.parse(error)).toEqual(error);
    expect(InstagramError.safeParse({ message: "x", classification: "BAD" }).success).toBe(false);
  });

  it("accepts an account health snapshot", () => {
    expect(AccountHealthSnapshot.parse({ ok: true, quotaUsage: 3, quotaTotal: 100 })).toEqual({
      ok: true,
      quotaUsage: 3,
      quotaTotal: 100,
    });
  });
});
