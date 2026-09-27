import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildNav, isActiveHref, SCREENS } from "./screens";

const appDir = fileURLToPath(new URL("../../app/(app)", import.meta.url));
const markets = [
  { code: "es-ES", displayName: "Spain", flagEmoji: "🇪🇸", isActive: true },
  { code: "en", displayName: "English", flagEmoji: "🌐", isActive: true },
  { code: "fr-FR", displayName: "France", flagEmoji: "🇫🇷", isActive: false },
];

describe("screen catalog", () => {
  it.each(Object.values(SCREENS).map((s) => [s.route]))("%s has a page", (route) => {
    expect(existsSync(`${appDir}${route}/page.tsx`)).toBe(true);
  });
});

describe("buildNav", () => {
  const nav = buildNav(markets);

  it("follows the sidebar of plan 10 §10.1", () => {
    expect(nav.map((s) => s.label)).toEqual([
      "Dashboard",
      "Content",
      "Knowledge",
      "Markets",
      "Analytics",
      "Experiments",
      "Settings",
    ]);
    expect(nav.find((s) => s.label === "Content")?.items.map((i) => i.href)).toEqual([
      "/content/ideas",
      "/content/drafts",
      "/content/calendar",
      "/content/published",
    ]);
  });

  it("lists markets from the database and disables inactive ones (France later)", () => {
    const items = nav.find((s) => s.label === "Markets")?.items ?? [];
    expect(items.map((i) => [i.icon, i.label, i.href, i.disabled ?? false])).toEqual([
      ["🇪🇸", "Spain", "/markets/es-ES", false],
      ["🌐", "English", "/markets/en", false],
      ["🇫🇷", "France", "/markets/fr-FR", true],
    ]);
  });

  it("marks P1 screens", () => {
    const knowledge = nav.find((s) => s.label === "Knowledge")?.items ?? [];
    expect(knowledge.find((i) => i.href === "/knowledge/posts")?.note).toBe("P1");
  });
});

describe("isActiveHref", () => {
  it("matches the page and its children only", () => {
    expect(isActiveHref("/content/ideas", "/content/ideas")).toBe(true);
    expect(isActiveHref("/content/ideas/42", "/content/ideas")).toBe(true);
    expect(isActiveHref("/content/ideasx", "/content/ideas")).toBe(false);
  });
});
