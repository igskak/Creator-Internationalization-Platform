// The card editor's form state (plan 10 §10.2 `/knowledge/cards/[id]`). Every value is text while the
// person types; this module turns a card into that text and the edited text back into the smallest
// patch for `updateKnowledgeCard`. Pure functions, so the rules can be tested without a browser.

export type TextRow = Record<string, string>;

export type CardFormState = {
  title: string;
  category: string;
  subcategory: string;
  claim: string;
  explanation: string;
  procedure: TextRow[];
  ingredients: TextRow[];
  temperatures: TextRow[];
  timings: TextRow[];
  commonMistakes: TextRow[];
  safetySensitive: boolean;
  safetyNotes: string;
  /** Comma-separated. */
  tags: string;
};

/** The fields of a card the editor reads (a subset of the service's `CardView`). */
export type EditableCard = {
  title: string;
  category: string;
  subcategory: string | null;
  claim: string;
  explanation: string;
  procedureJson: { n: number; text: string }[];
  ingredientsJson: {
    name: string;
    quantity?: number | undefined;
    unit?: string | undefined;
    note?: string | undefined;
  }[];
  temperaturesJson: { value: number; unit: "C" | "F"; target: string; context: string }[];
  timingsJson: { value: number; valueMax?: number | undefined; unit: string; context: string }[];
  commonMistakesJson: { mistake: string; why?: string | undefined; fix?: string | undefined }[];
  safetySensitive: boolean;
  safetyNotes: string | null;
  tags: string[];
};

export const TEMPERATURE_UNITS = ["C", "F"] as const;
export const TEMPERATURE_TARGETS = [
  "OVEN",
  "PAN",
  "OIL",
  "WATER",
  "CORE",
  "FRIDGE",
  "FREEZER",
  "OTHER",
] as const;
export const TIMING_UNITS = ["s", "min", "h", "d"] as const;

const num = (value: number | undefined) => (value === undefined ? "" : String(value));

export function cardToForm(card: EditableCard): CardFormState {
  return {
    title: card.title,
    category: card.category,
    subcategory: card.subcategory ?? "",
    claim: card.claim,
    explanation: card.explanation,
    procedure: card.procedureJson.map((s) => ({ text: s.text })),
    ingredients: card.ingredientsJson.map((i) => ({
      name: i.name,
      quantity: num(i.quantity),
      unit: i.unit ?? "",
      note: i.note ?? "",
    })),
    temperatures: card.temperaturesJson.map((t) => ({
      value: String(t.value),
      unit: t.unit,
      target: t.target,
      context: t.context,
    })),
    timings: card.timingsJson.map((t) => ({
      value: String(t.value),
      valueMax: num(t.valueMax),
      unit: t.unit,
      context: t.context,
    })),
    commonMistakes: card.commonMistakesJson.map((m) => ({
      mistake: m.mistake,
      why: m.why ?? "",
      fix: m.fix ?? "",
    })),
    safetySensitive: card.safetySensitive,
    safetyNotes: card.safetyNotes ?? "",
    tags: card.tags.join(", "),
  };
}

