import { createHash } from "node:crypto";
import { parseCsv } from "@rc/lib/csv";

// Parsing of an attribution CSV (plan 11 §11.7, M6-08): leads, sales and refunds exported from the
// selling stack. Pure, so every rule is tested without a database; campaigns and markets are
// resolved later, against the database. Only the columns below are read: names, e-mails, phones
// and any other column of the export are never looked at, so no customer data is stored (A-10).

export const MAX_ATTRIBUTION_ROWS = 10_000;
export const ATTRIBUTION_FIELDS = [
  "type",
  "occurredAt",
  "campaignId",
  "market",
  "quantity",
  "amount",
  "currency",
  "externalRef",
] as const;
export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number];
/** Our field → the column name in the file, when the file does not use one of the known names. */
export type AttributionMapping = Partial<Record<AttributionField, string>>;

export type ParsedAttribution = {
  /** Row number as a person sees it in the file (the header is row 1). */
  row: number;
  type: "LEAD" | "SALE" | "REFUND";
  occurredAt: string;
  campaignId: string | null;
  /** A market code (`es-ES`) when the file has one. */
  market: string | null;
  quantity: number;
  /** Two decimals as text, the way `numeric(12,2)` takes it; null when the file has none. */
  amount: string | null;
  currency: string | null;
  /** The order id of the file, or a hash of it (an e-mail is hashed), or a hash of the row. */
  externalRef: string;
  /** UTM tags of the row, without the campaign (that is `campaignId`). */
  utm: Record<string, string> | null;
};

export type AttributionRowError = { row: number; field?: string; message: string };

export class AttributionFileError extends Error {
  constructor(
    readonly code: "EMPTY" | "MISSING_COLUMNS" | "TOO_MANY_ROWS",
    message: string,
  ) {
    super(message);
    this.name = "AttributionFileError";
  }
}

const squash = (name: string) => name.toLowerCase().replace(/[\s_-]+/gu, "");

/** Known column names (squashed) → our field. */
const ALIASES: Record<string, AttributionField> = {
  type: "type",
  event: "type",
  eventtype: "type",
  kind: "type",
  occurredat: "occurredAt",
  date: "occurredAt",
  datetime: "occurredAt",
  time: "occurredAt",
  createdat: "occurredAt",
  orderdate: "occurredAt",
  campaign: "campaignId",
  campaignid: "campaignId",
  utmcampaign: "campaignId",
  market: "market",
  marketcode: "market",
  quantity: "quantity",
  qty: "quantity",
  count: "quantity",
  amount: "amount",
  revenue: "amount",
  total: "amount",
  value: "amount",
  currency: "currency",
  externalref: "externalRef",
  ref: "externalRef",
  orderid: "externalRef",
  order: "externalRef",
  ordernumber: "externalRef",
  transactionid: "externalRef",
};
const UTM_COLUMNS: Record<string, string> = {
  utmsource: "source",
  utmmedium: "medium",
  utmcontent: "content",
  utmterm: "term",
};

const TYPES: Record<string, ParsedAttribution["type"]> = {
  LEAD: "LEAD",
  SIGNUP: "LEAD",
  SUBSCRIBE: "LEAD",
  SUBSCRIPTION: "LEAD",
  ЛИД: "LEAD",
  SALE: "SALE",
  ORDER: "SALE",
  PURCHASE: "SALE",
  ПРОДАЖА: "SALE",
  REFUND: "REFUND",
  CHARGEBACK: "REFUND",
  ВОЗВРАТ: "REFUND",
};

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[0] ?? ",";
}

/** `2026-10-01`, `2026-10-01 10:00`, ISO with a zone; a date without a zone is UTC. */
export function toInstant(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(v)) date = new Date(`${v}T00:00:00Z`);
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/u.test(v)) {
    date = new Date(`${v.replace(" ", "T")}Z`);
  } else if (/^\d{4}-\d{2}-\d{2}T.+([+-]\d{2}:?\d{2}|Z)$/u.test(v)) date = new Date(v);
  else if (/^\d{2}\.\d{2}\.\d{4}$/u.test(v)) {
    const [dd, mm, yyyy] = v.split(".");
    date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  } else return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `12.5`, `12,50`, `1 234,50`, `1,234.50`, `€12` → `"12.50"`; null when it is not a sum. */
export function toAmount(value: string): string | null {
  let v = value.replace(/[\s €$£]/gu, "").replace(/^(EUR|USD|GBP)/iu, "");
  if (v === "") return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/u.test(v)) v = v.replace(/\./gu, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/u.test(v)) v = v.replace(/,/gu, "");
  else if (/^\d+,\d{1,2}$/u.test(v)) v = v.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/u.test(v)) return null;
  const n = Number(v);
  return n < 10_000_000_000 ? n.toFixed(2) : null;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The reference stored for a row: the order id as it is, a hash when it looks like an e-mail or a
 * phone number (never stored in clear), or a hash of the row number and content when the file has
 * no id: the same file imported twice adds nothing, and two equal rows of one file both count.
 */
