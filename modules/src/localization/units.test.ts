import { describe, expect, it } from "vitest";
import {
  buildConversionTable,
  convertTemperature,
  displayQuantity,
  formatNumber,
  formatQuantity,
  formatTiming,
  type MarketUnits,
  parseUnit,
  type Quantity,
  toImperial,
  toMetric,
} from "./units";

const es: MarketUnits = { locale: "es-ES", measurementSystem: "METRIC" };
const en: MarketUnits = { locale: "en", measurementSystem: "DUAL" };
const us: MarketUnits = { locale: "en", measurementSystem: "IMPERIAL" };

describe("convertTemperature", () => {
  it.each([
    // [value, from, target, expected]
    [180, "C", "OVEN", 355],
    [200, "C", "OVEN", 390],
    [220, "C", "OVEN", 430],
    [74, "C", "CORE", 165],
    [63, "C", "CORE", 145],
    [57, "C", "CORE", 135],
    [100, "C", "WATER", 212],
    [4, "C", "FRIDGE", 39],
    [-18, "C", "FREEZER", 0],
    [350, "F", "OVEN", 175],
    [165, "F", "CORE", 74],
    [212, "F", "WATER", 100],
  ] as const)("%s °%s (%s) → %s", (value, from, target, expected) => {
    expect(convertTemperature(value, from, target).value).toBe(expected);
    expect(convertTemperature(value, from, target).unit).toBe(from === "C" ? "F" : "C");
  });

  it("rounds to 1 degree when the target is unknown", () => {
    expect(convertTemperature(180, "C").value).toBe(356);
  });
});

describe("toImperial / toMetric", () => {
  it.each([
    [
      { value: 250, unit: "g" },
      { value: 8.75, unit: "oz" },
    ],
    [
      { value: 100, unit: "g" },
      { value: 3.5, unit: "oz" },
    ],
    [
      { value: 500, unit: "g" },
      { value: 1.1, unit: "lb" },
    ],
    [
      { value: 1, unit: "kg" },
      { value: 2.2, unit: "lb" },
    ],
    [
      { value: 250, unit: "ml" },
      { value: 1, unit: "cup" },
    ],
    [
      { value: 125, unit: "ml" },
      { value: 0.5, unit: "cup" },
    ],
    [
      { value: 60, unit: "ml" },
      { value: 0.25, unit: "cup" },
    ],
    [
      { value: 100, unit: "ml" },
      { value: 3.5, unit: "floz" },
    ],
    [
      { value: 1.5, unit: "l" },
      { value: 50.5, unit: "floz" },
    ],
    [
      { value: 1, unit: "l" },
      { value: 4, unit: "cup" },
    ],
    [
      { value: 20, unit: "cm" },
      { value: 7.75, unit: "in" },
    ],
    [
      { value: 3, unit: "cm" },
      { value: 1.25, unit: "in" },
    ],
  ] as [Quantity, Quantity][])("%j → %j", (from, to) => {
    expect(toImperial(from)).toEqual(to);
  });

  it.each([
    [
      { value: 8, unit: "oz" },
      { value: 225, unit: "g" },
    ],
    [
      { value: 1, unit: "oz" },
      { value: 28, unit: "g" },
    ],
    [
      { value: 1, unit: "lb" },
      { value: 455, unit: "g" },
    ],
    [
      { value: 3, unit: "lb" },
      { value: 1.35, unit: "kg" },
    ],
    [
      { value: 1, unit: "cup" },
      { value: 240, unit: "ml" },
    ],
    [
      { value: 0.5, unit: "cup" },
      { value: 120, unit: "ml" },
    ],
    [
      { value: 8, unit: "floz" },
      { value: 235, unit: "ml" },
    ],
    [
      { value: 5, unit: "cup" },
      { value: 1.2, unit: "l" },
    ],
    [
      { value: 9, unit: "in" },
      { value: 23, unit: "cm" },
    ],
  ] as [Quantity, Quantity][])("%j → %j", (from, to) => {
    expect(toMetric(from)).toEqual(to);
  });

  it("leaves a value already in the target system alone", () => {
    expect(toImperial({ value: 8, unit: "oz" })).toEqual({ value: 8, unit: "oz" });
    expect(toMetric({ value: 200, unit: "g" })).toEqual({ value: 200, unit: "g" });
  });

  it("returns undefined when the converted value would round to zero", () => {
    expect(toImperial({ value: 1, unit: "g" })).toBeUndefined();
    expect(toImperial({ value: 2, unit: "ml" })).toBeUndefined();
    expect(toMetric({ value: 0.01, unit: "oz" })).toBeUndefined();
  });
});

