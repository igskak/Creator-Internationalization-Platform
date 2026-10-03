import { describe, expect, it } from "vitest";
import { en } from "./en";
import { format, formatNumber, plural } from "./format";
import { DEFAULT_LOCALE, isLocale, LOCALE_NAMES, LOCALES } from "./locales";
import { ru } from "./ru";

type Tree = { [key: string]: string | Tree };
/** Messages by path; a plural message (an object with `other`) is one entry, valued by its `other` form. */
const leaves = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : typeof value.other === "string"
        ? [[`${prefix}${key}`, value.other] as [string, string]]
        : leaves(value, `${prefix}${key}.`),
  );
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

describe("locales", () => {
  it("supports English by default and Russian", () => {
    expect(LOCALES).toEqual(["en", "ru"]);
    expect(DEFAULT_LOCALE).toBe("en");
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(LOCALE_NAMES).toEqual({ en: "English", ru: "Русский" });
  });
});

describe("message catalogs", () => {
  const enLeaves = leaves(en as unknown as Tree);
  const ruLeaves = new Map(leaves(ru as unknown as Tree));

  it("the Russian catalog has the same keys as the English one", () => {
    expect([...ruLeaves.keys()].sort()).toEqual(enLeaves.map(([key]) => key).sort());
  });

  it("every message is filled in and keeps the same placeholders in both languages", () => {
    for (const [key, text] of enLeaves) {
      const russian = ruLeaves.get(key) ?? "";
      expect(text.trim(), `en ${key}`).not.toBe("");
      expect(russian.trim(), `ru ${key}`).not.toBe("");
      // Plural forms may leave {count} out of a form that cannot be about a number ("one"),
      // so compare the placeholders other than count.
      const other = (s: string) => placeholders(s).filter((p) => p !== "count");
      expect(other(russian), key).toEqual(other(text));
    }
  });

  it("the Russian plural messages have the forms the language needs", () => {
    const forms = (obj: object) => Object.keys(obj).sort();
    expect(forms(ru.cards.bulk.selected)).toEqual(["few", "many", "one", "other"]);
    expect(forms(ru.cards.archiveDialog.title)).toEqual(["few", "many", "one", "other"]);
    expect(forms(ru.cards.result.skipped)).toEqual(["few", "many", "one", "other"]);
    expect(forms(en.cards.bulk.selected)).toEqual(["one", "other"]);
  });

  it("names every status tab, flag and archive reason in both languages", () => {
    for (const catalog of [en, ru]) {
      expect(Object.keys(catalog.cards.tabs).sort()).toEqual([
        "ARCHIVED",
        "CHEF_APPROVED",
        "EXTRACTED",
        "NEEDS_REVIEW",
        "all",
      ]);
      expect(Object.keys(catalog.cards.flags).sort()).toEqual([
        "DUPLICATE_SUSPECTED",
        "LOW_CONFIDENCE",
        "QUOTE_UNVERIFIED",
        "SAFETY_SENSITIVE",
      ]);
      expect(Object.keys(catalog.cards.archiveDialog.reasons).sort()).toEqual([
        "DUPLICATE",
        "INACCURATE",
        "OTHER",
        "OUT_OF_SCOPE",
      ]);
      expect(Object.keys(catalog.cards.result.reasons).sort()).toEqual([
        "HAS_FLAGS",
        "INVALID_STATE",
        "MISSING_FIELDS",
        "NOT_FOUND",
        "QUOTE_UNVERIFIED",
      ]);
    }
  });
});

describe("format and plural", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(format("{a} and {b}", { a: 1, b: "x" })).toBe("1 and x");
    expect(format("{missing}")).toBe("{missing}");
  });

  it("picks Russian plural forms: 1 карточка, 2 карточки, 5 карточек, 11 карточек, 21 карточка", () => {
    const text = (n: number) => plural("ru", ru.cards.bulk.selected, n);
    expect(text(1)).toBe("Выбрана 1 карточка");
    expect(text(2)).toBe("Выбрано 2 карточки");
    expect(text(5)).toBe("Выбрано 5 карточек");
    expect(text(11)).toBe("Выбрано 11 карточек");
    expect(text(21)).toBe("Выбрана 21 карточка");
    expect(text(22)).toBe("Выбрано 22 карточки");
    expect(text(100)).toBe("Выбрано 100 карточек");
  });

  it("picks English forms and passes extra values", () => {
    expect(plural("en", en.cards.bulk.selected, 1)).toBe("1 card selected");
    expect(plural("en", en.cards.bulk.selected, 3)).toBe("3 cards selected");
    expect(
      plural("en", { one: "{count} of {total}", other: "{count} of {total}" }, 2, { total: 9 }),
    ).toBe("2 of 9");
  });

  it("formats numbers for the language", () => {
    expect(formatNumber("en", 0.95, 2)).toBe("0.95");
    expect(formatNumber("ru", 0.95, 2)).toBe("0,95");
    expect(formatNumber("en", 81)).toBe("81");
  });
});
