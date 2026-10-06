"use client";

import { selectClass } from "@/components/knowledge/field-block";
import { useI18n } from "@/lib/i18n/provider";

export const RIGHT_KEYS = [
  "use",
  "translate",
  "adapt",
  "visuallyTransform",
  "sell",
  "aiProcessing",
  "improvePrompts",
] as const;
export type RightKey = (typeof RIGHT_KEYS)[number];
export type Permission = "ALLOWED" | "DENIED" | "UNKNOWN";
export type RightsValue = Record<RightKey, Permission>;

const PERMISSIONS: Permission[] = ["ALLOWED", "DENIED", "UNKNOWN"];

/** The seven permissions of a source (spec §6.2), each an explicit choice. */
export function RightsMatrix({
  value,
  onChange,
  disabled,
}: {
  value: RightsValue;
  onChange: (next: RightsValue) => void;
  disabled?: boolean;
}) {
  const t = useI18n().messages.sources;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {RIGHT_KEYS.map((key) => (
        <label key={key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t.rights[key]}</span>
          <select
            className={selectClass}
            disabled={disabled}
            value={value[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.value as Permission })}
          >
            {PERMISSIONS.map((p) => (
              <option key={p} value={p}>
                {t.permission[p]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