export const parseTags = (text: string): string[] => [
  ...new Set(
    text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];

/** A number typed with a dot or a comma, or null when it is not a number. */
export function parseNumber(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (value === "" || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

export type PatchResult = {
  /** Only the fields that differ from the card. */
  patch: Record<string, unknown>;
  /** Problems found while reading the text, by form path (`timings.0.value`). */
  errors: Record<string, string>;
};

const opt = (text: string): string | undefined => (text.trim() === "" ? undefined : text.trim());

/**
 * What changed between the form as loaded (`initial`) and as edited (`form`), in the shape of
 * `updateKnowledgeCard`'s patch. Rows with nothing in them are dropped; a number field that is not a
 * number is reported in `errors` and the list it belongs to is left out of the patch.
 */
export function formToPatch(initial: CardFormState, form: CardFormState): PatchResult {
  const patch: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const filled = (rows: TextRow[]) =>
    rows.filter((row) => Object.values(row).some((v) => v.trim() !== ""));
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

  if (form.title !== initial.title) patch.title = form.title;
  if (form.category !== initial.category) patch.category = form.category;
  if (form.subcategory !== initial.subcategory) patch.subcategory = form.subcategory.trim() || null;
  if (form.claim !== initial.claim) patch.claim = form.claim;
  if (form.explanation !== initial.explanation) patch.explanation = form.explanation;
  if (form.safetySensitive !== initial.safetySensitive)
    patch.safetySensitive = form.safetySensitive;
  if (form.safetyNotes !== initial.safetyNotes) patch.safetyNotes = form.safetyNotes.trim() || null;
  if (changed(parseTags(form.tags), parseTags(initial.tags))) patch.tags = parseTags(form.tags);

  const list = <T>(
    key: keyof CardFormState & string,
    build: (row: TextRow, index: number) => T | null,
  ) => {
    const before = filled(initial[key as "procedure"]);
    const rows = filled(form[key as "procedure"]);
    if (!changed(before, rows)) return;
    const built: T[] = [];
    let ok = true;
    rows.forEach((row, index) => {
      const item = build(row, index);
      if (item === null) ok = false;
      else built.push(item);
    });
    if (ok) patch[key] = built;
  };

  const required = (row: TextRow, key: string, path: string) => {
    const value = parseNumber(row[key] ?? "");
    if (value === null) errors[path] = "Enter a number.";
    return value;
  };
  const optionalNumber = (row: TextRow, key: string, path: string): number | undefined | null => {
    const text = (row[key] ?? "").trim();
    if (text === "") return undefined;
    const value = parseNumber(text);
    if (value === null) errors[path] = "Enter a number.";
    return value;
  };

  list("procedure", (row, i) => ({ n: i + 1, text: (row.text ?? "").trim() }));
  list("ingredients", (row, i) => {
    const quantity = optionalNumber(row, "quantity", `ingredients.${i}.quantity`);
    if (quantity === null) return null;
    return {
      name: (row.name ?? "").trim(),
      ...(quantity === undefined ? {} : { quantity }),
      ...(opt(row.unit ?? "") ? { unit: opt(row.unit ?? "") } : {}),
      ...(opt(row.note ?? "") ? { note: opt(row.note ?? "") } : {}),
    };
  });
  list("temperatures", (row, i) => {
    const value = required(row, "value", `temperatures.${i}.value`);
    if (value === null) return null;
    return {
      value,
      unit: row.unit ?? "C",
      target: row.target ?? "OTHER",
      context: (row.context ?? "").trim(),
    };
  });
  list("timings", (row, i) => {
    const value = required(row, "value", `timings.${i}.value`);
    const max = optionalNumber(row, "valueMax", `timings.${i}.valueMax`);
    if (value === null || max === null) return null;
    return {
      value,
      ...(max === undefined ? {} : { valueMax: max }),
      unit: row.unit ?? "min",
      context: (row.context ?? "").trim(),
    };
  });
  list("commonMistakes", (row) => ({
    mistake: (row.mistake ?? "").trim(),
    ...(opt(row.why ?? "") ? { why: opt(row.why ?? "") } : {}),
    ...(opt(row.fix ?? "") ? { fix: opt(row.fix ?? "") } : {}),
  }));

  return { patch, errors };
}

/** New empty rows for the "add" buttons. */
export const NEW_ROWS = {
  procedure: (): TextRow => ({ text: "" }),
  ingredients: (): TextRow => ({ name: "", quantity: "", unit: "", note: "" }),
  temperatures: (): TextRow => ({ value: "", unit: "C", target: "OTHER", context: "" }),
  timings: (): TextRow => ({ value: "", valueMax: "", unit: "min", context: "" }),
  commonMistakes: (): TextRow => ({ mistake: "", why: "", fix: "" }),
};
