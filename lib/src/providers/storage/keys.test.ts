import { describe, expect, it } from "vitest";
import { ValidationError } from "../../errors";
import { safeFileName, storageKeys } from "./keys";

describe("storageKeys (plan 08 §8.8)", () => {
  it("builds every prefix", () => {
    expect(storageKeys.source("s1", "Книга рецептов.pdf")).toBe("sources/s1/file.pdf");
    expect(storageKeys.source("s1", "Guide v2 (final).pdf")).toBe("sources/s1/Guide-v2-final.pdf");
    expect(storageKeys.asset("v1", "sl1", "hero", "ab12", "webp")).toBe(
      "assets/v1/sl1-hero-ab12.webp",
    );
    expect(storageKeys.asset("v1", "sl1", "hero", "ab12", "orig.png")).toBe(
      "assets/v1/sl1-hero-ab12.orig.png",
    );
    expect(storageKeys.library("a1")).toBe("library/a1.webp");
    expect(storageKeys.render("v1", "r1", 3)).toBe("renders/v1/r1/3.jpg");
    expect(storageKeys.import("u1", "csv")).toBe("imports/u1.csv");
    expect(storageKeys.tmp("x y.txt")).toBe("tmp/x-y.txt");
  });

  it("rejects ids that could escape their prefix", () => {
    expect(() => storageKeys.source("../etc", "a.pdf")).toThrow(ValidationError);
    expect(() => storageKeys.render("v1", "r/1", 0)).toThrow(ValidationError);
    expect(() => storageKeys.render("v1", "r1", -1)).toThrow(ValidationError);
  });
});

describe("safeFileName", () => {
  it("drops directories, dots at the start and unsafe characters", () => {
    expect(safeFileName("../../secret.txt")).toBe("secret.txt");
    expect(safeFileName("C:\\Users\\me\\file.docx")).toBe("file.docx");
    expect(safeFileName(".env")).toBe("env");
    expect(safeFileName("no-extension")).toBe("no-extension");
    expect(safeFileName("Рецепт.DOCX")).toBe("file.DOCX");
    expect(safeFileName("receta_crème brûlée.pdf")).toBe("receta_creme-brulee.pdf");
  });

  it("never returns an empty name and keeps the end of long names", () => {
    expect(safeFileName("///")).toBe("file");
    const long = `${"a".repeat(300)}.pdf`;
    expect(safeFileName(long)).toHaveLength(120);
    expect(safeFileName(long).endsWith(".pdf")).toBe(true);
  });
});
