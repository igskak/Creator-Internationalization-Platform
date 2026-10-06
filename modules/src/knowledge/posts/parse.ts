// Parsing of the historical posts import file (plan 07 §7.2.5, M1-22): CSV or JSON in, valid rows
// and row errors out. Pure, so every rule can be tested without a database. The taxonomy codes are
// checked later, against the database.

export const MAX_POST_ROWS = 5000;
export const POST_FORMATS = ["CAROUSEL", "REEL", "SINGLE_IMAGE"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export const METRIC_KEYS = ["likes", "comments", "saves", "shares", "reach", "views"] as const;

export type ParsedPost = {
  /** Row number as a person sees it in the file (a CSV header is row 1). */
  row: number;
  externalId: string;
  permalink: string | null;
  postedAt: string;
  format: PostFormat | null;
  caption: string;
  metrics: Partial<Record<(typeof METRIC_KEYS)[number], number>>;
  annotations: {
    category?: string;
    angle?: string;
    hookType?: string;
    ctaType?: string;
    productCode?: string;
    visualPattern?: string;
  };
  isExemplar: boolean | null;
};

export type RowError = { row: number; externalId?: string; field?: string; message: string };

export type ParsedPosts = { rows: ParsedPost[]; errors: RowError[]; totalRows: number };

/** The file cannot be read at all (not a row problem). */
export class PostsFileError extends Error {
  constructor(
    readonly code: "EMPTY" | "BAD_JSON" | "MISSING_COLUMNS" | "TOO_MANY_ROWS" | "BAD_FORMAT",
    message: string,
  ) {
    super(message);
    this.name = "PostsFileError";
  }
}

const REQUIRED = ["externalid", "postedat", "caption"] as const;
/** Column name (any case, with or without `_`, `-` or spaces) → the key the importer uses. */
const COLUMNS: Record<string, string> = {
  externalid: "externalId",
  id: "externalId",
  permalink: "permalink",
  url: "permalink",
  postedat: "postedAt",
  format: "format",
  caption: "caption",
  likes: "likes",
  comments: "comments",
  saves: "saves",
  shares: "shares",
  reach: "reach",
  views: "views",
  category: "category",
  angle: "angle",
  hooktype: "hookType",
  ctatype: "ctaType",
  productcode: "productCode",
  visualpattern: "visualPattern",
  isexemplar: "isExemplar",
};
const squash = (name: string) => name.toLowerCase().replace(/[\s_-]+/gu, "");

/** Splits CSV text into rows of cells: quotes, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Excel in some locales saves `;`-separated CSV, spreadsheets may export tabs. */
function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[0] ?? ",";
}

const FORMAT_ALIASES: Record<string, PostFormat> = {
  CAROUSEL: "CAROUSEL",
  CAROUSEL_ALBUM: "CAROUSEL",
  ALBUM: "CAROUSEL",
  REEL: "REEL",
  REELS: "REEL",
  VIDEO: "REEL",
  SINGLE_IMAGE: "SINGLE_IMAGE",
  IMAGE: "SINGLE_IMAGE",
  PHOTO: "SINGLE_IMAGE",
  SINGLE: "SINGLE_IMAGE",
};

const TRUE = new Set(["true", "1", "yes", "y", "да", "x"]);
const FALSE = new Set(["false", "0", "no", "n", "нет"]);

function toCount(value: string): number | null {
  const v = value.replace(/[\s _]/gu, "");
  if (/^\d+$/u.test(v)) return Number(v);
  if (/^\d{1,3}(,\d{3})+$/u.test(v)) return Number(v.replace(/,/gu, ""));
  return null;
}

