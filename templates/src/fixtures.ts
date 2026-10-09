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
  B: Object.fromEntries([
    fixture(
      "es-long",
      slide("B", "FACT", {
        number: "2:1",
        label: "Agua y arroz",
        headline: "La proporción que no falla",
        body: "Dos partes de agua por una de arroz, tapa puesta y fuego bajo; el vapor termina el trabajo y los granos quedan sueltos, sin rascar el fondo de la olla.",
      }),
    ),
    fixture("en-short", slide("B", "FACT", { number: "12", body: "Minutes of rest." })),
    fixture(
      "max-length",
      slide("B", "EXPLANATION", {
        number: "88888888",
        label: repeat("Etiqueta ", 40),
        headline: repeat("Titular largo para el máximo ", 60),
        body: repeat("Cuerpo con el máximo de caracteres permitido en esta plantilla. ", 220),
      }),
    ),
    fixture(
      "special-chars",
      slide("B", "FACT", {
        number: "180°",
        label: "Horno a 180 °C",
        body: "¿Cuánto tarda? ½ hora – quizá ¾. Añade “sal”, café y crème.",
      }),
    ),
    fixture(
      "no-number",
      slide("B", "EXPLANATION", {
        headline: "Por qué suelta almidón",
        body: "El grano roza con otros granos y libera almidón en el agua.",
      }),
    ),
  ]),
  E: Object.fromEntries([
    fixture(
      "es-long",
      slide("E", "MISTAKE", {
        mistakeTitle: "Error: remover el risotto",
        mistakeText:
          "Remover sin parar rompe los granos y el caldo se vuelve espeso y pegajoso, sin cremosidad.",
        correctTitle: "Mejor: remover lo justo",
        correctText:
          "Añade el caldo poco a poco y mueve la olla; el almidón sale solo y el grano queda entero.",
      }),
    ),
    fixture(
      "en-short",
      slide("E", "MISTAKE", {
        mistakeTitle: "Wrong: rinse",
        mistakeText: "Washes the starch away.",
        correctTitle: "Right: keep it",
        correctText: "Starch makes it creamy.",
      }),
    ),
    fixture(
      "max-length",
      slide("E", "MISTAKE", {
        mistakeTitle: repeat("Título del error ", 40),
        mistakeText: repeat("Texto del error con el máximo permitido de caracteres. ", 140),
        correctTitle: repeat("Título correcto ", 40),
        correctText: repeat("Texto correcto con el máximo permitido de caracteres. ", 140),
      }),
    ),
    fixture(
      "special-chars",
      slide("E", "MISTAKE", {
        mistakeTitle: "¡Ojo con los 200 °C!",
        mistakeText: "Más de ½ hora – se seca: café, crème, naïve “mal”.",
        correctTitle: "Mejor a 180 °C",
        correctText: "Tapa y vigila; ¿listo? ¡Ñam!",
      }),
    ),
    fixture(
      "no-optionals",
      slide("E", "CORRECT", {
        mistakeTitle: "Error",
        mistakeText: "Lo que no se hace.",
        correctTitle: "Acierto",
        correctText: "Lo que sí se hace.",
      }),
    ),
  ]),
};
