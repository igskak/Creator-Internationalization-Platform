import { FIXTURE_OUTPUT, FIXTURE_PAGES } from "@rc/prompts/fixtures/knowledge-extractor";
import { describe, expect, it } from "vitest";
import { assessCard } from "./assess";
import { safetyReasons } from "./safety";
import {
  locateQuote,
  normalizeForMatch,
  statedNumbers,
  verifyNumbers,
  verifyQuote,
} from "./verify-quote";

const page = (pageNumber: number, text: string) => ({ pageNumber, text });
const cited = (pageStart: number, pageEnd = pageStart) => ({ pageStart, pageEnd });
const NBSP = " ";
const SHY = "­";

describe("normalizeForMatch", () => {
  it.each([
    ["case and ё", "ВСЁ Просто", "все просто"],
    ["quotes", "«Крышку» „не“ “поднимают”", '"крышку" "не" "поднимают"'],
    ["apostrophes", "l’eau d`eau", "l'eau d'eau"],
    ["dashes", "10–15 минут — и всё", "10-15 минут - и все"],
    ["soft hyphen inside a word", `кастрю${SHY}ля`, "кастрюля"],
    ["soft hyphen at a line end", `кастрю${SHY}\nля`, "кастрюля"],
    ["whitespace and NBSP", `а  б\n\tв${NBSP}г`, "а б в г"],
    ["NFKC (ligature, full width digits)", "ﬁsh １２", "fish 12"],
    ["zero-width characters", "ка​ша", "каша"],
  ])("%s", (_name, input, expected) => {
    expect(normalizeForMatch(input)).toBe(expected);
  });

  it("joins or keeps a hyphen at a line end by mode", () => {
    expect(normalizeForMatch("кас-\nтрюля", "join")).toBe("кастрюля");
    expect(normalizeForMatch("кас-\nтрюля", "keep")).toBe("кас-трюля");
    expect(normalizeForMatch("кас- \n трюля", "join")).toBe("кастрюля");
    expect(normalizeForMatch("a - b", "join")).toBe("a - b");
  });
});

