import { REEL_EMOTIONS as DB_EMOTIONS, REEL_SCENE_ROLES as DB_ROLES } from "@rc/db/json";
import { reelDirector } from "@rc/prompts";
import { REEL_POSTS, type ReelPost } from "@rc/prompts/fixtures/reel-director";
import { describe, expect, it } from "vitest";
import type { NumberLocale } from "../../localization";
import { reelValidationContext, validateReelScript } from "./validate";

// Synthetic content only (the three posts of the eval set).
const post = (key: string): ReelPost => {
  const found = REEL_POSTS.find((p) => p.key === key);
  if (!found) throw new Error(key);
  return found;
};
const LOCALE: Record<string, NumberLocale> = { "es-ES": "es-ES", en: "en" };

const at = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) throw new Error(`No item at ${i}.`);
  return item;
};

const run = (p: ReelPost, mutate?: (o: ReelPost["output"]) => void, base?: ReelPost["input"]) => {
  const output = structuredClone(p.output);
  mutate?.(output);
  const input = base ?? p.input;
  return validateReelScript(
    output,
    reelValidationContext(input, { locale: LOCALE[p.input.market.code] ?? "en" }),
  );
};
const codes = (issues: { code: string }[]) => [...new Set(issues.map((i) => i.code))];
const rice = post("risotto-rice");
const bulgur = post("bulgur-hot-water");

describe("the synthetic posts", () => {
  it.each(REEL_POSTS.map((p) => [p.key, p] as const))("%s passes every check", (_key, p) => {
    expect(run(p)).toEqual([]);
  });

  it("keeps the role and emotion codes of the prompt and of the database equal", () => {
    expect([...reelDirector.REEL_SCENE_ROLES]).toEqual([...DB_ROLES]);
    expect([...reelDirector.REEL_EMOTIONS]).toEqual([...DB_EMOTIONS]);
    expect(reelDirector.REEL_LAYOUTS).toEqual(["RIGHT", "FULL"]);
  });
});

describe("structure", () => {
  it("needs 6 to 9 scenes", () => {
    expect(codes(run(rice, (o) => o.scenes.splice(5, 2)))).toContain("REEL_SCENE_COUNT");
  });

  it("needs 12 to 20 seconds on the beat grid", () => {
    expect(
      codes(
        run(rice, (o) => {
          for (const s of o.scenes) s.beats = 3;
        }),
      ),
    ).toContain("REEL_DURATION");
    const long = run(rice, (o) => {
      for (const s of o.scenes) s.beats = 5;
      o.scenes.push({ ...at(o.scenes, 2), id: "s8" }, { ...at(o.scenes, 3), id: "s9" });
    });
    expect(codes(long)).toContain("REEL_DURATION");
    const off = run(rice, (o) => {
      at(o.scenes, 2).beats = 3.25;
    });
    expect(codes(off)).toContain("REEL_BEATS");
    expect(off.find((i) => i.code === "REEL_BEATS")?.fieldPath).toBe("scenes.2.beats");
  });

  it("checks the roles: hook, rule, one peak, an ending", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 0).role = "STEP";
        }),
      ),
    ).toContain("REEL_ROLES");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 4).role = "STEP";
        }),
      ),
    ).toContain("REEL_ROLES");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 6).role = "STEP";
        }),
      ),
    ).toContain("REEL_ROLES");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 5).role = "CTA";
        }),
      ),
    ).toContain("REEL_ROLES");
  });

  it("asks for a path of emotions as a note, not a blocker", () => {
    const issues = run(rice, (o) => {
      for (const s of o.scenes) s.emotion = "AHA";
    });
    expect(issues.find((i) => i.code === "REEL_EMOTION_VARIETY")?.severity).toBe("MAJOR");
  });

  it("rejects a repeated scene id", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 1).id = "s1";
        }),
      ),
    ).toContain("REEL_SCENE_ID");
  });
});