function toIso(value: string): string | null {
  const v = value.trim();
  // `2026-03-01 10:00` and `2026-03-01` are read as UTC; a zone in the text wins.
  const date = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/u.test(v)
    ? new Date(`${v.replace(" ", "T")}Z`)
    : /^\d{4}-\d{2}-\d{2}$/u.test(v)
      ? new Date(`${v}T00:00:00Z`)
      : new Date(v);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type Raw = Record<string, string>;

function toPost(raw: Raw, row: number, errors: RowError[]): ParsedPost | null {
  const externalId = (raw.externalId ?? "").trim();
  const fail = (field: string, message: string) =>
    errors.push({ row, ...(externalId ? { externalId } : {}), field, message });
  const before = errors.length;

  if (!externalId) fail("external_id", "The post id is empty.");
  const postedAt = toIso(raw.postedAt ?? "");
  if (!postedAt) fail("posted_at", `"${raw.postedAt ?? ""}" is not a date. Use 2026-03-01 10:00.`);
  const caption = raw.caption ?? "";
  if (caption.trim() === "") fail("caption", "The caption is empty.");

  let format: PostFormat | null = null;
  if ((raw.format ?? "").trim() !== "") {
    format =
      FORMAT_ALIASES[
        (raw.format ?? "")
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/gu, "_")
      ] ?? null;
    if (!format) fail("format", `"${raw.format}" is not CAROUSEL, REEL or SINGLE_IMAGE.`);
  }

  const metrics: ParsedPost["metrics"] = {};
  for (const key of METRIC_KEYS) {
    const text = (raw[key] ?? "").trim();
    if (text === "") continue;
    const n = toCount(text);
    if (n === null) fail(key, `"${text}" is not a whole number.`);
    else metrics[key] = n;
  }

  let isExemplar: boolean | null = null;
  const flag = (raw.isExemplar ?? "").trim().toLowerCase();
  if (flag !== "") {
    if (TRUE.has(flag)) isExemplar = true;
    else if (FALSE.has(flag)) isExemplar = false;
    else fail("is_exemplar", `"${raw.isExemplar}" is not yes or no.`);
  }

  const permalink = (raw.permalink ?? "").trim();
  if (permalink && !/^https?:\/\//iu.test(permalink)) {
    fail("permalink", "The link must start with http:// or https://.");
  }

  const annotations: ParsedPost["annotations"] = {};
  for (const key of [
    "category",
    "angle",
    "hookType",
    "ctaType",
    "productCode",
    "visualPattern",
  ] as const) {
    const v = (raw[key] ?? "").trim();
    if (v) annotations[key] = v;
  }

  if (errors.length > before || !postedAt) return null;
  return {
    row,
    externalId,
    permalink: permalink || null,
    postedAt,
    format,
    caption,
    metrics,
    annotations,
    isExemplar,
  };
}

function finish(raws: { raw: Raw; row: number }[]): ParsedPosts {
  if (raws.length > MAX_POST_ROWS) {
    throw new PostsFileError(
      "TOO_MANY_ROWS",
      `The file has ${raws.length} rows; the limit is ${MAX_POST_ROWS}. Split it.`,
    );
  }
  const rows: ParsedPost[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  for (const { raw, row } of raws) {
    const post = toPost(raw, row, errors);
    if (!post) continue;
    const first = seen.get(post.externalId);
    if (first !== undefined) {
      errors.push({
        row,
        externalId: post.externalId,
        field: "external_id",
        message: `The same post id is already in row ${first}; this row is skipped.`,
      });
      continue;
    }
    seen.set(post.externalId, row);
    rows.push(post);
  }
  return { rows, errors, totalRows: raws.length };
}

export function parsePostsCsv(input: string): ParsedPosts {
  const text = input.replace(/^﻿/u, "");
  if (text.trim() === "") throw new PostsFileError("EMPTY", "The file is empty.");
  const delimiter = detectDelimiter(text.split(/\r?\n/u, 1)[0] ?? "");
  const [header, ...body] = parseCsv(text, delimiter);
  const keys = (header ?? []).map((name) => COLUMNS[squash(name)] ?? null);
  const present = new Set((header ?? []).map(squash).map((n) => COLUMNS[n]));
  const missing = REQUIRED.filter((name) => !present.has(COLUMNS[name]));
  if (missing.length > 0) {
    throw new PostsFileError(
      "MISSING_COLUMNS",
      `The first row must name these columns: external_id, posted_at, caption. Missing: ${missing
        .map((m) => COLUMNS[m])
        .join(", ")}.`,
    );
  }
  return finish(
    body.map((cells, i) => {
      const raw: Raw = {};
      keys.forEach((key, index) => {
        if (key && raw[key] === undefined) raw[key] = cells[index] ?? "";
      });
      return { raw, row: i + 2 };
    }),
  );
}

export function parsePostsJson(input: string): ParsedPosts {
  let data: unknown;
  try {
    data = JSON.parse(input.replace(/^﻿/u, ""));
  } catch {
    throw new PostsFileError("BAD_JSON", "The file is not valid JSON.");
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { posts?: unknown }).posts)
      ? ((data as { posts: unknown[] }).posts as unknown[])
      : null;
  if (!list) {
    throw new PostsFileError("BAD_JSON", "Expected a list of posts, or an object with `posts`.");
  }
  if (list.length === 0) throw new PostsFileError("EMPTY", "The file has no posts.");
  return finish(
    list.map((item, i) => {
      const raw: Raw = {};
      if (item && typeof item === "object" && !Array.isArray(item)) {
        for (const [name, value] of Object.entries(item as Record<string, unknown>)) {
          const key = COLUMNS[squash(name)];
          if (!key || raw[key] !== undefined) continue;
          raw[key] = value === null || value === undefined ? "" : String(value);
        }
      }
      return { raw, row: i + 1 };
    }),
  );
}

/** By the file name: `.csv` or `.json`. */
export function parsePostsFile(fileName: string, text: string): ParsedPosts {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv")) return parsePostsCsv(text);
  if (name.endsWith(".json")) return parsePostsJson(text);
  throw new PostsFileError("BAD_FORMAT", "Use a .csv or .json file.");
}
