// XML-tagged prompt sections (plan 07 §7.5). Everything that comes from data (cards, source text,
// captions, user instructions) is escaped, so it cannot close a tag or open a new section. The
// system prompt tells the model that tagged content is data, not instructions.

const TAG_NAME = /^[a-z][a-z0-9_]*$/;
/** Characters XML 1.0 cannot carry (all control characters except tab, LF, CR). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: that is exactly what is removed
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Already-rendered XML that must not be escaped again. Create with `raw()` or `section()`. */
export type Raw = { readonly raw: string };

export const raw = (xml: string): Raw => ({ raw: xml });
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && "raw" in value;

export function escapeText(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\t", "&#9;");
}

export type Attrs = Record<string, string | number | boolean | undefined | null>;
export type Body = string | Raw | readonly (string | Raw)[];

function renderAttrs(attrs: Attrs | undefined): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] != null)
    .map(([name, value]) => {
      if (!TAG_NAME.test(name)) throw new Error(`Invalid attribute name: ${name}`);
      return ` ${name}="${escapeAttr(String(value))}"`;
    })
    .join("");
}

function renderBody(body: Body): string {
  const parts = Array.isArray(body) ? body : [body];
  return parts.map((part) => (isRaw(part) ? part.raw : escapeText(part))).join("\n");
}

/**
 * `<tag a="b">\nbody\n</tag>`. Strings in `body` and attribute values are escaped; `Raw` parts
 * (e.g. nested sections) are inserted as they are. The tag name must be lower snake case.
 */
export function section(tag: string, body: Body, attrs?: Attrs): Raw {
  if (!TAG_NAME.test(tag)) throw new Error(`Invalid tag name: ${tag}`);
  return raw(`<${tag}${renderAttrs(attrs)}>\n${renderBody(body)}\n</${tag}>`);
}

/** Sections separated by a blank line; the text of one user content block. */
export function renderSections(...sections: readonly (Raw | string)[]): string {
  return sections.map((part) => (isRaw(part) ? part.raw : escapeText(part))).join("\n\n");
}
