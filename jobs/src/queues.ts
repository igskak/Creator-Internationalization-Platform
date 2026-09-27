import { queue } from "@trigger.dev/sdk";

// Shared queues (plan 06 §6.1). instagram-publish runs one at a time per social account:
// trigger with concurrencyKey = socialAccountId.
export const llmQueue = queue({ name: "llm", concurrencyLimit: 4 });
export const imagesQueue = queue({ name: "images", concurrencyLimit: 3 });
export const renderQueue = queue({ name: "render", concurrencyLimit: 2 });
export const instagramPublishQueue = queue({ name: "instagram-publish", concurrencyLimit: 1 });
export const instagramReadQueue = queue({ name: "instagram-read", concurrencyLimit: 2 });
export const defaultQueue = queue({ name: "default", concurrencyLimit: 5 });