function referenceOf(raw: string, rowKey: string): string {
  const v = raw.trim();
  if (v === "") return `row:${sha(rowKey).slice(0, 32)}`;
  if (v.includes("@") || /^\+?[\d\s()-]{7,}$/u.test(v)) return `hash:${sha(v.toLowerCase())}`;
  return v.slice(0, 200);
}

export type ParsedAttributionFile = {
  rows: ParsedAttribution[];
  errors: AttributionRowError[];
  totalRows: number;
};

export function parseAttributionCsv(
  text: string,
  mapping: AttributionMapping = {},
): ParsedAttributionFile {
  const clean = text.replace(/^﻿/u, "");
  const firstLine = clean.split(/\r?\n/u, 1)[0] ?? "";
  const table = parseCsv(clean, detectDelimiter(firstLine));
  const [header, ...body] = table;
  if (!header || body.length === 0) {
    throw new AttributionFileError("EMPTY", "The file has no rows under the header.");
  }
  if (body.length > MAX_ATTRIBUTION_ROWS) {
    throw new AttributionFileError(
      "TOO_MANY_ROWS",
      `The file has ${body.length} rows; at most ${MAX_ATTRIBUTION_ROWS} per import.`,
    );
  }
  // Column index of each field: the mapping first, then the known names.
  const index = new Map<AttributionField, number>();
  const utmIndex = new Map<string, number>();
  const squashed = header.map(squash);
  for (const field of ATTRIBUTION_FIELDS) {
    const mapped = mapping[field];
    if (mapped) {
      const at = squashed.indexOf(squash(mapped));
      if (at >= 0) index.set(field, at);
    }
  }
  squashed.forEach((name, at) => {
    const field = ALIASES[name];
    if (field && !index.has(field) && ![...index.values()].includes(at)) index.set(field, at);
    const utm = UTM_COLUMNS[name];
    if (utm) utmIndex.set(utm, at);
  });
  const missing = (["type", "occurredAt"] as const).filter((f) => !index.has(f));
  if (missing.length > 0) {
    throw new AttributionFileError(
      "MISSING_COLUMNS",
      `The file needs the columns: ${missing.join(", ")}.`,
    );
  }

  const rows: ParsedAttribution[] = [];
  const errors: AttributionRowError[] = [];
  body.forEach((cells, i) => {
    const row = i + 2;
    const cell = (field: AttributionField) => {
      const at = index.get(field);
      return at === undefined ? "" : (cells[at] ?? "").trim();
    };
    const type = TYPES[cell("type").toUpperCase()];
    if (!type) {
      errors.push({ row, field: "type", message: "Use LEAD, SALE or REFUND." });
      return;
    }
    const occurredAt = toInstant(cell("occurredAt"));
    if (!occurredAt) {
      errors.push({
        row,
        field: "occurredAt",
        message: "Use a date like 2026-10-01 or 2026-10-01 10:00.",
      });
      return;
    }
    const quantityText = cell("quantity");
    const quantity = quantityText === "" ? 1 : Number(quantityText);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      errors.push({ row, field: "quantity", message: "Use a whole number of 1 or more." });
      return;
    }
    const amountText = cell("amount");
    const amount = amountText === "" ? null : toAmount(amountText);
    if (amountText !== "" && amount === null) {
      errors.push({ row, field: "amount", message: "Use a sum like 19.90 (no minus sign)." });
      return;
    }
    if (type !== "LEAD" && amount === null) {
      errors.push({ row, field: "amount", message: "A sale or a refund needs its amount." });
      return;
    }
    const currencyText = cell("currency").toUpperCase();
    if (currencyText !== "" && !/^[A-Z]{3}$/u.test(currencyText)) {
      errors.push({ row, field: "currency", message: "Use a three-letter code like EUR." });
      return;
    }
    const campaign = cell("campaignId").toLowerCase();
    const utm: Record<string, string> = {};
    for (const [key, at] of utmIndex) {
      const value = (cells[at] ?? "").trim();
      if (value) utm[key] = value.slice(0, 200);
    }
    rows.push({
      row,
      type,
      occurredAt,
      campaignId: campaign === "" ? null : campaign.slice(0, 100),
      market: cell("market") || null,
      quantity,
      amount,
      currency: currencyText || null,
      externalRef: referenceOf(
        cell("externalRef"),
        [row, type, occurredAt, campaign, quantity, amount ?? "", currencyText].join("|"),
      ),
      utm: Object.keys(utm).length > 0 ? utm : null,
    });
  });
  return { rows, errors, totalRows: body.length };
}
