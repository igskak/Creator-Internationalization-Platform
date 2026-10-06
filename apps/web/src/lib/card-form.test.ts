import { describe, expect, it } from "vitest";
import {
  type CardFormState,
  cardToForm,
  type EditableCard,
  formToPatch,
  NEW_ROWS,
  parseNumber,
  parseTags,
} from "./card-form";

const card: EditableCard = {
  title: "Гречка",
  category: "GRAINS_RICE_PASTA",
  subcategory: null,
  claim: "Крышку не поднимают.",
  explanation: "",
  procedureJson: [
    { n: 1, text: "Залить водой 1:2." },
    { n: 2, text: "Варить 15 минут." },
  ],
  ingredientsJson: [{ name: "гречка", quantity: 200, unit: "г" }],
  temperaturesJson: [{ value: 74, unit: "C", target: "CORE", context: "прогрев" }],
  timingsJson: [{ value: 10, valueMax: 15, unit: "min", context: "варка" }],
  commonMistakesJson: [{ mistake: "Мешать", why: "Зёрна разбиваются" }],
  safetySensitive: false,
  safetyNotes: null,
  tags: ["крупы", "гречка"],
};

describe("cardToForm", () => {
  it("turns every value into text and empty options into empty strings", () => {
    const form = cardToForm(card);
    expect(form).toMatchObject({
      title: "Гречка",
      subcategory: "",
      safetyNotes: "",
      tags: "крупы, гречка",
      procedure: [{ text: "Залить водой 1:2." }, { text: "Варить 15 минут." }],
      ingredients: [{ name: "гречка", quantity: "200", unit: "г", note: "" }],
      temperatures: [{ value: "74", unit: "C", target: "CORE", context: "прогрев" }],
      timings: [{ value: "10", valueMax: "15", unit: "min", context: "варка" }],
      commonMistakes: [{ mistake: "Мешать", why: "Зёрна разбиваются", fix: "" }],
    });
  });
});

describe("formToPatch", () => {
  const initial = cardToForm(card);
  const edit = (change: Partial<CardFormState>): CardFormState => ({ ...initial, ...change });

  it("is empty when nothing changed", () => {
    expect(formToPatch(initial, initial)).toEqual({ patch: {}, errors: {} });
  });

  it("sends only the fields that changed", () => {
    const { patch, errors } = formToPatch(
      initial,
      edit({
        title: "Гречка без каши",
        subcategory: "BUCKWHEAT",
        safetySensitive: true,
        safetyNotes: " Хранение ",
      }),
    );
    expect(patch).toEqual({
      title: "Гречка без каши",
      subcategory: "BUCKWHEAT",
      safetySensitive: true,
      safetyNotes: "Хранение",
    });
    expect(errors).toEqual({});
  });

  it("turns cleared optional text into null and reads tags as a set", () => {
    const withValues = cardToForm({ ...card, subcategory: "X", safetyNotes: "Заметка" });
    const { patch } = formToPatch(withValues, {
      ...withValues,
      subcategory: "  ",
      safetyNotes: "",
      tags: "крупы,  гречка, крупы,,",
    });
    expect(patch).toEqual({ subcategory: null, safetyNotes: null });
    expect(formToPatch(initial, edit({ tags: "крупы, новое" })).patch).toEqual({
      tags: ["крупы", "новое"],
    });
    expect(parseTags(" a, b ,a,, ")).toEqual(["a", "b"]);
  });

  it("numbers the steps by order and drops empty rows", () => {
    const { patch } = formToPatch(
      initial,
      edit({ procedure: [{ text: "Первое" }, { text: "   " }, { text: "Второе" }, { text: "" }] }),
    );
    expect(patch.procedure).toEqual([
      { n: 1, text: "Первое" },
      { n: 2, text: "Второе" },
    ]);
    expect(
      formToPatch(initial, edit({ procedure: [...initial.procedure, NEW_ROWS.procedure()] })).patch,
    ).toEqual({});
  });

  it("reads numbers with a comma or a dot, and keeps optional parts out when empty", () => {
    const { patch, errors } = formToPatch(
      initial,
      edit({
        ingredients: [
          { name: "гречка", quantity: "0,5", unit: "кг", note: "" },
          { name: "соль", quantity: "", unit: "", note: "по вкусу" },
        ],
        timings: [{ value: "12.5", valueMax: "", unit: "h", context: "настаивание" }],
        temperatures: [{ value: "-18", unit: "C", target: "FREEZER", context: "хранение" }],
      }),
    );
    expect(errors).toEqual({});
    expect(patch.ingredients).toEqual([
      { name: "гречка", quantity: 0.5, unit: "кг" },
      { name: "соль", note: "по вкусу" },
    ]);
    expect(patch.timings).toEqual([{ value: 12.5, unit: "h", context: "настаивание" }]);
    expect(patch.temperatures).toEqual([
      { value: -18, unit: "C", target: "FREEZER", context: "хранение" },
    ]);
  });

  it("reports a number field that is not a number and leaves that list out of the patch", () => {
    const { patch, errors } = formToPatch(
      initial,
      edit({
        title: "Другое",
        timings: [{ value: "десять", valueMax: "15", unit: "min", context: "варка" }],
        temperatures: [
          { value: "74", unit: "C", target: "CORE", context: "прогрев" },
          { value: "", unit: "C", target: "OVEN", context: "духовка" },
        ],
        ingredients: [{ name: "гречка", quantity: "много", unit: "", note: "" }],
      }),
    );
    expect(errors).toEqual({
      "timings.0.value": "Enter a number.",
      "temperatures.1.value": "Enter a number.",
      "ingredients.0.quantity": "Enter a number.",
    });
    expect(patch).toEqual({ title: "Другое" });
  });

  it("builds mistakes with optional explanations and fixes", () => {
    const { patch } = formToPatch(
      initial,
      edit({
        commonMistakes: [
          { mistake: "Мешать", why: "", fix: "Не трогать" },
          { mistake: "Открывать крышку", why: "Уходит пар", fix: "" },
        ],
      }),
    );
    expect(patch.commonMistakes).toEqual([
      { mistake: "Мешать", fix: "Не трогать" },
      { mistake: "Открывать крышку", why: "Уходит пар" },
    ]);
  });
});

describe("parseNumber", () => {
  it.each([
    ["15", 15],
    [" 0,5 ", 0.5],
    ["-3.25", -3.25],
    ["+4", null],
    ["", null],
    ["1e3", null],
    ["12abc", null],
    ["1,2,3", null],
  ])("%j → %j", (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});
