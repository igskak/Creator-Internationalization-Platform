"use server";

import {
  UpsertOfferInput,
  UpsertProductInput,
  upsertOffer as upsertOfferService,
  upsertProduct as upsertProductService,
} from "@rc/modules/offers";
import { defineAction } from "./_define";

// Plan 05 §5.5. Products and offers are edited by owners and editors.

export const upsertProduct = defineAction({
  name: "upsertProduct",
  input: UpsertProductInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const product = await upsertProductService(ctx, input);
    return { id: product.id };
  },
});

export const upsertOffer = defineAction({
  name: "upsertOffer",
  input: UpsertOfferInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const { offer, warnings } = await upsertOfferService(ctx, input);
    return { id: offer.id, warnings };
  },
});
