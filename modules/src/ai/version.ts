/**
 * Version of the generation pipeline (plan 07 §7.5). Bump the minor part when a prompt or model in
 * `config.ts` changes, the major part when the pipeline's shape changes. Every variant stores
 * `generationVersion()` and its full `generation_config`, so analytics can group by it.
 */
export const PIPELINE_VERSION = "1.0.0";

/** The `generation_version` value stored with content, e.g. `p1.0.0`. */
export const generationVersion = (version: string = PIPELINE_VERSION) => `p${version}`;