describe("hooks", () => {
  it("needs three options of three different types, all from the taxonomy", () => {
    expect(codes(run(rice, (o) => o.hookOptions.pop()))).toContain("REEL_HOOK_COUNT");
    expect(
      codes(
        run(rice, (o) => {
          at(o.hookOptions, 1).hookType = "MISTAKE_CALLOUT";
        }),
      ),
    ).toContain("REEL_HOOK_TYPES_DIFFER");
    expect(
      codes(
        run(rice, (o) => {
          at(o.hookOptions, 1).hookType = "NOT_A_TYPE";
        }),
      ),
    ).toContain("REEL_HOOK_TYPE_UNKNOWN");
  });

  it("needs a claim for the rule card and a chosen option that exists", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.hookOptions, 0).claimSlideIds = [];
        }),
      ),
    ).toContain("REEL_HOOK_CLAIM_MISSING");
    expect(
      codes(
        run(rice, (o) => {
          o.chosenHookId = "h9";
        }),
      ),
    ).toContain("REEL_CHOSEN_HOOK");
  });

  it("puts the chosen hook's two cards on scenes 1 and 2 word for word", () => {
    const first = run(rice, (o) => {
      at(o.scenes, 0).card = "Otra cosa";
    });
    expect(first.find((i) => i.code === "REEL_HOOK_CARD_MISMATCH")?.fieldPath).toBe(
      "scenes.0.card",
    );
    const second = run(rice, (o) => {
      o.chosenHookId = "h2";
    });
    expect(
      second.filter((i) => i.code === "REEL_HOOK_CARD_MISMATCH").map((i) => i.fieldPath),
    ).toEqual(["scenes.0.card", "scenes.1.card"]);
  });

  it("makes the last card echo a word of the hook card", () => {
    const issues = run(bulgur, (o) => {
      at(o.scenes, 6).card = "Save it **now.**";
    });
    expect(codes(issues)).toEqual(["REEL_ECHO"]);
    // Accents and stop words do not count: "para" is not an echo.
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 6).card = "Guarda **esto** para luego.";
        }),
      ),
    ).toContain("REEL_ECHO");
  });

  it("applies the changing chosen option consistently", () => {
    // Switching to h3 with its two cards is fine, but the ending still echoes h1's card.
    const issues = run(rice, (o) => {
      o.chosenHookId = "h3";
      at(o.scenes, 0).card = at(o.hookOptions, 2).card;
      at(o.scenes, 1).card = at(o.hookOptions, 2).ruleCard;
    });
    expect(codes(issues)).toEqual(["REEL_ECHO"]);
  });
});

describe("cards", () => {
  it("allows at most 6 words, 36 characters, 14 characters a word", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "uno dos tres cuatro cinco seis siete";
        }),
      ),
    ).toContain("REEL_CARD_WORDS");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "abcdefghij abcdefghij abcdefghij abcd";
        }),
      ),
    ).toContain("REEL_CARD_LENGTH");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "Anticonstitucionalmente";
        }),
      ),
    ).toContain("REEL_CARD_WORD_LENGTH");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "";
        }),
      ),
    ).toContain("REEL_CARD_EMPTY");
  });

  it("does not count the accent markers", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "**Uno** dos tres cuatro cinco seis";
        }),
      ),
    ).not.toContain("REEL_CARD_WORDS");
  });

  it("allows one closed accent", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "Uno **dos";
        }),
      ),
    ).toContain("REEL_CARD_ACCENT");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "**Uno** dos **tres**";
        }),
      ),
    ).toContain("REEL_CARD_ACCENT");
  });
});

describe("shots and pictures", () => {
  it.each([
    ["Water streams through a sieve of rice grains in the sink."],
    ["Static camera. Slow zoom on the rice grains in the sieve."],
    ["Static camera. The camera pans across the rice grains in the sieve."],
    ["Static camera. A chef's hand stirs rice grains in the pan."],
    ["Static camera. The word SAVE appears next to the rice grains in the pan."],
    ["Static camera. Rice."],
  ])("blocks the shot prompt: %s", (prompt) => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).shotPrompt = prompt;
        }),
      ),
    ).toEqual(["REEL_SHOT_PROMPT"]);
  });

  it("allows a pan in the kitchen sense", () => {
    expect(
      run(rice, (o) => {
        at(o.scenes, 2).shotPrompt = "Static camera. Rice grains toast in a dry pan.";
      }),
    ).toEqual([]);
  });

  it("needs a picture of the carousel, and warns about the same picture twice in a row", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).sourcePictureId = "p99";
        }),
      ),
    ).toContain("REEL_PICTURE_UNKNOWN");
    const repeat = run(rice, (o) => {
      at(o.scenes, 3).sourcePictureId = at(o.scenes, 2).sourcePictureId;
    });
    expect(repeat.find((i) => i.code === "REEL_PICTURE_REPEAT")).toMatchObject({
      severity: "MAJOR",
      fieldPath: "scenes.3.sourcePictureId",
    });
  });
});

