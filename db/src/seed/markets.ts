import type { markets } from "../schema";

// Market defaults from plan 16 A-06. Notes and vocabularies are edited in /markets/[code] (M0-18).
export const marketSeeds: Omit<typeof markets.$inferInsert, "brandId">[] = [
  {
    code: "es-ES",
    displayName: "Spain",
    flagEmoji: "🇪🇸",
    country: "ES",
    language: "es",
    currency: "EUR",
    timezone: "Europe/Madrid",
    measurementSystem: "METRIC",
    isActive: true,
    sortOrder: 1,
  },
  {
    code: "en",
    displayName: "English",
    flagEmoji: "🌐",
    country: "GLOBAL",
    language: "en",
    currency: "USD",
    timezone: "America/New_York",
    measurementSystem: "DUAL",
    toneNotes: "US spelling. Temperatures °F first with °C in brackets.",
    isActive: true,
    sortOrder: 2,
  },
  {
    code: "fr-FR",
    displayName: "France",
    flagEmoji: "🇫🇷",
    country: "FR",
    language: "fr",
    currency: "EUR",
    timezone: "Europe/Paris",
    measurementSystem: "METRIC",
    isActive: false,
    sortOrder: 3,
  },
];
