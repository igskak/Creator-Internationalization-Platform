import { validateSlideAgainstTemplate } from "@rc/templates";
import type { Validator } from "./types";

/** Slot limits and required slots per template (M2-03). */
export const validateSlots: Validator = (draft, context) =>
  draft.slides.flatMap((slide) => validateSlideAgainstTemplate(slide, context.templates));