describe("claims and numbers", () => {
  it("needs a cited slide on rule, step and peak scenes", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).claimSlideIds = [];
        }),
      ),
    ).toContain("REEL_CLAIM_MISSING");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 0).claimSlideIds = [];
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a slide id the carousel does not have", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).claimSlideIds = ["c99"];
        }),
      ),
    ).toContain("REEL_CLAIM_UNKNOWN");
    expect(
      codes(
        run(rice, (o) => {
          at(o.hookOptions, 0).claimSlideIds = ["c99"];
        }),
      ),
    ).toContain("REEL_CLAIM_UNKNOWN");
  });

  it("matches a number with a unit against the cited slides only", () => {
    // "2 min" is on c4. Cited slide c2 says nothing about it.
    const issues = run(rice, (o) => {
      at(o.scenes, 3).claimSlideIds = ["c2"];
    });
    expect(codes(issues)).toContain("NUMERIC_MISMATCH");
    expect(issues.find((i) => i.code === "NUMERIC_MISMATCH")?.message).toContain("cited slides");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 3).card = "Tuesta en seco. **9 min.**";
        }),
      ),
    ).toContain("NUMERIC_MISMATCH");
  });

  it("checks a bare number against the slides, 1, and the count of steps", () => {
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).card = "5 errores del **risotto**";
        }),
      ),
    ).toContain("REEL_NUMBER_UNSUPPORTED");
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).card = "2 errores del **risotto**";
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        run(rice, (o) => {
          at(o.scenes, 2).card = "1 regla del **risotto**";
        }),
      ),
    ).toEqual([]);
  });
});

describe("wording", () => {
  it("blocks the banned hook patterns in any card, in the market's language", () => {
    expect(
      codes(
        run(bulgur, (o) => {
          at(o.scenes, 3).card = "Works **100%** of the time";
        }),
      ),
    ).toContain("REEL_BANNED_PATTERN");
    expect(
      codes(
        run(rice, (o) => {
          at(o.hookOptions, 1).ruleCard = "Lo que no te cuentan del **arroz.**";
        }),
      ),
    ).toContain("REEL_BANNED_PATTERN");
  });

  it("blocks the market's forbidden patterns", () => {
    const context = reelValidationContext(bulgur.input, {
      locale: "en",
      forbiddenPatterns: [{ kind: "PHRASE", pattern: "nutty", reason: "test" }],
    });
    const issues = validateReelScript(structuredClone(bulgur.output), context);
    expect(issues.map((i) => i.code)).toContain("FORBIDDEN_PATTERN");
  });
});

describe("a Reel that reuses another market's shots", () => {
  const baseScript = (p: ReelPost) => ({
    chosenHookType:
      p.output.hookOptions.find((h) => h.id === p.output.chosenHookId)?.hookType ?? "",
    scenes: structuredClone(p.output.scenes),
  });
  const withBase = (p: ReelPost) => ({ ...p.input, baseScript: baseScript(p) });

  it("accepts a script that changes only the cards", () => {
    expect(
      run(
        bulgur,
        (o) => {
          at(o.scenes, 3).card = "Tuesta los **granos.**";
        },
        withBase(bulgur),
      ),
    ).toEqual([]);
  });

  it("blocks a changed shot, picture, order or hook type", () => {
    const changedShot = run(
      bulgur,
      (o) => {
        at(o.scenes, 3).shotPrompt = "Static camera. Bulgur grains rest in a pan.";
      },
      withBase(bulgur),
    );
    expect(changedShot.find((i) => i.code === "REEL_BASE_CHANGED")?.fieldPath).toBe("scenes.3");
    expect(
      codes(
        run(
          bulgur,
          (o) => {
            at(o.scenes, 2).beats = 3.5;
          },
          withBase(bulgur),
        ),
      ),
    ).toContain("REEL_BASE_CHANGED");
    expect(codes(run(bulgur, (o) => o.scenes.pop(), withBase(bulgur)))).toContain(
      "REEL_BASE_CHANGED",
    );
    expect(
      codes(
        run(
          bulgur,
          (o) => {
            o.chosenHookId = "h2";
            at(o.scenes, 0).card = at(o.hookOptions, 1).card;
            at(o.scenes, 1).card = at(o.hookOptions, 1).ruleCard;
          },
          withBase(bulgur),
        ),
      ),
    ).toContain("REEL_BASE_CHANGED");
  });
});
