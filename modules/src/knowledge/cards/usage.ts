import type { ServiceContext } from "../../core";

/**
 * The ideas that use each card, by card id. Ideas arrive with M2-06a; until then no card is used,
 * and this one function is the place that lookup is filled in for the card screen and for merging.
 */
export async function ideasUsingCards(
  _ctx: ServiceContext,
  _cardIds: readonly string[],
): Promise<Map<string, { id: string; topic: string }[]>> {
  return new Map();
}
