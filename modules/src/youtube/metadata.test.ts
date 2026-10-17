import type { ApprovedSnapshot } from "@rc/db/json";
import { describe, expect, it } from "vitest";
import {
  buildShortMetadata,
  cutAtWord,
  metadataProblems,
  namesSourceBrand,
  shortDescription,
  shortTags,
  shortTitle,
} from "./metadata";

// Synthetic captions only.
const caption = [
  "Hot water on bulgur? Only if it is fine.",
  "Coarse bulgur needs about twice its volume in water and ten minutes under a lid. Fine bulgur only needs soaking.\n\nSwipe for the full method, link in bio.",
  "Send this to whoever cooks the bulgur at home.",
].join("\n\n");

const snapshot = {
  hook: "Hot water on bulgur?",
  caption,
  cta: { type: "SHARE", text: "Send this to whoever cooks the bulgur at home." },
  hashtags: ["#bulgur", "grains", "#Bulgur", "#shorts"],
} as unknown as ApprovedSnapshot;

describe("Short metadata", () => {
  it("takes the title from the caption's first line", () => {
    expect(shortTitle(snapshot)).toBe("Hot water on bulgur? Only if it is fine.");
  });

  it("falls back to the hook, strips angle brackets and cuts at a word within 100 characters", () => {
    expect(shortTitle({ hook: "A <b>hook</b>", caption: "" })).toBe("A bhook/b");
    const long = `${"word ".repeat(40)}end`;
    const title = shortTitle({ hook: "x", caption: long });
    expect([...title].length).toBeLessThanOrEqual(100);
    expect(title.endsWith("…")).toBe(true);
    expect(cutAtWord("short", 100)).toBe("short");
  });

  it("drops the ask and the Instagram-only sentences, keeps the method, ends with the tags and #Shorts", () => {
    const description = shortDescription(snapshot);
    expect(description).toContain("Coarse bulgur needs about twice its volume");
    expect(description).toContain("Fine bulgur only needs soaking.");
    expect(description).not.toMatch(/swipe|link in bio|send this|instagram/i);
    expect(description.endsWith("#bulgur #grains #Shorts")).toBe(true);
  });

  it("keeps a market's AI note before the tags", () => {
    const description = shortDescription({
      ...snapshot,
      disclosure: { mode: "CAPTION_NOTE", captionNote: "Pictures made with AI." },
    });
    expect(description.indexOf("Pictures made with AI.")).toBeLessThan(
      description.indexOf("#Shorts"),
    );
  });

  it("makes tags without # or duplicates, within 500 characters", () => {
    expect(shortTags(["#bulgur", "grains", "Bulgur"])).toEqual(["bulgur", "grains"]);
    const many = Array.from({ length: 200 }, (_, i) => `tag${"x".repeat(10)}${i}`);
    expect(shortTags(many).join(",").length).toBeLessThanOrEqual(500);
  });

  it("builds metadata that is private-safe, not for kids, and declared synthetic", () => {
    const metadata = buildShortMetadata(snapshot, { language: "en", privacyStatus: "private" });
    expect(metadata).toMatchObject({
      categoryId: "26",
      defaultLanguage: "en",
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
    expect(metadataProblems(metadata)).toEqual([]);
  });

  it("refuses text that names the source brand, in any field", () => {
    const base = buildShortMetadata(snapshot, { language: "en", privacyStatus: "private" });
    for (const bad of [
      { ...base, title: "Reg.Chef bulgur" },
      { ...base, description: `${base.description}\n\nby REG CHEF` },
      { ...base, tags: ["regchef"] },
    ]) {
      expect(namesSourceBrand(bad)).toBe(true);
      expect(metadataProblems(bad).join(" ")).toContain("source brand");
    }
  });

  it("reports the limits of YouTube", () => {
    const base = buildShortMetadata(snapshot, { language: "en", privacyStatus: "private" });
    expect(metadataProblems({ ...base, title: "" })).toContain("The title is empty.");
    expect(
      metadataProblems({ ...base, description: `${"é".repeat(2600)} #Shorts` }).join(" "),
    ).toContain("bytes");
    expect(metadataProblems({ ...base, description: "no tag" }).join(" ")).toContain("#Shorts");
  });
});
