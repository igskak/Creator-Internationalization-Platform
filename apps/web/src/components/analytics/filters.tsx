"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** A select that changes one query parameter and keeps the others (the dimension of the learning tab). */
export function ParamSelect({
  name,
  value,
  options,
  label,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        className="h-8 rounded-md border bg-background px-2 text-sm"
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set(name, event.target.value);
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
