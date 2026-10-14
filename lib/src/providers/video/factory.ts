import { PermanentError } from "../../errors";
import { createFakeVideoProvider } from "./fake";
import { createHiggsfieldVideoProvider } from "./higgsfield";
import { DEFAULT_VIDEO_MODEL, type VideoProvider } from "./types";

export type VideosConfig =
  | { provider: "fake" }
  | { provider: "live"; higgsfieldApiKey?: string | undefined };

/**
 * The provider chosen by `AI_PROVIDER` (the `ai` part of the loaded env). A live setup without
 * `HIGGSFIELD_API_KEY` gets a provider that refuses every call with a clear message, so the rest
 * of the app keeps working and the Reel button can say why it is off.
 */
export function createVideoProvider(config: VideosConfig): VideoProvider {
  if (config.provider === "fake") return createFakeVideoProvider();
  if (config.higgsfieldApiKey) {
    return createHiggsfieldVideoProvider({ apiKey: config.higgsfieldApiKey });
  }
  const refuse = (): never => {
    throw new PermanentError("Video generation is off: HIGGSFIELD_API_KEY is not set.", {
      details: { code: "video_disabled" },
    });
  };
  return {
    id: "disabled",
    model: DEFAULT_VIDEO_MODEL,
    submit: async () => refuse(),
    waitFor: async () => refuse(),
    generate: async () => refuse(),
  };
}
