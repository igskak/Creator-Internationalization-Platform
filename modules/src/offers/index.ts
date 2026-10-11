export const MODULE_NAME = "offers";

export {
  CAMPAIGN_ID,
  type Campaign,
  campaignDate,
  campaignMarket,
  createCampaignId,
  planCampaign,
} from "./campaigns";
export {
  getProductsOverview,
  OFFER_STATUSES,
  OFFER_TYPES,
  type OfferRow,
  type OfferWarning,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type ProductsOverview,
  type ProductWithOffers,
  UpsertOfferInput,
  type UpsertOfferResult,
  UpsertProductInput,
  upsertOffer,
  upsertProduct,
} from "./service";
export { buildUtm, buildUtmUrl, shortVariantId } from "./utm";
