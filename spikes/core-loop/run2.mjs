// S-01 throwaway spike: guide text -> knowledge cards -> 1 Master Idea -> ES + EN carousel drafts.
// No dependencies. Usage: node spikes/core-loop/run.mjs   (reads ANTHROPIC_API_KEY from .env)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const env = Object.fromEntries(
  readFileSync(join(here, "../../.env"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]),
);
const MODEL = process.env.SPIKE_MODEL ?? "claude-opus-5-5";
const guide = readFileSync(join(out, "guide.txt"), "utf8");
const style = readFileSync(join(out, "style-samples.md"), "utf8");
const usage = [];

async function call(stage, system, user, maxTokens = 8000) {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${stage}: ${res.status} ${JSON.stringify(j).slice(0, 500)}`);
  const ms = Date.now() - t0;
  usage.push({ stage, ms, ...j.usage });
  const text = j.content.map((c) => c.text ?? "").join("");
  writeFileSync(join(out, `${stage}.txt`), text);
  console.log(`${stage}: ${ms} ms, in ${j.usage.input_tokens} out ${j.usage.output_tokens}`);
  return text;
}

const cards = (await import("node:fs")).existsSync(join(out,"1-cards.txt")) ? readFileSync(join(out,"1-cards.txt"),"utf8") : await call(
  "1-cards",
  "Ты извлекаешь из шефского гайда структурированные карточки знаний. Отвечай только валидным JSON-массивом.",
  `Из текста гайда извлеки 15–20 карточек знаний. Поля каждой: category (technique|ratio|temperature|timing|mistake|principle|safety), claim (одно проверяемое утверждение), explanation (почему так работает, 1–3 предложения), numbers (числа и единицы как в тексте), quote (ДОСЛОВНАЯ цитата из текста, без правок), page (номер страницы), safety_sensitive (bool). Не выдумывай ничего, чего нет в тексте.\n\n${guide}`,
  12000,
);

// quote verification: is each quote a verbatim substring of the guide (whitespace-normalized)?
const norm = (s) => s.replace(/\s+/g, " ").trim();
let parsed = [];
try {
  parsed = JSON.parse(cards.slice(cards.indexOf("["), cards.lastIndexOf("]") + 1));
} catch (e) {
  console.log("cards JSON parse failed", e.message);
}
const g = norm(guide);
const verified = parsed.map((c) => ({ ...c, quote_verified: g.includes(norm(c.quote ?? "")) }));
writeFileSync(join(out, "1-cards-verified.json"), JSON.stringify(verified, null, 2));
console.log(`cards: ${verified.length}, quotes verified verbatim: ${verified.filter((c) => c.quote_verified).length}`);


const ALLOWED_TRIGGERS = ["СЕКРЕТЫ", "ДОСТУП"]; // owner-defined (ManyChat); anything else is invented
const BAN = "ЗАПРЕЩЕНО добавлять факты, бытовые сценки, примеры, дни недели, бренды и числа, которых нет в карточках. Можно перефразировать и менять подачу, но не содержание. CTA-слово в комментариях бери ТОЛЬКО из списка: " + ALLOWED_TRIGGERS.join(", ") + ".";

async function judge(stage, rubric, payload) {
  const t = await call(stage, "Ты строгий проверяющий. Отвечай ТОЛЬКО JSON: {\"pass\": bool, \"score\": 1-10, \"issues\": [строки]}.", rubric + "\n\n" + payload, 3000);
  try { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); } catch { return { pass: false, score: 0, issues: ["unparseable verdict"] }; }
}

const groups = [
  (c) => c.slice(0, 5),
  (c) => c.filter((x) => ["mistake", "principle", "temperature"].includes(x.category)).concat(c).slice(0, 5),
  (c) => c.slice(-5),
];
const report = [];
for (let n = 0; n < 3; n++) {
  const picked = groups[n](verified.filter((c) => c.quote_verified));
  const P = JSON.stringify(picked, null, 2);
  const idea = await call(`2-idea-${n}`, "Ты контент-стратег шефа Reg.Chef. Отвечай на русском. " + BAN,
    `Карточки:\n${P}\n\nСтиль аккаунта:\n${style}\n\nПредложи ОДНУ Master Idea для карусели Instagram: hook, тезис, 5–7 слайдов, CTA. Опирайся только на карточки.`);
  const brief = (lang, market, extra = "") =>
    `Master Idea:\n${idea}\n\nКарточки:\n${P}\n\nСтиль оригинала:\n${style}\n\nСделай ОРИГИНАЛЬНУЮ карусель для рынка ${market} (${lang}). Ту же идею подай иначе, чем в другом языке: другая структура caption и другой крючок, как у местного автора. Числа и температуры точно. Выдай слайды (заголовок, подпись, промпт фото), caption, 5 хэштегов, CTA. ${extra}`;
  const sys = "You are the native-language editor for chef Reg.Chef's international Instagram accounts. " + BAN;
  let es = await call(`3-es-${n}`, sys, brief("español, es-ES", "Испания"));
  let en = await call(`3-en-${n}`, sys, brief("English", "англоязычный рынок"));

  const check = async (tag) => {
    const fid = (lang, t) => judge(`c-${tag}-fid-${lang}-${n}`, "Проверь каждое утверждение и каждое число текста по карточкам. Любой факт, пример или сценка, которых нет в карточках, = issue. pass только если выдумок нет.", `КАРТОЧКИ:\n${P}\n\nТЕКСТ:\n${t}`);
    const [fe, fn, diff, ces, cen, trg, voiceE, voiceN] = await Promise.all([
      fid("es", es), fid("en", en),
      judge(`c-${tag}-diff-${n}`, "Сравни ES и EN карусели. Это два разных оригинальных текста одной идеи или перевод друг друга? Сравни крючок, порядок мыслей, структуру caption. pass только если структура и крючок заметно различаются.", `ES:\n${es}\n\nEN:\n${en}`),
      judge(`c-${tag}-cons-es-${n}`, "Проверь согласованность: крючок caption, заголовки слайдов и CTA говорят про ту же главную тему, что Master Idea? pass если да.", `IDEA:\n${idea}\n\nТЕКСТ:\n${es}`),
      judge(`c-${tag}-cons-en-${n}`, "Проверь согласованность: крючок caption, заголовки слайдов и CTA говорят про ту же главную тему, что Master Idea? pass если да.", `IDEA:\n${idea}\n\nТЕКСТ:\n${en}`),
      judge(`c-${tag}-trig-${n}`, `Найди CTA-слово для комментариев в обоих текстах. pass только если оно из списка ${ALLOWED_TRIGGERS.join(", ")} (допустим перевод слова в скобках).`, `ES:\n${es}\n\nEN:\n${en}`),
      judge(`c-${tag}-voice-es-${n}`, "Сравни с образцом голоса автора (хук-вопрос, «Спойлер», физика/инженерия, короткие строки, лёгкий юмор). score 1-10 за близость голоса; pass если >=7.", `ОБРАЗЕЦ:\n${style}\n\nТЕКСТ:\n${es}`),
      judge(`c-${tag}-voice-en-${n}`, "Сравни с образцом голоса автора (хук-вопрос, «Спойлер», физика/инженерия, короткие строки, лёгкий юмор). score 1-10 за близость голоса; pass если >=7.", `ОБРАЗЕЦ:\n${style}\n\nТЕКСТ:\n${en}`),
    ]);
    return { fid_es: fe, fid_en: fn, diff, cons_es: ces, cons_en: cen, trigger: trg, voice_es: voiceE, voice_en: voiceN };
  };

  const v1 = await check("r1");
  const fails = Object.entries(v1).filter(([, v]) => !v.pass);
  let v2 = null;
  if (fails.length) {
    const notes = fails.map(([k, v]) => `${k}: ${v.issues.join("; ")}`).join("\n");
    const fix = (lang, market, t) => call(`4-fix-${lang}-${n}`, "You are the native-language editor. " + BAN, `Перепиши текст, исправив замечания проверяющих. Оставь всё остальное.\nЗАМЕЧАНИЯ:\n${notes}\n\nКАРТОЧКИ:\n${P}\n\nТЕКСТ:\n${t}`);
    [es, en] = await Promise.all([fix("es", "Испания", es), fix("en", "EN", en)]);
    v2 = await check("r2");
  }
  report.push({ idea: n, round1: v1, round2: v2 });
}
writeFileSync(join(out, "checkers-report.json"), JSON.stringify(report, null, 2));
for (const r of report) {
  const s = (v) => Object.entries(v).map(([k, x]) => `${k}:${x.pass ? "ok" : "FAIL"}(${x.score})`).join(" ");
  console.log(`idea ${r.idea} R1 ${s(r.round1)}`);
  if (r.round2) console.log(`idea ${r.idea} R2 ${s(r.round2)}`);
}
writeFileSync(join(out, "usage2.json"), JSON.stringify({ model: MODEL, usage }, null, 2));
console.log(`TOTAL tokens in ${usage.reduce((a, u) => a + u.input_tokens, 0)} out ${usage.reduce((a, u) => a + u.output_tokens, 0)}, calls ${usage.length}`);
