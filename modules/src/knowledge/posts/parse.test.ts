import { describe, expect, it } from "vitest";
import {
  MAX_POST_ROWS,
  PostsFileError,
  parseCsv,
  parsePostsCsv,
  parsePostsFile,
  parsePostsJson,
} from "./parse";

const HEADER =
  "external_id,permalink,posted_at,format,caption,likes,comments,saves,shares,reach,views,category,angle,hook_type,cta_type,product_code,visual_pattern,is_exemplar";

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, commas and line breaks inside quotes, and CRLF", () => {
    expect(parseCsv('a,"b, ""c""",d\r\n"line1\nline2",x,\r\n', ",")).toEqual([
      ["a", 'b, "c"', "d"],
      ["line1\nline2", "x", ""],
    ]);
  });

  it("drops empty lines and keeps a last row without a final newline", () => {
    expect(parseCsv("a,b\n\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parsePostsCsv", () => {
  it("reads a full row: emojis, Russian text, a multi-line caption, metrics and annotations", () => {
    const csv = [
      HEADER,
      `p1,https://www.instagram.com/p/AAA/,2026-03-01 10:30,carousel,"Гречка 🥣 без каши!\nСохрани, чтобы не потерять ""рецепт""",1 250,"34","12",5,9000,12000,GRAINS,MYTH_VS_FACT,QUESTION,DM_KEYWORD,GUIDE-1,flatlay,да`,
    ].join("\n");
    const { rows, errors, totalRows } = parsePostsCsv(csv);
    expect(errors).toEqual([]);
    expect(totalRows).toBe(1);
    expect(rows[0]).toEqual({
      row: 2,
      externalId: "p1",
      permalink: "https://www.instagram.com/p/AAA/",
      postedAt: "2026-03-01T10:30:00.000Z",
      format: "CAROUSEL",
      caption: 'Гречка 🥣 без каши!\nСохрани, чтобы не потерять "рецепт"',
      metrics: { likes: 1250, comments: 34, saves: 12, shares: 5, reach: 9000, views: 12000 },
      annotations: {
        category: "GRAINS",
        angle: "MYTH_VS_FACT",
        hookType: "QUESTION",
        ctaType: "DM_KEYWORD",
        productCode: "GUIDE-1",
        visualPattern: "flatlay",
      },
      isExemplar: true,
    });
  });

  it("needs only external_id, posted_at and caption; the rest stays empty", () => {
    const { rows, errors } = parsePostsCsv("external_id,posted_at,caption\np1,2026-03-01,Привет");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      externalId: "p1",
      postedAt: "2026-03-01T00:00:00.000Z",
      format: null,
      metrics: {},
      annotations: {},
      isExemplar: null,
      permalink: null,
    });
  });

  it("accepts other column spellings, a BOM, semicolons and tabs", () => {
    const semicolon =
      "﻿External ID;Posted-At;Caption;Hook Type\np1;2026-03-01T08:00:00+02:00;Текст;QUESTION";
    const a = parsePostsCsv(semicolon);
    expect(a.rows[0]).toMatchObject({
      postedAt: "2026-03-01T06:00:00.000Z",
      annotations: { hookType: "QUESTION" },
    });
    const tabs = parsePostsCsv("external_id\tposted_at\tcaption\np2\t2026-03-02\tTab");
    expect(tabs.rows[0]?.externalId).toBe("p2");
  });

  it("reports bad rows with the row number and field, and still returns the good ones", () => {
    const csv = [
      "external_id,posted_at,caption,format,likes,is_exemplar,permalink",
      "ok,2026-03-01,Хорошо,reel,10,no,https://x.test/p",
      ",2026-03-01,Нет id,,,,",
      "bad-date,вчера,Текст,,,,",
      "no-caption,2026-03-01,   ,,,,",
      "bad-format,2026-03-01,Текст,story,,,",
      "bad-number,2026-03-01,Текст,,12.5,,",
      "bad-flag,2026-03-01,Текст,,,maybe,",
      "bad-link,2026-03-01,Текст,,,,instagram.com/p/1",
    ].join("\n");
    const { rows, errors, totalRows } = parsePostsCsv(csv);
    expect(totalRows).toBe(8);
    expect(rows.map((r) => r.externalId)).toEqual(["ok"]);
    expect(rows[0]).toMatchObject({ format: "REEL", isExemplar: false, metrics: { likes: 10 } });
    expect(errors.map((e) => [e.row, e.field])).toEqual([
      [3, "external_id"],
      [4, "posted_at"],
      [5, "caption"],
      [6, "format"],
      [7, "likes"],
      [8, "is_exemplar"],
      [9, "permalink"],
    ]);
    expect(errors[1]).toMatchObject({
      externalId: "bad-date",
      message: expect.stringContaining("вчера"),
    });
  });

  it("skips a post id that repeats in the file and says where the first one is", () => {
    const { rows, errors } = parsePostsCsv(
      "external_id,posted_at,caption\np1,2026-03-01,A\np1,2026-03-02,B",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.caption).toBe("A");
    expect(errors).toEqual([
      expect.objectContaining({
        row: 3,
        externalId: "p1",
        message: expect.stringContaining("row 2"),
      }),
    ]);
  });

  it("refuses a file that is empty, lacks required columns or is too long", () => {
    expect(() => parsePostsCsv("  \n")).toThrow(PostsFileError);
    expect(() => parsePostsCsv("id,caption\n1,x")).toThrowError(/posted_at/);
    const many = `external_id,posted_at,caption\n${Array.from({ length: MAX_POST_ROWS + 1 }, (_, i) => `p${i},2026-03-01,x`).join("\n")}`;
    expect(() => parsePostsCsv(many)).toThrow(expect.objectContaining({ code: "TOO_MANY_ROWS" }));
  });
});

describe("parsePostsJson", () => {
  it("reads a list or { posts }, numbers and booleans included", () => {
    const post = {
      external_id: 7,
      posted_at: "2026-03-01T10:00:00Z",
      caption: "Привет 👋",
      likes: 5,
      is_exemplar: true,
      hookType: "QUESTION",
    };
    for (const text of [JSON.stringify([post]), JSON.stringify({ posts: [post] })]) {
      const { rows, errors } = parsePostsJson(text);
      expect(errors).toEqual([]);
      expect(rows[0]).toMatchObject({
        row: 1,
        externalId: "7",
        metrics: { likes: 5 },
        isExemplar: true,
        annotations: { hookType: "QUESTION" },
      });
    }
  });

  it("reports items that are not objects as rows with errors", () => {
    const { rows, errors } = parsePostsJson(
      JSON.stringify([{ external_id: "a", posted_at: "2026-03-01", caption: "x" }, 5, null]),
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([2, 2, 2, 3, 3, 3]);
  });

  it("refuses broken JSON, a wrong shape and an empty list", () => {
    expect(() => parsePostsJson("{oops")).toThrow(expect.objectContaining({ code: "BAD_JSON" }));
    expect(() => parsePostsJson('{"a":1}')).toThrow(expect.objectContaining({ code: "BAD_JSON" }));
    expect(() => parsePostsJson("[]")).toThrow(expect.objectContaining({ code: "EMPTY" }));
  });
});

describe("parsePostsFile", () => {
  it("chooses the parser by file name", () => {
    expect(
      parsePostsFile("Posts.CSV", "external_id,posted_at,caption\n1,2026-03-01,x").rows,
    ).toHaveLength(1);
    expect(
      parsePostsFile("posts.json", '[{"external_id":"1","posted_at":"2026-03-01","caption":"x"}]')
        .rows,
    ).toHaveLength(1);
    expect(() => parsePostsFile("posts.xlsx", "")).toThrow(
      expect.objectContaining({ code: "BAD_FORMAT" }),
    );
  });
});