describe("verifyQuote", () => {
  const p2 = page(
    2,
    "Гречку заливают горячей водой в соотношении 1:2 и варят под крышкой 15 минут на слабом огне.",
  );

  it.each([
    ["exact substring", p2, "варят под крышкой 15 минут", 1, true],
    [
      "case and ё/е",
      page(2, "Всё готово, когда ВСЁ впитало воду."),
      "все готово, когда все впитало воду",
      1,
      true,
    ],
    [
      "typographic quotes and dashes",
      page(2, "Он сказал: «варить — долго» и ушёл."),
      'он сказал: "варить - долго" и ушел',
      1,
      true,
    ],
    [
      "soft hyphen in the page",
      page(2, `Кастрю${SHY}ля стоит на огне.`),
      "Кастрюля стоит на огне",
      1,
      true,
    ],
    [
      "word hyphenated at a line end",
      page(2, "Эта кас-\nтрюля стоит на огне."),
      "Эта кастрюля стоит на огне",
      1,
      true,
    ],
    [
      "real hyphen at a line end",
      page(2, "Это что-\nто важное для вкуса."),
      "Это что-то важное для вкуса",
      1,
      true,
    ],
    [
      "line breaks inside the quote",
      page(2, "Пар доваривает\nкрупу, а каждое\nоткрывание его выпускает."),
      "Пар доваривает крупу, а каждое открывание его выпускает.",
      1,
      true,
    ],
    [
      "punctuation changed only",
      page(2, "Пар доваривает крупу, а каждое открывание его выпускает."),
      "Пар доваривает крупу а каждое открывание его выпускает",
      1,
      true,
    ],
    [
      "one word different in 12",
      page(2, "один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать"),
      "один два три четыре пять шесть ТРИДЦАТЬ восемь девять десять одиннадцать двенадцать",
      0.92,
      true,
    ],
    [
      "two words different in 12",
      page(2, "один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать"),
      "один два три четыре пять шесть ТРИДЦАТЬ восемь девять десять СОРОК двенадцать",
      0.83,
      false,
    ],
    [
      "not in the text at all",
      p2,
      "Рис промывают до прозрачной воды и сушат на полотенце",
      undefined,
      false,
    ],
  ])("%s", (_name, source, quote, score, verified) => {
    const result = verifyQuote(quote, [source], cited(2));
    expect(result.verified).toBe(verified);
    if (score !== undefined) expect(result.score).toBeCloseTo(score, 2);
    else expect(result.score).toBeLessThan(0.5);
  });

  it("searches the cited pages ± 1 and no further", () => {
    const pages = [
      page(1, "Первая страница."),
      page(2, "Вторая страница."),
      page(3, "Соль добавляют до кипения воды."),
      page(6, "Далёкая страница с важным текстом."),
    ];
    expect(verifyQuote("Соль добавляют до кипения воды", pages, cited(2)).verified).toBe(true);
    expect(verifyQuote("Соль добавляют до кипения воды", pages, cited(5)).verified).toBe(false);
    expect(verifyQuote("Далёкая страница с важным текстом", pages, cited(5)).verified).toBe(true);
    expect(verifyQuote("Первая страница", pages, cited(3, 3)).verified).toBe(false);
  });

  it("finds a quote that runs over a page boundary", () => {
    const pages = [page(2, "Варить под крышкой пятнадцать"), page(3, "минут на слабом огне")];
    expect(verifyQuote("пятнадцать минут на слабом огне", pages, cited(2, 3)).verified).toBe(true);
  });

  it("returns 0 for an empty quote or no pages", () => {
    expect(verifyQuote("  ", [p2], cited(2))).toEqual({ score: 0, verified: false });
    expect(verifyQuote("текст", [], cited(2))).toEqual({ score: 0, verified: false });
  });

  it("stays fast on three long pages with a quote that is not there", () => {
    // Deterministic pseudo-random vocabulary of 2,000 words, 800 words per page.
    let seed = 7;
    const word = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return `слово${seed % 2000}`;
    };
    const text = () => Array.from({ length: 800 }, word).join(" ");
    const quote = Array.from({ length: 40 }, word).join(" ");
    const started = Date.now();
    const result = verifyQuote(
      quote,
      [page(1, text()), page(2, text()), page(3, text())],
      cited(2),
    );
    expect(result.verified).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("statedNumbers and verifyNumbers", () => {
  it("reads digits, decimals with a comma, signs, ranges, ratios and number words", () => {
    const found = statedNumbers(
      "+4 °C, 0,5 л, 10–15 минут, 1:2, два часа, dos horas, one hour, трёх",
    );
    for (const n of [4, 0.5, 10, 15, 1, 2, 3]) expect(found.has(n)).toBe(true);
    expect(found.has(5)).toBe(false);
    expect(statedNumbers("2023 год").has(2023)).toBe(true);
    expect(statedNumbers("2023 год").has(23)).toBe(false);
  });

  const pages = [
    page(2, "Варить 15 минут, затем ещё 10–12 минут. Температура воды 90 °C."),
    page(3, "Хранить при +4 °C не дольше суток. Прогреть до 74 °C."),
  ];
  const card = (
    temperatures: { value: number }[],
    timings: { value: number; valueMax?: number; unit: string }[],
  ) => ({ temperatures, timings });

  it.each([
    [
      "all stated",
      card(
        [{ value: 90 }],
        [
          { value: 15, unit: "min" },
          { value: 10, valueMax: 12, unit: "min" },
        ],
      ),
      cited(2),
      [],
    ],
    ["missing timing", card([], [{ value: 20, unit: "min" }]), cited(2), ["20"]],
    ["missing valueMax", card([], [{ value: 10, valueMax: 20, unit: "min" }]), cited(2), ["20"]],
    ["number only on another page", card([{ value: 74 }], []), cited(2), ["74"]],
    ["number on the cited second page", card([{ value: 74 }, { value: 4 }], []), cited(2, 3), []],
    ["implicit one from a singular unit", card([], [{ value: 1, unit: "d" }]), cited(3), []],
    ["one without the unit word", card([], [{ value: 1, unit: "h" }]), cited(3), ["1"]],
    ["duplicates reported once", card([{ value: 99 }, { value: 99 }], []), cited(2), ["99"]],
    ["nothing structured", card([], []), cited(2), []],
  ])("%s", (_name, c, range, missing) => {
    expect(verifyNumbers(c, pages, range).missing).toEqual(missing);
  });
});

describe("safetyReasons", () => {
  it.each([
    "Нельзя есть сырое мясо без обработки",
    "Курица должна быть не недожаренной: недожар опасен",
    "Подавать стейк с кровью",
    "Проверьте температуру внутри куска термометром",
    "Консервирование овощей требует стерилизации банок",
    "Риск ботулизма при неправильной закатке",
    "Содержит аллергены: глютен",
    "Добавьте коньяк и поджигайте спиртом",
    "Nunca sirvas huevos crudos a niños",
    "Peligro de botulismo en conservas caseras",
    "La temperatura interna debe llegar a 74 °C",
    "Contiene alérgenos como el gluten",
    "Never serve undercooked chicken",
    "Cook raw eggs until set; internal temperature matters",
    "Home canning needs a tested recipe because of botulism",
    "Salmonella grows on warm food",
  ])("flags: %s", (text) => {
    expect(safetyReasons(text).length).toBeGreaterThan(0);
  });

  it.each([
    "Гречку заливают горячей водой в соотношении 1:2",
    "Соль добавляют в воду до того, как она закипела",
    "Mezcla las nueces con las pasas",
    "Add salt and pepper to taste, then rest for ten minutes",
    "Рис промывают несколько раз",
  ])("does not flag: %s", (text) => {
    expect(safetyReasons(text)).toEqual([]);
  });
});

describe("assessCard", () => {
  const pages = FIXTURE_PAGES.map((p) => page(p.number, p.text));
  const [buckwheat, rice] = FIXTURE_OUTPUT.cards as [
    (typeof FIXTURE_OUTPUT.cards)[number],
    (typeof FIXTURE_OUTPUT.cards)[number],
  ];

  it("passes a faithful card without flags and keeps the model's safety flag", () => {
    expect(assessCard(buckwheat, pages)).toEqual({
      quoteVerified: true,
      matchScore: 1,
      flags: [],
      notes: [],
      safetySensitive: false,
      safetyNotes: null,
    });
    expect(assessCard(rice, pages)).toMatchObject({
      quoteVerified: true,
      flags: ["SAFETY_SENSITIVE"],
      safetySensitive: true,
      safetyNotes: "Хранение готового риса и рост бактерий.",
    });
  });

  it("flags an invented quote, explains why, and adds low confidence for missing numbers and low scores", () => {
    const result = assessCard(
      {
        ...buckwheat,
        sourceQuote: "Гречку нужно варить ровно пять минут, иначе она испортится навсегда.",
        timings: [{ value: 45, unit: "min", context: "x" }],
        confidence: 0.59,
      },
      pages,
    );
    expect(result.quoteVerified).toBe(false);
    expect(result.flags).toEqual(["QUOTE_UNVERIFIED", "LOW_CONFIDENCE"]);
    expect(result.notes.join(" | ")).toMatch(
      /quote not found.*\| number not found in source: 45 \| model confidence 0\.59/,
    );
  });

  it("does not flag confidence of exactly 0.6", () => {
    expect(assessCard({ ...buckwheat, confidence: 0.6 }, pages).flags).toEqual([]);
  });

  it("treats a core temperature as safety-sensitive even when the model did not", () => {
    const result = assessCard(
      { ...buckwheat, temperatures: [{ value: 74, unit: "C", target: "CORE", context: "x" }] },
      pages,
    );
    expect(result).toMatchObject({
      safetySensitive: true,
      safetyNotes: "Keyword rule: core temperature",
    });
    expect(result.flags).toContain("SAFETY_SENSITIVE");
    expect(result.flags).toContain("LOW_CONFIDENCE"); // 74 is not on page 2
  });
});

describe("locateQuote", () => {
  const slice = (text: string, quote: string) => {
    const range = locateQuote(text, quote);
    return range ? text.slice(range.start, range.end) : null;
  };

  it.each([
    [
      "exact",
      "Гречку варят 15 минут. Крышку не поднимают.",
      "Крышку не поднимают",
      "Крышку не поднимают",
    ],
    ["case and ё", "Всё готово, когда ВСЁ впитало воду.", "все готово", "Всё готово"],
    [
      "line breaks and spaces",
      "Пар доваривает\n  крупу, а каждое открывание его выпускает.",
      "доваривает крупу, а каждое",
      "доваривает\n  крупу, а каждое",
    ],
    [
      "quotes and dashes",
      "Он сказал: «варить — долго» и ушёл.",
      '"варить - долго"',
      "«варить — долго»",
    ],
    [
      "soft hyphen inside a word",
      `Кастрю${SHY}ля стоит на огне.`,
      "кастрюля стоит",
      `Кастрю${SHY}ля стоит`,
    ],
    ["NBSP", `Варить${NBSP}15${NBSP}минут.`, "варить 15 минут", `Варить${NBSP}15${NBSP}минут`],
  ])(
    "finds a quote that differs only in %s, and the range slices the original text",
    (_n, text, quote, expected) => {
      expect(slice(text, quote)).toBe(expected);
    },
  );

  it("returns null for a quote that is absent, empty, or only a near match", () => {
    expect(locateQuote("Гречку варят 15 минут.", "Рис промывают")).toBeNull();
    expect(locateQuote("Гречку варят 15 минут.", "  ")).toBeNull();
    expect(locateQuote("Гречку варят 15 минут.", "Гречку варят 20 минут")).toBeNull();
    expect(locateQuote("", "текст")).toBeNull();
  });

  it("locates the first occurrence and a quote at the very start or end", () => {
    expect(slice("ab ab", "ab")).toBe("ab");
    expect(locateQuote("ab ab", "ab")).toEqual({ start: 0, end: 2 });
    expect(slice("начало и конец", "конец")).toBe("конец");
    expect(slice("   отступ в начале", "отступ в начале")).toBe("отступ в начале");
  });
});
