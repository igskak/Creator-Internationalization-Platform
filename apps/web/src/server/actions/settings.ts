"use server";

import { UpdateMarketInput, updateMarket as updateMarketService } from "@rc/modules/localization";
import {
  SetAppSettingInput,
  setAppSetting as setAppSettingService,
  UpdateBrandInput,
  UpsertTaxonomyTermInput,
  updateBrand as updateBrandService,
  upsertTaxonomyTerm as upsertTaxonomyTermService,
} from "@rc/modules/settings";
import { defineAction } from "./_define";

// Plan 05 §5.2. Roles per 10 §10.6; the market service also refuses isActive for non-owners.

export const updateBrand = defineAction({
  name: "updateBrand",
  input: UpdateBrandInput,
  roles: ["owner"],
  handler: (ctx, input) => updateBrandService(ctx, input),
});

export const updateMarket = defineAction({
  name: "updateMarket",
  input: UpdateMarketInput,
  roles: ["owner", "editor"],
  handler: (ctx, input) => updateMarketService(ctx, input),
});

export const upsertTaxonomyTerm = defineAction({
  name: "upsertTaxonomyTerm",
  input: UpsertTaxonomyTermInput,
  roles: ["owner"],
  handler: (ctx, input) => upsertTaxonomyTermService(ctx, input),
});

export const setAppSetting = defineAction({
  name: "setAppSetting",
  input: SetAppSettingInput,
  roles: ["owner"],
  handler: (ctx, input) => setAppSettingService(ctx, input),
});
