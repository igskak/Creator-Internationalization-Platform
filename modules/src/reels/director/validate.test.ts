import { REEL_EMOTIONS as DB_EMOTIONS, REEL_SCENE_ROLES as DB_ROLES } from "@rc/db/json";
import { reelDirector } from "@rc/prompts";
import {
  CHOCOLATE_POST,
  REEL_POSTS,
  REEL_POSTS_V4,
  type ReelPost,
  type ReelPostV4,
} from "@rc/prompts/fixtures/reel-director";
import { describe, expect, it } from "vitest";
import type { NumberLocale } from "../../localization";
import {
  hasStrongMotion,
  paleFoodOnWhite,
  reelValidationContext,
  validateReelScript,
} from "./validate";

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

describe("the chocolate trap post", () => {
  it("passes every check", () => {
    expect(run(CHOCOLATE_POST)).toEqual([]);
  });
});

describe("the hook shot (reel-director@3)", () => {
  const hook = (p: ReelPost, prompt: string) =>
    run(p, (o) => {
      at(o.scenes, 0).shotPrompt = prompt;
    });

  it.each([
    "Static camera. Ice cubes and water bob beside pieces of chocolate on a white table.",
    "Static camera. Steam rises slowly from the bowl.",
    "Static camera. Dark chocolate pieces rest next to a glass of water.",
    "Static camera. Rice grains sit in a white bowl under soft light.",
    "Static camera. Oil drops drift and wobble on the surface of the boiling water.",
    "Static camera. Melted chocolate rests in a glass bowl.",
  ])("blocks a hook shot without a strong motion: %s", (prompt) => {
    const issues = hook(rice, prompt);
    expect(codes(issues)).toEqual(["REEL_HOOK_MOTION"]);
    expect(issues[0]).toMatchObject({ severity: "BLOCKER", fieldPath: "scenes.0.shotPrompt" });
  });

  it.each([
    "Static camera. Melted chocolate falls from a spoon in a thick ribbon into a bowl.",
    "Static camera. Hot stock pours from a ladle onto the rice.",
    "Static camera. Butter sizzles in a pan.",
    "Static camera. A wooden spoon stirs rice in a pan.",
    "Static camera. Oil drizzles over a salad.",
    "Static camera. Chocolate melts into a smooth pool in the bowl.",
    "Static camera. Bubbles rise and burst on boiling water.",
  ])("accepts a hook shot with a strong motion: %s", (prompt) => {
    expect(hook(rice, prompt)).toEqual([]);
  });

  it("judges only the hook scene: a later scene may be gentle", () => {
    expect(
      run(rice, (o) => {
        at(o.scenes, 6).shotPrompt = "Static camera. Steam rises from a creamy risotto.";
      }),
    ).toEqual([]);
  });

  it("does not judge a base script's locked hook shot", () => {
    const base = structuredClone(bulgur.input);
    const locked = structuredClone(bulgur.output);
    at(locked.scenes, 0).shotPrompt = "Static camera. Steam rises from the bowl.";
    const input = {
      ...base,
      baseScript: {
        chosenHookType: at(locked.hookOptions, 0).hookType,
        scenes: locked.scenes,
      },
    };
    const issues = validateReelScript(locked, reelValidationContext(input, { locale: "en" }));
    expect(codes(issues)).not.toContain("REEL_HOOK_MOTION");
  });

  it("knows the strong motions by word, not by part of a word", () => {
    expect(hasStrongMotion("a ribbon of chocolate falling from a spoon")).toBe(true);
    expect(hasStrongMotion("butter sizzling")).toBe(true);
    expect(hasStrongMotion("ice cubes bobbing in water")).toBe(false);
    expect(hasStrongMotion("boiling water with melted chocolate")).toBe(false);
    expect(hasStrongMotion("a waterfall of nothing")).toBe(false);
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

describe("the post (reel-director@2)", () => {
  const pasta = post("pasta-oil");
  const v1Input = (p: ReelPost): ReelPost["input"] => {
    const { ctaTypes: _c, recentCtaTypes: _r, recentHashtags: _h, ...rest } = p.input;
    return rest as ReelPost["input"];
  };

  it("is not checked for a v1 input, and is required for a v2 one", () => {
    const { caption: _c, cta: _t, hashtags: _h, ...script } = structuredClone(rice.output);
    const context = (input: ReelPost["input"]) => reelValidationContext(input, { locale: "es-ES" });
    expect(validateReelScript(script, context(v1Input(rice)))).toEqual([]);
    expect(codes(validateReelScript(script, context(rice.input)))).toEqual(["REEL_POST_MISSING"]);
  });

  it("refuses carousel words, bait, tags and links in the caption of a video", () => {
    const with_ = (text: string) =>
      codes(run(bulgur, (o) => (o.caption = `${text}\n\n${o.cta.text}`)));
    expect(with_("Swipe through for the method.")).toContain("REEL_CAPTION_CAROUSEL");
    expect(with_("All 4 slides in order.")).toContain("REEL_CAPTION_CAROUSEL");
    expect(with_("The method 👉")).toContain("REEL_CAPTION_CAROUSEL");
    expect(with_("The Save button won't press itself.")).toContain("REEL_CAPTION_BAIT");
    expect(with_("Tag a friend who needs this.")).toContain("REEL_CAPTION_BAIT");
    expect(with_("Fine bulgur #grains")).toContain("REEL_CAPTION_TAG_OR_LINK");
    expect(with_("More at www.example.com")).toContain("REEL_CAPTION_TAG_OR_LINK");
    expect(
      codes(run(rice, (o) => (o.caption = `Desliza para ver el método.\n\n${o.cta.text}`))),
    ).toContain("REEL_CAPTION_CAROUSEL");
  });

  it("allows only the carousel's numbers, and an empty or long caption is refused", () => {
    expect(
      codes(run(bulgur, (o) => (o.caption = `Rest it for 25 min.\n\n${o.cta.text}`))),
    ).toContain("NUMERIC_MISMATCH");
    expect(
      codes(run(bulgur, (o) => (o.caption = `Use 3 pots at once.\n\n${o.cta.text}`))),
    ).toContain("REEL_NUMBER_UNSUPPORTED");
    expect(codes(run(bulgur, (o) => (o.caption = "  ")))).toContain("REEL_CAPTION_EMPTY");
    expect(
      codes(run(bulgur, (o) => (o.caption = `${"Fine bulgur. ".repeat(130)}${o.cta.text}`))),
    ).toContain("REEL_CAPTION_LONG");
  });

  it("needs one allowed ask that ends the caption", () => {
    expect(codes(run(bulgur, (o) => (o.cta.type = "LINK_IN_BIO")))).toContain("REEL_CTA_TYPE");
    expect(codes(run(bulgur, (o) => (o.cta.text = "Follow along.")))).toContain(
      "REEL_CTA_NOT_IN_CAPTION",
    );
    expect(codes(run(bulgur, (o) => (o.cta.keyword = "BULGUR")))).toContain("REEL_CTA_KEYWORD");
  });

  it("keeps a keyword ask of the carousel", () => {
    const locked: ReelPost["input"] = {
      ...rice.input,
      carousel: {
        ...rice.input.carousel,
        cta: { type: "COMMENT_KEYWORD", text: "Comenta ARROZ.", keyword: "ARROZ" },
      },
      ctaTypes: [{ code: "COMMENT_KEYWORD", label: "Keyword" }],
    };
    const keep = (o: ReelPost["output"]) => {
      o.cta = { type: "COMMENT_KEYWORD", text: "Comenta ARROZ.", keyword: "ARROZ" };
      o.caption = "El almidón hace el risotto meloso.\n\nComenta ARROZ.";
    };
    expect(run(rice, keep, locked)).toEqual([]);
    expect(
      codes(
        run(
          rice,
          (o) => {
            keep(o);
            o.cta.keyword = "RISOTTO";
          },
          locked,
        ),
      ),
    ).toContain("REEL_CTA_CHANGED");
  });

  it("needs 3 to 5 distinct valid hashtags, and notes a reused block", () => {
    expect(codes(run(pasta, (o) => (o.hashtags = ["#pasta"])))).toContain("REEL_HASHTAG_COUNT");
    expect(codes(run(pasta, (o) => o.hashtags.push("#a", "#b")))).toContain("REEL_HASHTAG_COUNT");
    expect(codes(run(pasta, (o) => (o.hashtags[0] = "#pasta tips")))).toContain(
      "REEL_HASHTAG_FORMAT",
    );
    expect(codes(run(pasta, (o) => (o.hashtags[1] = "#Pasta")))).toContain(
      "REEL_HASHTAG_DUPLICATE",
    );
    const reused = run(bulgur, (o) => (o.hashtags = ["#cookingtips", "#mealprep", "#grainbowl"]));
    expect(reused.map((i) => [i.code, i.severity])).toEqual([["REEL_HASHTAGS_RECENT", "MAJOR"]]);
  });
});

// --- reel-director@4 ----------------------------------------------------------------------------

const runV4 = (p: ReelPostV4, mutate?: (o: ReelPostV4["output"]) => void) => {
  const output = structuredClone(p.output);
  mutate?.(output);
  return validateReelScript(
    output,
    reelValidationContext(p.input, {
      locale: LOCALE[p.input.market.code] ?? "en",
      format: "v4",
    }),
  );
};
const riceV4 = REEL_POSTS_V4[0] as ReelPostV4;

describe("a reel-director@4 script", () => {
  it.each(REEL_POSTS_V4.map((p) => [p.key, p] as const))("%s passes every check", (_key, p) => {
    expect(runV4(p)).toEqual([]);
  });

  it("needs 3 to 3.5 s scenes and 5 to 7 of them; a v3 script is too short", () => {
    const short = runV4(riceV4, (o) => {
      at(o.scenes, 2).beats = 4;
    });
    expect(codes(short)).toEqual(["REEL_BEATS"]);
    const few = runV4(riceV4, (o) => {
      o.scenes.splice(3, 2);
    });
    expect(codes(few)).toContain("REEL_SCENE_COUNT");
    expect(run(rice)).toEqual([]);
    const v3AsV4 = validateReelScript(
      rice.output,
      reelValidationContext(rice.input, { locale: "es-ES", format: "v4" }),
    );
    expect(codes(v3AsV4)).toEqual(
      expect.arrayContaining(["REEL_BEATS", "REEL_LINE_MISSING", "REEL_FRAME_MISSING"]),
    );
  });

  it("wants a line under every card but the hook, and a summary on the last one", () => {
    const missing = runV4(riceV4, (o) => {
      at(o.scenes, 5).line = "";
    });
    expect(missing.map((i) => [i.code, i.fieldPath])).toEqual([
      ["REEL_LINE_MISSING", "scenes.5.line"],
    ]);
    expect(missing[0]?.message).toContain("the whole rule and the ask");
    const onHook = runV4(riceV4, (o) => {
      at(o.scenes, 0).line = "Una pregunta.";
    });
    expect(onHook.map((i) => [i.code, i.severity])).toEqual([["REEL_HOOK_LINE", "MAJOR"]]);
  });

  it("keeps a line short, plain and true to the slides", () => {
    expect(
      codes(
        runV4(riceV4, (o) => {
          at(o.scenes, 1).line =
            "El almidón de la superficie es lo que hace el risotto meloso y cremoso siempre en casa.";
        }),
      ),
    ).toEqual(["REEL_LINE_LENGTH"]);
    expect(
      codes(
        runV4(riceV4, (o) => {
          at(o.scenes, 1).line = "El almidón lo hace **meloso.**";
        }),
      ),
    ).toEqual(["REEL_LINE_FORMAT"]);
    // A number in a line comes from a cited slide, like a number in a card.
    expect(
      codes(
        runV4(riceV4, (o) => {
          at(o.scenes, 2).line = "Tuesta el arroz en seco 5 min antes del caldo.";
        }),
      ),
    ).toContain("NUMERIC_MISMATCH");
  });

  it("needs a frame prompt for every scene, without people or text", () => {
    expect(
      runV4(riceV4, (o) => {
        at(o.scenes, 3).framePrompt = "";
      }).map((i) => [i.code, i.fieldPath]),
    ).toEqual([["REEL_FRAME_MISSING", "scenes.3.framePrompt"]]);
    expect(
      codes(
        runV4(riceV4, (o) => {
          at(o.scenes, 3).framePrompt =
            "A chef's hands hold a black cast-iron pan of toasted arborio rice over the stove.";
        }),
      ),
    ).toEqual(["REEL_FRAME_PROMPT"]);
  });

  it("puts pale food in dark cookware (the owner's rule)", () => {
    const pale = runV4(riceV4, (o) => {
      at(o.scenes, 2).framePrompt =
        "Dry arborio rice grains in a white ceramic pan, a wooden spoon resting in them.";
    });
    expect(pale.map((i) => [i.code, i.severity])).toEqual([["REEL_PALE_ON_WHITE", "BLOCKER"]]);
    expect(pale[0]?.fixHint).toContain("dark cookware");
  });
});

describe("paleFoodOnWhite", () => {
  it.each([
    ["Long-grain rice in cloudy water in a white saucepan.", true],
    ["Boiled chicken thighs in a white enamel pot.", true],
    ["Spaghetti on an ivory plate with sauce.", true],
    ["Long-grain rice in cloudy water in a black cast-iron pot.", false],
    ["Melted dark chocolate in a white bowl.", false],
    ["Golden seared chicken thighs in a white pan.", false],
    ["Egg white whisked in a dark steel bowl.", false],
  ])("%s → %s", (prompt, expected) => {
    expect(paleFoodOnWhite(prompt)).toBe(expected);
  });
});
