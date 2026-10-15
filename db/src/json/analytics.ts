// JSON column shapes for 0011_analytics (plan 04 §0007_analytics, 11 §11.2).

/** `metric_snapshots.profile_actions_json`: what the post did to the profile; null = not reported. */
export type ProfileActions = {
  profileVisits?: number | null;
  follows?: number | null;
  /** The per-action breakdown of `profile_activity`, as Instagram names the actions. */
  profileActivity?: Record<string, number>;
};

/** `metric_snapshots.video_metrics_json` (Reels): metric name as Instagram gives it → value. */
export type VideoMetrics = Record<string, number | null>;
