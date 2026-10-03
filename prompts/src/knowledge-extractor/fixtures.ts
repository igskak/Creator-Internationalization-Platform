import type { ExtractorInput, ExtractorOutput } from "./schema";

// Synthetic Russian culinary pages for tests and evals. The text is written for this project and
// is not taken from any Reg.Chef material. The expected cards are in
// evals/datasets/knowledge-extractor/README.md.

export const FIXTURE_PAGES = [
  {
    number: 1,
    section: null,
    text: "Содержание\nПредисловие ........ 2\nКрупы без каши ........ 3\nХранение готовых блюд ........ 4\nНаши курсы ........ 5",
  },
  {
    number: 2,
    section: "Крупы без каши",
    text: "Гречку заливают горячей водой в соотношении 1:2 и варят под крышкой 15 минут на слабом огне. Крышку не поднимают: пар внутри кастрюли доваривает крупу, а каждое открывание его выпускает. После варки кастрюлю снимают с огня и оставляют ещё на 10 минут. Частая ошибка — мешать гречку во время варки: зёрна разбиваются, и крупа становится клейкой. Соль добавляют в воду до того, как она закипела, тогда вкус распределяется равномерно.",
  },
  {
    number: 3,
    section: "Хранение готовых блюд",
    text: "Готовый рис нельзя оставлять при комнатной температуре дольше двух часов. Остывший рис убирают в холодильник при температуре +4 °C и съедают в течение суток. Тёплый рис в закрытой посуде — благоприятная среда для бактерий, поэтому его раскладывают тонким слоем, чтобы он остыл быстрее. Разогревать рис повторно можно только один раз, до полного прогрева, не менее 74 °C внутри.",
  },
  {
    number: 4,
    section: null,
    text: "Запишитесь на наш онлайн-курс по кулинарии со скидкой 20% до конца месяца! Подробности на сайте.",
  },
] as const;

export const FIXTURE_TAXONOMY: ExtractorInput["taxonomy"] = {
  categories: [
    { code: "GRAINS_RICE_PASTA", label: "Grains, rice, pasta" },
    {
      code: "STORAGE_SAFETY",
      label: "Storage and safety",
      description: "Keeping cooked food safe",
    },
    { code: "TECHNIQUES", label: "Techniques" },
  ],
  subcategories: [
    { code: "BUCKWHEAT", label: "Buckwheat", parentCode: "GRAINS_RICE_PASTA" },
    { code: "COOLING", label: "Cooling and reheating", parentCode: "STORAGE_SAFETY" },
  ],
};

export const FIXTURE_INPUT: ExtractorInput = {
  source: {
    title: "Крупы без каши (synthetic)",
    type: "GUIDE",
    author: "Test Author",
    language: "ru",
  },
  taxonomy: FIXTURE_TAXONOMY,
  mode: "TEXT",
  pageStart: 1,
  pageEnd: 4,
  pages: FIXTURE_PAGES.map((p) => ({ ...p })),
};

/** What a good extraction of the pages above looks like. */
export const FIXTURE_OUTPUT: ExtractorOutput = {
  cards: [
    {
      title: "Гречка: не поднимать крышку",
      category: "GRAINS_RICE_PASTA",
      subcategory: "BUCKWHEAT",
      claim: "Гречку варят под крышкой, не поднимая её.",
      explanation: "Пар внутри кастрюли доваривает крупу, а каждое открывание его выпускает.",
      procedure: [
        { n: 1, text: "Залить гречку горячей водой в соотношении 1:2." },
        { n: 2, text: "Варить под крышкой 15 минут на слабом огне." },
        { n: 3, text: "Снять с огня и оставить ещё на 10 минут." },
      ],
      ingredients: [{ name: "гречка", note: "крупа к воде 1:2" }],
      temperatures: [],
      timings: [
        { value: 15, unit: "min", context: "варка под крышкой" },
        { value: 10, unit: "min", context: "настаивание после варки" },
      ],
      commonMistakes: [
        {
          mistake: "Мешать гречку во время варки",
          why: "Зёрна разбиваются, и крупа становится клейкой.",
        },
      ],
      sourceQuote:
        "Крышку не поднимают: пар внутри кастрюли доваривает крупу, а каждое открывание его выпускает.",
      pageStart: 2,
      pageEnd: 2,
      sectionHint: "Крупы без каши",
      confidence: 0.95,
      safetySensitive: false,
    },
    {
      title: "Рис: остывание и хранение",
      category: "STORAGE_SAFETY",
      subcategory: "COOLING",
      claim: "Готовый рис нельзя оставлять при комнатной температуре дольше двух часов.",
      explanation: "Тёплый рис в закрытой посуде — благоприятная среда для бактерий.",
      procedure: [
        { n: 1, text: "Разложить рис тонким слоем, чтобы он остыл быстрее." },
        { n: 2, text: "Убрать остывший рис в холодильник и съесть в течение суток." },
      ],
      ingredients: [{ name: "рис" }],
      temperatures: [{ value: 4, unit: "C", target: "FRIDGE", context: "хранение остывшего риса" }],
      timings: [
        { value: 2, unit: "h", context: "максимум при комнатной температуре" },
        { value: 1, unit: "d", context: "срок хранения в холодильнике" },
      ],
      commonMistakes: [],
      sourceQuote: "Готовый рис нельзя оставлять при комнатной температуре дольше двух часов.",
      pageStart: 3,
      pageEnd: 3,
      sectionHint: "Хранение готовых блюд",
      confidence: 0.95,
      safetySensitive: true,
      safetyReason: "Хранение готового риса и рост бактерий.",
    },
  ],
  skippedPages: [
    { page: 1, reason: "TABLE_OF_CONTENTS" },
    { page: 4, reason: "MARKETING" },
  ],
};
