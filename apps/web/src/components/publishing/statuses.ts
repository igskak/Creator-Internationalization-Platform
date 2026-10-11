/**
 * Draft statuses for which the review screen shows the publishing panel. A plain module on purpose:
 * the review column is a server component, and a value exported from a "use client" file is only
 * a reference there, not the array.
 */
export const PUBLISHABLE_STATUSES: readonly string[] = [
  "APPROVED",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
];
