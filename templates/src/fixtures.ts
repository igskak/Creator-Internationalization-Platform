import type { SlideData } from "./framework/types";

// Fixture slides for the renderers' snapshot tests, the preview and the visual regression tests
// (08 §8.9): Spanish long text, English short text, maximum-length slots, special characters and
// a missing optional slot. Synthetic text, not Reg.Chef content.

const slide = (
  templateId: string,
  role: string,
  slots: Record<string, string>,
): Omit<SlideData, "id" | "index"> => ({ templateId, role, slots });
const fixture = (name: string, s: Omit<SlideData, "id" | "index">): [string, SlideData] => [
  name,
  { ...s, id: `fx-${name}`, index: 0 },
];

const repeat = (text: string, length: number) =>
  text.repeat(Math.ceil(length / text.length)).slice(0, length);

export const TEMPLATE_FIXTURES: Readonly<Record<string, Readonly<Record<string, SlideData>>>> = {
  A: Object.fromEntries([
    fixture(
      "es-long",
      slide("A", "HOOK", {
        kicker: "Error común",
        headline: "¿Por qué el arroz del domingo siempre queda pegajoso?",
        subline: "Tres gestos que cambian el resultado, sin comprar nada nuevo.",
      }),
    ),
    fixture("en-short", slide("A", "HOOK", { headline: "Stop rinsing your pasta" })),
    fixture(
      "max-length",
      slide("A", "HOOK", {
        kicker: repeat("Kicker ", 24),
        headline: repeat("Una frase larga para el límite ", 70),
        subline: repeat("Subtítulo con el máximo de caracteres permitido ", 90),
      }),
    ),
    fixture(
      "special-chars",
      slide("A", "HOOK", {
        kicker: "¡Ojo! ñ ü",
        headline: "¿Qué pasa a 180 °C con ½ taza de aceite?",
        subline: "Añade “sal” – y prueba: café, crème, naïve",
      }),
    ),
    fixture("no-optionals", slide("A", "HOOK", { headline: "Solo el titular" })),
  ]),
  F: Object.fromEntries([
    fixture(
      "es-long",
      slide("F", "CTA", {
        headline: "Llévate la guía completa del arroz perfecto",
        body: "Comenta la palabra GUÍA y te la enviamos por mensaje directo, con recetas y tiempos.",
        keyword: "GUÍA",
        offerName: "Guía de arroz",
      }),
    ),
    fixture(
      "en-short",
      slide("F", "CTA", {
        headline: "Get the guide",
        body: "Comment GUIDE and we send it to you.",
      }),
    ),
    fixture(
      "max-length",
      slide("F", "CTA", {
        headline: repeat("Titular de llamada a la acción ", 60),
        body: repeat("Texto del cuerpo con el máximo permitido de caracteres ", 160),
        keyword: "ABCDEFGHIJKLMNOP",
        offerName: repeat("Nombre de la oferta ", 40),
      }),
    ),
    fixture(
      "special-chars",
      slide("F", "CTA", {
        headline: "¿Listo? ¡Guarda esta receta!",
        body: "Hornea a 200 °C, 2½ tazas – sin prisa. Más en el perfil.",
        keyword: "ÑAM",
      }),
    ),
    fixture(
      "no-optionals",
      slide("F", "CTA", { headline: "Guárdalo", body: "Te servirá la próxima vez." }),
    ),
  ]),
};
