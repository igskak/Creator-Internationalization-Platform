export const MODULE_NAME = "health";

export { checkConnectivity, checkLiveness, type Liveness, PROBE_TIMEOUT_MS } from "./liveness";
export * from "./rules";
export {
  getSystemHealth,
  type InstagramIndicator,
  JOB_DOMAINS,
  type JobDomain,
  type LateSnapshot,
  type StuckItem,
  type StuckKind,
  type SystemHealth,
} from "./system";
