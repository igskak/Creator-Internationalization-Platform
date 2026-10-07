import { checkNumericFidelity } from "../../localization";
import type { Validator } from "./types";
import { textFields } from "./types";

/** Numbers with units must come from the cited cards or their conversions (07 §7.9.3). */
export const validateNumericFidelity: Validator = (draft, context) =>
  checkNumericFidelity(textFields(draft), context.numericReference, { locale: context.locale });
