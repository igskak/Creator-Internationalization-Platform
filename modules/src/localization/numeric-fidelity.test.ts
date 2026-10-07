import { describe, expect, it } from "vitest";
import {
  checkNumericFidelity,
  extractNumbers,
  findNumericMismatches,
  type NumericReference,
  parseAmount,
} from "./numeric-fidelity";

const reference: NumericReference = {
  temperatures: [
    { value: 180, unit: "C" },
    { value: 74, unit: "C" },
  ],
  timings: [
    { value: 10, valueMax: 15, unit: "min" },
    { value: 1.5, unit: "h" },
  ],
  ingredients: [
    { quantity: 250, unit: "г" },
    { quantity: 0.5, unit: "кг" },
    { quantity: 500, unit: "мл" },
    { quantity: 20, unit: "см" },
  ],
  texts: ["Соль — 2% от массы рыбы, вода 1,5 л."],
};

const mismatches = (text: string, locale: "en" | "es-ES" = "en") =>
  findNumericMismatches(text, reference, { locale }).map((n) => n.raw);

describe("parseAmount", () => {
  it.each([
    ["1,5", "es-ES", 1.5],
    ["1,5", "ru", 1.5],
    ["1.5", "en", 1.5],
    ["1.500", "es-ES", 1500],
    ["1,500", "en", 1500],
    ["1.500,25", "es-ES", 1500.25],
    ["1,500.25", "en", 1500.25],
    ["1.5", "es-ES", 1.5],
    ["½", "en", 0.5],
    ["1½", "en", 1.5],
    ["1/2", "en", 0.5],
    ["1 1/2", "en", 1.5],
    ["10", "en", 10],
  ] as const)("%s (%s) → %s", (token, locale, expected) => {
    expect(parseAmount(token, locale)).toBeCloseTo(expected, 6);
  });

  it("returns undefined for a zero denominator", () => {
    expect(parseAmount("1/0", "en")).toBeUndefined();
  });
});

describe("extractNumbers", () => {
  const units = (text: string, locale: "en" | "es-ES" | "ru" = "en") =>
    extractNumbers(text, locale).map((n) => [n.value, n.valueMax, n.unit]);

  it("reads temperatures in all spellings", () => {
    expect(units("Bake at 180 °C, then 355°F, or 180ºC, 180 grados, 350 degrees F, 180º")).toEqual([
      [180, undefined, "C"],
      [355, undefined, "F"],
      [180, undefined, "C"],
      [180, undefined, "deg"],
      [350, undefined, "F"],
      [180, undefined, "deg"],
    ]);
  });

  it("reads masses, volumes, lengths, times and percent in es, en and ru words", () => {
    expect(
      units(
        "250 g, 1 kg, 2 lbs, 8 oz, 500 ml, 1 l, 3.5 fl oz, 2 cups, 20 cm, 8 inches, 15 min, 2 hours, 30 sec, 2%",
      ),
    ).toEqual([
      [250, undefined, "g"],
      [1, undefined, "kg"],
      [2, undefined, "lb"],
      [8, undefined, "oz"],
      [500, undefined, "ml"],
      [1, undefined, "l"],
      [3.5, undefined, "floz"],
      [2, undefined, "cup"],
      [20, undefined, "cm"],
      [8, undefined, "in"],
      [15, undefined, "min"],
      [2, undefined, "h"],
      [30, undefined, "s"],
      [2, undefined, "%"],
    ]);
    expect(
      units("250 gramos, 2 litros, 15 minutos, 2 horas, 3 tazas, 5 por ciento", "es-ES").map(
        (u) => u[2],
      ),
    ).toEqual(["g", "l", "min", "h", "cup", "%"]);
    expect(units("200 г, 1,5 кг, 500 мл, 15 мин, 2 часа", "ru")).toEqual([
      [200, undefined, "g"],
      [1.5, undefined, "kg"],
      [500, undefined, "ml"],
      [15, undefined, "min"],
      [2, undefined, "h"],
    ]);
  });

  it("reads ranges with a dash, 'a' or 'to'", () => {
    expect(
      units("10-15 min, 10–15 minutos, 10 a 15 minutos, 10 to 15 minutes, 180–200 °C"),
    ).toEqual([
      [10, 15, "min"],
      [10, 15, "min"],
      [10, 15, "min"],
      [10, 15, "min"],
      [180, 200, "C"],
    ]);
  });

  it("uses the locale for separators", () => {
    expect(units("1,5 kg", "es-ES")).toEqual([[1.5, undefined, "kg"]]);
    expect(units("1.500 g", "es-ES")).toEqual([[1500, undefined, "g"]]);
    expect(units("1,500 g")).toEqual([[1500, undefined, "g"]]);
    expect(units("1.5 kg")).toEqual([[1.5, undefined, "kg"]]);
  });

  it("reads fractions", () => {
    expect(units("½ cup, 1½ cups, 1/2 cup, 1 1/2 lb")).toEqual([
      [0.5, undefined, "cup"],
      [1.5, undefined, "cup"],
      [0.5, undefined, "cup"],
      [1.5, undefined, "lb"],
    ]);
  });

  it("merges hours and minutes into one duration", () => {
    expect(units("Rest 1 h 30 min. Or 2 hours and 15 minutes. Or 1 hora y 20 minutos.")).toEqual([
      [90, undefined, "min"],
      [135, undefined, "min"],
      [80, undefined, "min"],
    ]);
    // Not adjacent: stay separate.
    expect(units("Chill 1 h, then bake 20 min")).toEqual([
      [1, undefined, "h"],
      [20, undefined, "min"],
    ]);
  });

  it("ignores numbers without a unit and words that only start like one", () => {
    expect(
      units("3 mistakes, 5 slides, 10 tips, 2 gallons, 7 minutes' walk is not a unit word"),
    ).toEqual([[7, undefined, "min"]]);
    expect(units("Step 3. Mix 12 grapes, 4 hamburgers")).toEqual([]);
    expect(units("1 in 5 people")).toEqual([]);
  });

  it("records the matched text and position", () => {
    const [n] = extractNumbers("Hornea 10–15 minutos", "es-ES");
    expect(n).toMatchObject({ raw: "10–15 minutos", index: 7 });
  });
});

