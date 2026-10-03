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

const cards = await call(
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

const picked = verified.filter((c) => c.quote_verified).slice(0, 5);
const idea = await call(
  "2-idea",
  "Ты контент-стратег шефа Reg.Chef. Отвечай на русском.",
  `Вот 5 карточек знаний:\n${JSON.stringify(picked, null, 2)}\n\nСтиль аккаунта:\n${style}\n\nПредложи ОДНУ Master Idea для карусели Instagram: hook (вопрос-крючок), тезис, 5–7 слайдов (заголовок + 1–2 строки, что показать на макро-фото), CTA. Опирайся только на карточки.`,
);

const brief = (lang, market) =>
  `Master Idea:\n${idea}\n\nКарточки:\n${JSON.stringify(picked, null, 2)}\n\nСтиль оригинала:\n${style}\n\nСделай ОРИГИНАЛЬНУЮ карусель для рынка ${market} (${lang}), не дословный перевод: ту же идею подай так, как её подал бы носитель языка-автор. Сохрани все числа и температуры точно, переведи единицы только если рынок ими не пользуется. Выдай: слайды (заголовок, подпись, промпт для макро-фото), caption для Instagram, 5 хэштегов, CTA. В конце список «Что изменено для рынка и почему».`;

const sys = "You are the native-language content editor for chef Reg.Chef's international Instagram accounts. Never invent facts beyond the cards.";
await call("3-es", sys, brief("español, es-ES", "Испания"));
await call("3-en", sys, brief("English", "англоязычная аудитория"));

writeFileSync(join(out, "usage.json"), JSON.stringify({ model: MODEL, usage }, null, 2));
const tin = usage.reduce((a, u) => a + u.input_tokens, 0);
const tout = usage.reduce((a, u) => a + u.output_tokens, 0);
console.log(`TOTAL tokens in ${tin} out ${tout}, ${usage.reduce((a, u) => a + u.ms, 0)} ms`);
