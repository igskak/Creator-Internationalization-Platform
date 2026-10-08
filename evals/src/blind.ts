import { createHash } from "node:crypto";
import type { CaseOutcome } from "./runner";

// The blind export for the native reviewers of Gate G1 (07 §7.12, 14 §14.3): per idea, the two
// markets' drafts as items "A" and "B" in a seeded random order, without the market label or the
// critic's score, plus a sheet to fill in. The key that says which item is which market is a
// separate file the reviewers do not get.

type Variant = CaseOutcome["variants"][number];

const SHEET_COLUMNS = [
  "case_id",
  "item",
  "language",
  "reads_as_native_1_5",
  "not_a_translation_of_the_other_yes_no",
  "approvable_yes_no",
  "field_edits_needed",
  "comments",
] as const;

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** A stable coin flip per case and seed, so a re-export gives the same order. */
const flip = (caseId: string, seed: string) =>
  createHash("sha256").update(`${seed}:${caseId}`).digest()[0]! % 2 === 0;

function itemText(variant: Variant): string {
  const slides = variant.slides
    .map((s, i) => `${i + 1}. ${Object.values(s.slots).join(" / ")}`)
    .join("\n");
  return [
    `HOOK: ${variant.hook ?? ""}`,
    `SLIDES:\n${slides}`,
    `CAPTION: ${variant.caption ?? ""}`,
    `CTA: ${variant.cta?.text ?? ""}`,
    `HASHTAGS: ${variant.hashtags.join(" ")}`,
  ].join("\n\n");
}

export type BlindExport = {
  /** The text the reviewers read: instructions and every pair. */
  markdown: string;
  /** One row per item to fill in. */
  csv: string;
  /** case id → item label → market code. Keep it away from the reviewers. */
  key: Record<string, Record<string, string>>;
};

export function exportBlind(outcomes: readonly CaseOutcome[], seed = "g1"): BlindExport {
  const key: BlindExport["key"] = {};
  const rows: string[][] = [];
  const parts: string[] = [
    "# Blind review sheet",
    "",
    "For each idea you get two drafts, A and B, written for two different markets. Read the draft in your language and score it; the other one is there so you can say whether the two read like the same post in two languages.",
    "",
    "- **reads_as_native_1_5**: 5 = reads as if written for my market, 1 = machine translation.",
    "- **not_a_translation_of_the_other_yes_no**: yes if the two drafts are clearly different posts, not translations of each other.",
    "- **approvable_yes_no** and **field_edits_needed**: could this be posted with at most three edits? How many fields would you change?",
    "",
  ];
  for (const outcome of outcomes) {
    const variants = outcome.variants.filter((v) => v.hasContent);
    if (variants.length < 2) continue;
    const ordered = flip(outcome.case.id, seed) ? variants : [...variants].reverse();
    key[outcome.case.id] = {};
    parts.push(`## ${outcome.case.id}`, "");
    ordered.forEach((variant, i) => {
      const label = String.fromCharCode(65 + i);
      (key[outcome.case.id] as Record<string, string>)[label] = variant.marketCode;
      parts.push(`### Draft ${label}`, "", itemText(variant), "");
      rows.push([outcome.case.id, label, languageOf(variant), "", "", "", "", ""]);
    });
  }
  const csv = [SHEET_COLUMNS.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join(
    "\n",
  );
  return { markdown: `${parts.join("\n")}\n`, csv: `${csv}\n`, key };
}

/** The language of the draft: the market code is hidden, so the sheet names the language. */
function languageOf(variant: Variant): string {
  return variant.marketCode.startsWith("es")
    ? "es"
    : variant.marketCode.startsWith("fr")
      ? "fr"
      : "en";
}