describe("formatting", () => {
  it("uses a decimal comma for es-ES and a point for en", () => {
    expect(formatNumber(1.5, "es-ES")).toBe("1,5");
    expect(formatNumber(1.5, "en")).toBe("1.5");
    expect(formatNumber(1500, "es-ES")).toBe("1500");
    expect(formatNumber(8.75, "en")).toBe("8.75");
    expect(formatNumber(1 / 3, "en")).toBe("0.33");
  });

  it("formats quantities with unit labels", () => {
    expect(formatQuantity({ value: 180, unit: "C" }, "es-ES")).toBe("180 °C");
    expect(formatQuantity({ value: 8.75, unit: "oz" }, "en")).toBe("8.75 oz");
    expect(formatQuantity({ value: 3.5, unit: "floz" }, "en")).toBe("3.5 fl oz");
    expect(formatQuantity({ value: 1.5, unit: "kg" }, "es-ES")).toBe("1,5 kg");
  });

  it("writes cups as fractions", () => {
    expect(formatQuantity({ value: 1, unit: "cup" }, "en")).toBe("1 cup");
    expect(formatQuantity({ value: 0.75, unit: "cup" }, "en")).toBe("¾ cup");
    expect(formatQuantity({ value: 1.5, unit: "cup" }, "en")).toBe("1½ cups");
    expect(formatQuantity({ value: 1 / 3, unit: "cup" }, "en")).toBe("⅓ cup");
    expect(formatQuantity({ value: 2, unit: "cup" }, "es-ES")).toBe("2 tazas");
  });

  it("formats times without converting them", () => {
    expect(formatTiming({ value: 10, valueMax: 15, unit: "min" }, "es-ES")).toBe("10–15 min");
    expect(formatTiming({ value: 1.5, unit: "h" }, "es-ES")).toBe("1,5 h");
    expect(formatTiming({ value: 1, unit: "d" }, "en")).toBe("1 day");
    expect(formatTiming({ value: 2, unit: "d" }, "es-ES")).toBe("2 días");
  });
});

describe("displayQuantity per market", () => {
  it("es-ES (METRIC) shows °C with a decimal comma", () => {
    expect(displayQuantity({ value: 180, unit: "C" }, es, "OVEN")).toBe("180 °C");
    expect(displayQuantity({ value: 350, unit: "F" }, es, "OVEN")).toBe("175 °C");
    expect(displayQuantity({ value: 1.5, unit: "kg" }, es)).toBe("1,5 kg");
    expect(displayQuantity({ value: 8, unit: "oz" }, es)).toBe("225 g");
  });

  it("en (DUAL) shows °F first with °C in brackets", () => {
    expect(displayQuantity({ value: 180, unit: "C" }, en, "OVEN")).toBe("355 °F (180 °C)");
    expect(displayQuantity({ value: 74, unit: "C" }, en, "CORE")).toBe("165 °F (74 °C)");
    expect(displayQuantity({ value: 350, unit: "F" }, en, "OVEN")).toBe("350 °F (175 °C)");
    expect(displayQuantity({ value: 250, unit: "g" }, en)).toBe("8.75 oz (250 g)");
    expect(displayQuantity({ value: 250, unit: "ml" }, en)).toBe("1 cup (250 ml)");
  });

  it("IMPERIAL shows imperial only", () => {
    expect(displayQuantity({ value: 180, unit: "C" }, us, "OVEN")).toBe("355 °F");
    expect(displayQuantity({ value: 250, unit: "g" }, us)).toBe("8.75 oz");
  });

  it("falls back to the original when the conversion is too small to show", () => {
    expect(displayQuantity({ value: 1, unit: "g" }, en)).toBe("1 g");
    expect(displayQuantity({ value: 2, unit: "ml" }, us)).toBe("2 ml");
  });
});

describe("parseUnit", () => {
  it.each([
    ["g", "g"],
    ["г", "g"],
    ["gramos", "g"],
    ["кг", "kg"],
    ["мл", "ml"],
    ["ml", "ml"],
    ["л", "l"],
    ["L", "l"],
    ["°C", "C"],
    ["º F", "F"],
    ["fl oz", "floz"],
    ["oz", "oz"],
    ["lbs", "lb"],
    ["cups", "cup"],
    ["min", "min"],
    ["минут", "min"],
    ["horas", "h"],
    ["%", "%"],
    ["°", "deg"],
  ] as const)("%s → %s", (text, unit) => {
    expect(parseUnit(text)).toBe(unit);
  });

  it("returns undefined for units it does not know", () => {
    expect(parseUnit("pcs")).toBeUndefined();
    expect(parseUnit("tbsp")).toBeUndefined();
    expect(parseUnit("")).toBeUndefined();
  });
});

describe("buildConversionTable", () => {
  const card = {
    temperatures: [
      { value: 180, unit: "C" as const, target: "OVEN", context: "preheat" },
      { value: 74, unit: "C" as const, target: "CORE", context: "chicken" },
    ],
    timings: [{ value: 10, valueMax: 15, unit: "min" as const, context: "rest" }],
    ingredients: [
      { name: "rice", quantity: 250, unit: "г" },
      { name: "water", quantity: 500, unit: "мл" },
      { name: "salt", quantity: 2, unit: "ч.л." },
      { name: "bay leaf" },
    ],
  };

  it("lists the exact strings for an English market", () => {
    expect(buildConversionTable(card, en)).toEqual([
      { kind: "TEMPERATURE", label: "preheat", source: "180 °C", display: "355 °F (180 °C)" },
      { kind: "TEMPERATURE", label: "chicken", source: "74 °C", display: "165 °F (74 °C)" },
      { kind: "TIMING", label: "rest", source: "10–15 min", display: "10–15 min" },
      { kind: "INGREDIENT", label: "rice", source: "250 g", display: "8.75 oz (250 g)" },
      { kind: "INGREDIENT", label: "water", source: "500 ml", display: "2 cups (500 ml)" },
      { kind: "INGREDIENT", label: "salt", source: "2 ч.л.", display: "2 ч.л." },
    ]);
  });

  it("keeps metric for a Spanish market with a decimal comma", () => {
    const table = buildConversionTable(
      {
        ingredients: [{ name: "harina", quantity: 1.5, unit: "kg" }],
        temperatures: card.temperatures,
      },
      es,
    );
    expect(table.map((e) => e.display)).toEqual(["180 °C", "74 °C", "1,5 kg"]);
  });
});