describe("findNumericMismatches: temperatures (±2 °C, ±5 °F)", () => {
  it.each([
    ["180 °C", true],
    ["182 °C", true],
    ["178 °C", true],
    ["182.5 °C", false],
    ["177 °C", false],
    ["355 °F", true], // 180 °C = 356 °F
    ["361 °F", true], // exactly 5 °F away: the limit is inclusive
    ["362 °F", false],
    ["345 °F", false],
    ["165 °F", true], // 74 °C = 165.2 °F
    ["170 °F", true],
    ["172 °F", false],
    ["74 °C", true],
    ["180º", true],
    ["356º", true],
    ["200 °C", false],
  ] as const)("%s → %s", (text, ok) => {
    expect(mismatches(text).length === 0).toBe(ok);
  });

  it("350 °F is a mismatch for a 180 °C card (6 °F away)", () => {
    expect(mismatches("350 °F")).toEqual(["350 °F"]);
  });

  it("accepts the rounded oven conversion", () => {
    expect(mismatches("355 °F (180 °C)")).toEqual([]);
  });

  it("checks both ends of a range", () => {
    expect(mismatches("180–182 °C")).toEqual([]);
    expect(mismatches("180–200 °C")).toEqual(["180–200 °C"]);
  });
});

describe("findNumericMismatches: times (exact or within the card range)", () => {
  it.each([
    ["10 min", true],
    ["12 min", true],
    ["15 min", true],
    ["10-15 min", true],
    ["9 min", false],
    ["16 min", false],
    ["8-12 min", false],
    ["1.5 h", true],
    ["90 minutes", true],
    ["1 h 30 min", true],
    ["1 hora y 30 minutos", true],
    ["2 h", false],
    ["1 h", false],
    ["0.25 h", true], // 15 min, the end of the range
    ["0.1 h", false],
    ["600 s", true], // 10 min
    ["30 s", false],
  ] as const)("%s → %s", (text, ok) => {
    expect(mismatches(text).length === 0).toBe(ok);
  });
});

describe("findNumericMismatches: masses, volumes, lengths, percent", () => {
  it.each([
    ["250 g", true],
    ["250,0 g", true],
    ["500 g", true], // 0.5 kg
    ["0.5 kg", true],
    ["0,5 kg", true],
    ["260 g", false],
    ["8.75 oz", true], // 248 g
    ["9 oz", false], // 255 g: the table says 8.75 oz
    ["10 oz", false],
    ["1.1 lb", true], // 499 g
    ["1.2 lb", false], // 544 g
    ["500 ml", true],
    ["1 cup", false], // 240 ml vs 500 ml
    ["2 cups", true], // 480 ml, within 6 %
    ["17 fl oz", true], // 503 ml
    ["1.5 l", true], // from the card text
    ["2 l", false],
    ["20 cm", true],
    ["8 inches", false], // 20.3 cm; the table says 7.75 in
    ["7.75 in", true],
    ["9 inches", false],
    ["2%", true],
    ["3%", false],
    ["2.5%", false],
  ] as const)("%s → %s", (text, ok) => {
    expect(mismatches(text).length === 0).toBe(ok);
  });

  it("allows numbers found in the card texts, in any family", () => {
    expect(mismatches("Use 2% salt and 1.5 l of water")).toEqual([]);
  });

  it("flags a family the card does not mention at all", () => {
    expect(
      findNumericMismatches("Add 25 g butter", { temperatures: [{ value: 180, unit: "C" }] }),
    ).toHaveLength(1);
  });
});

describe("findNumericMismatches: text conventions", () => {
  it("reads es-ES decimal commas and thousands points", () => {
    expect(mismatches("0,5 kg de harina", "es-ES")).toEqual([]);
    expect(mismatches("500 g y 1,5 l", "es-ES")).toEqual([]);
    expect(mismatches("1.500 ml", "es-ES")).toEqual([]); // 1.5 l is in the card text
    expect(mismatches("2.500 ml", "es-ES")).toEqual(["2.500 ml"]);
  });

  it("ignores unit-less numbers", () => {
    expect(mismatches("7 mistakes in 3 steps, slide 2/8")).toEqual([]);
  });

  it("returns every unmatched number in order", () => {
    expect(mismatches("Bake 25 min at 220 °C with 40 g butter")).toEqual([
      "25 min",
      "220 °C",
      "40 g",
    ]);
  });
});

describe("checkNumericFidelity", () => {
  it("returns blocking NUMERIC_MISMATCH issues with the field path and card values", () => {
    const issues = checkNumericFidelity(
      [
        { fieldPath: "slides.s1.slots.body", text: "Bake at 200 °C for 25 minutes." },
        { fieldPath: "caption", text: "Rest 10 minutes. Save this!" },
        { fieldPath: "hook", text: "7 mistakes" },
      ],
      reference,
      { locale: "en" },
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      code: "NUMERIC_MISMATCH",
      severity: "BLOCKER",
      fieldPath: "slides.s1.slots.body",
      message: '"200 °C" does not match any number on the cited cards.',
    });
    expect(issues[0]?.fixHint).toContain("Cards give: 180, 74 °C.");
    expect(issues[1]?.fieldPath).toBe("slides.s1.slots.body");
    expect(issues[1]?.message).toContain("25 minutes");
    expect(issues[1]?.fixHint).toContain("10–15, 90 min.");
  });

  it("returns nothing when the text uses the card values and their conversions", () => {
    expect(
      checkNumericFidelity(
        [
          {
            fieldPath: "slides.s2.slots.body",
            text: "Preheat to 355 °F (180 °C). Rest 10–15 min. Weigh 8.75 oz (250 g).",
          },
        ],
        reference,
        { locale: "en" },
      ),
    ).toEqual([]);
  });

  it("says so when the cards have no number of that kind", () => {
    const [issue] = checkNumericFidelity(
      [{ fieldPath: "caption", text: "Add 3% sugar" }],
      { temperatures: [] },
      { locale: "en" },
    );
    expect(issue?.fixHint).toContain("The cards give no number of this kind.");
  });
});
